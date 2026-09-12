import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { substituteArgv } from './config.mjs';
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
    start(next).catch((err) => console.error(`qa-desk: could not start the next queued dispatch ${next}: ${err.message}`));
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

  async function prepare(defect) {
    const { issueId } = defect;
    await mkdir(paths.logs, { recursive: true });
    const promptFile = join(paths.logs, `${issueId}.prompt.md`);
    await writeFile(promptFile, renderFixPrompt({ template: promptTemplate, issueId, config, tracker, repoRoot }), 'utf8');
    const argv = substituteArgv(config.agent, { issueId, promptFile, repoRoot });
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

  async function start(defectId) {
    const defect = await getDefect(paths, defectId);
    if (!defect) throw new Error(`unknown defect ${defectId}`);
    running = defectId;
    let child;
    let stream;
    let prepared;
    try {
      prepared = await prepare(defect);
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
   */
  async function enqueue(defectId) {
    const defect = await getDefect(paths, defectId);
    if (!defect) throw new Error(`unknown defect ${defectId}`);
    // The issue id feeds a file name and an argv, so do not trust it just because the tracker returned it.
    if (!ISSUE_ID_RE.test(String(defect.issueId))) throw new Error(`issue id ${defect.issueId} is not a plain identifier`);
    if (running) {
      pending.push(defectId);
      await patchDispatch(paths, defectId, { state: 'queued', error: null });
      return { state: 'queued' };
    }
    return start(defectId);
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
    const stale = (await listDefects(paths)).filter((d) => d.dispatch?.state === 'running');
    const dead = [];
    for (const d of stale) {
      if (isPidAlive(d.dispatch.pid)) { adoptOrphan(d.id, d.dispatch.pid, d.dispatch.branch); continue; }
      await patchDispatch(paths, d.id, { state: 'failed', endedAt: now(), error: 'server restarted' });
      dead.push(d.id);
    }
    return dead;
  }

  return { enqueue, recoverOnStart, current: () => running };
}

function defaultIsPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
