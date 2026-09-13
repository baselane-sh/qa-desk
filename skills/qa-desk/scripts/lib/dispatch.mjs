import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { substituteArgv, agentHasModelToken } from './config.mjs';
import { getDefect, listDefects, patchDispatch } from './defects.mjs';
import { renderFixPrompt } from './prompt.mjs';

const DEFAULT_ORPHAN_POLL_MS = 5000;
const DEFAULT_CLOSE_GRACE_MS = 30_000;
const MAX_TAIL_CHARS = 16 * 1024;
const ISSUE_ID_RE = /^(?!\.+$)[\w.-]+$/;
const ORPHAN_ERROR = 'orphaned by restart, check the issue';

export function buildChildEnv(env, patterns) {
  const exact = new Set(patterns.filter((p) => !p.endsWith('*')));
  const prefixes = patterns.filter((p) => p.endsWith('*')).map((p) => p.slice(0, -1));
  return Object.fromEntries(Object.entries(env).filter(([key]) => !exact.has(key) && !prefixes.some((p) => key.startsWith(p))));
}

export async function findOpenPr({ execFile, repoRoot, branch }) {
  const { stdout } = await execFile('gh', ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url'], { cwd: repoRoot });
  const list = JSON.parse(stdout || '[]');
  return list[0]?.url ?? null;
}

const lastLine = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean).at(-1) ?? '';

export function createDispatcher({ spawn, execFile, paths, repoRoot, config, tracker, promptTemplate, isPidAlive = defaultIsPidAlive, now = () => new Date().toISOString(), orphanPollMs = DEFAULT_ORPHAN_POLL_MS, closeGraceMs = DEFAULT_CLOSE_GRACE_MS }) {
  let running = null;
  const pending = [];

  function startNextPending() {
    const next = pending.shift();
    if (next === undefined) return;
    // Claimed synchronously, in the same tick as the shift, so a call to enqueue that
    // interleaves with this one sees running already set and queues instead of spawning.
    running = next.id;
    start(next.id, next.model).catch(async (err) => {
      // Without this, a prepare() failure here (most often a recovered dispatch whose
      // in-memory model was lost across a restart, see recoverOnStart) left the defect's
      // on-disk state at 'queued' forever: the only report was this console line, and the UI
      // only enables Dispatch again from 'failed' or 'pr-open'. Recording the failure here
      // puts it back in a state the tester can retry from.
      try {
        await patchDispatch(paths, next.id, { state: 'failed', endedAt: now(), error: err.message });
      } catch (writeErr) {
        console.error(`qa-desk: could not record the start failure for ${next.id}: ${writeErr.message}`);
      }
      console.error(`qa-desk: could not start the next queued dispatch ${next.id}: ${err.message}`);
    });
  }

  /**
   * `fallbackError` lets the orphan poll below reuse this same PR lookup and
   * state write while keeping its own wording when no pull request is found,
   * instead of the generic "no open pull request... Last output:" message
   * that makes sense only for a dispatch that just produced live output.
   */
  async function finish(defectId, branch, tail, { fallbackError } = {}) {
    let pr = null;
    let lookupError = null;
    try { pr = await findOpenPr({ execFile, repoRoot, branch }); } catch (err) { lookupError = err.message; }
    const defaultError = `no open pull request on ${branch}. Last output: ${lastLine(tail)}${lookupError ? ` (gh pr list failed: ${lookupError})` : ''}`;
    const error = pr ? null : (fallbackError ?? defaultError);
    await patchDispatch(paths, defectId, { state: pr ? 'pr-open' : 'failed', endedAt: now(), pr, error });
    running = null;
    startNextPending();
  }

  async function prepare(defect, model) {
    const { issueId } = defect;
    await mkdir(paths.logs, { recursive: true });
    const promptFile = join(paths.logs, `${issueId}.prompt.md`);
    await writeFile(promptFile, renderFixPrompt({ template: promptTemplate, issueId, config, tracker, repoRoot }), 'utf8');
    const vars = { issueId, promptFile, repoRoot };
    // A model never reaches the argv unless the configured template asks for one; a model
    // supplied when it does not is silently ignored (the ruling from planning). When the
    // template does ask for one, it must be a member of the allowlist checked here, on the
    // server, never trusting the browser to have already filtered it.
    if (agentHasModelToken(config.agent)) {
      if (!config.agentModels.includes(model)) throw new Error(`model "${model}" is not in the configured agentModels allowlist`);
      vars.model = model;
    }
    const argv = substituteArgv(config.agent, vars);
    return { argv, log: join(paths.logs, `${issueId}.log`), branch: `${config.branchPrefix}${issueId}` };
  }

  function attach(child, { defectId, branch, stream }) {
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    let tail = '';
    let settled = false;
    let graceTimer = null;
    const appendTail = (text) => { tail = (tail + text).slice(-MAX_TAIL_CHARS); };
    child.stdout.on('data', (buf) => { appendTail(outDecoder.write(buf)); stream.write(buf); });
    // A failure reported only on stderr must still surface as "the last log line", or a fix
    // agent that never touches stdout produces an empty, useless error message.
    child.stderr.on('data', (buf) => { appendTail(errDecoder.write(buf)); stream.write(buf); });
    const stopGrace = () => { if (graceTimer) { clearTimeout(graceTimer); graceTimer = null; } };
    const complete = () => {
      if (settled) return;
      settled = true; stopGrace(); stream.end();
      finish(defectId, branch, tail + outDecoder.end() + errDecoder.end()).catch((err) => { console.error(`qa-desk: could not record the end of ${defectId}: ${err.message}`); running = null; startNextPending(); });
    };
    child.on('exit', () => {
      if (settled || graceTimer) return;
      // A grandchild holding the stdout pipe can keep close from ever firing.
      graceTimer = setTimeout(complete, closeGraceMs);
      graceTimer.unref?.();
    });
    child.on('close', complete);
    child.on('error', (err) => {
      if (settled) return;
      settled = true; stopGrace(); stream.end();
      patchDispatch(paths, defectId, { state: 'failed', endedAt: now(), error: err.message })
        .catch((writeErr) => console.error(`qa-desk: could not record the spawn failure for ${defectId}: ${writeErr.message}`))
        .finally(() => { running = null; startNextPending(); });
    });
  }

  // The issue id feeds a file name and an argv, so do not trust it just because the tracker
  // returned it.
  function assertDispatchable(defect, defectId) {
    if (!defect) throw new Error(`unknown defect ${defectId}`);
    if (!ISSUE_ID_RE.test(String(defect.issueId))) throw new Error(`issue id ${defect.issueId} is not a plain identifier`);
  }

  /**
   * `running` must already be claimed for `defectId` by the caller (either
   * `enqueue` or `startNextPending`), synchronously and before this function's
   * first await. Doing the claim here instead would leave a window between
   * that claim and the caller's own synchronous check, where a second
   * enqueue racing in the same tick could see `running` still null.
   */
  async function start(defectId, model) {
    let child;
    let stream;
    let prepared;
    try {
      const defect = await getDefect(paths, defectId);
      assertDispatchable(defect, defectId);
      prepared = await prepare(defect, model);
      stream = createWriteStream(prepared.log, { flags: 'a' });
      stream.on('error', (err) => console.error(`qa-desk: could not write the dispatch log for ${defectId}: ${err.message}`));
      const [cmd, ...args] = prepared.argv;
      child = spawn(cmd, args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: buildChildEnv(process.env, config.agentEnvStrip), shell: false });
    } catch (err) {
      stream?.destroy();
      running = null;
      startNextPending();
      throw err;
    }
    attach(child, { defectId, branch: prepared.branch, stream });
    await patchDispatch(paths, defectId, { state: 'running', pid: child.pid, startedAt: now(), endedAt: null, branch: prepared.branch, pr: null, log: prepared.log, error: null });
    return { state: 'running' };
  }

  /**
   * One fix agent runs at a time. A defect enqueued while another is running
   * joins a pending list and is marked "queued" instead of being refused;
   * `finish` (and the spawn-error path) drains that list as soon as the
   * server is idle again, one at a time, in the order they were enqueued.
   *
   * The membership check and the claim that follows it (either pushing onto
   * `pending` or setting `running`) happen synchronously, before any `await`
   * in this function. That closes two races: a defect already running or
   * queued being dispatched again (a double click on Dispatch), and two
   * enqueues of different defects both reading `running` as null and both
   * spawning.
   */
  async function enqueue(defectId, { model } = {}) {
    if (running === defectId || pending.some((p) => p.id === defectId)) {
      throw new Error(`dispatch already running for ${defectId}`);
    }
    if (running !== null) {
      pending.push({ id: defectId, model });
      try {
        const defect = await getDefect(paths, defectId);
        assertDispatchable(defect, defectId);
        await patchDispatch(paths, defectId, { state: 'queued', error: null });
        return { state: 'queued' };
      } catch (err) {
        const idx = pending.findIndex((p) => p.id === defectId);
        if (idx !== -1) pending.splice(idx, 1);
        throw err;
      }
    }
    running = defectId;
    return start(defectId, model);
  }

  function adoptOrphan(defectId, pid, branch) {
    if (running === null) running = defectId;
    const timer = setInterval(() => {
      if (isPidAlive(pid)) return;
      clearInterval(timer);
      // The spec decides success by finding an open pull request on the deterministic
      // branch, which is exactly what makes this work across a restart: an agent that
      // finished after the restart still gets reported as pr-open, not failed.
      finish(defectId, branch, '', { fallbackError: ORPHAN_ERROR })
        .catch((err) => { console.error(`qa-desk: could not record the end of orphan ${defectId}: ${err.message}`); running = null; startNextPending(); });
    }, orphanPollMs);
    timer.unref?.();
  }

  async function recoverOnStart() {
    const all = await listDefects(paths);
    const stale = all.filter((d) => d.dispatch?.state === 'running');
    const dead = [];
    for (const d of stale) {
      if (isPidAlive(d.dispatch.pid)) { adoptOrphan(d.id, d.dispatch.pid, d.dispatch.branch); continue; }
      await patchDispatch(paths, d.id, { state: 'failed', endedAt: now(), error: 'server restarted' });
      dead.push(d.id);
    }
    // A defect left "queued" across a restart is otherwise stranded: `pending` is in-memory
    // only, and the UI disables Dispatch for anything but failed/pr-open, so nothing on disk
    // or on screen can recover it without this. `listDefects` preserves creation order, which
    // doubles as enqueue order for defects that were never re-ordered, so this is oldest first.
    // A restart loses the in-memory queue, model included: a defect recovered here re-starts
    // with no model, which `prepare` then refuses if the template needs one. That is an
    // acceptable, rare edge of a best-effort recovery path, not a silent wrong dispatch.
    const queued = all.filter((d) => d.dispatch?.state === 'queued').map((d) => ({ id: d.id, model: undefined }));
    pending.push(...queued);
    if (running === null) startNextPending();
    return dead;
  }

  return { enqueue, recoverOnStart, current: () => running };
}

function defaultIsPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
