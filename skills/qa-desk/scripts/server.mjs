import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve, sep, extname, normalize } from 'node:path';
import { execFileWithInput } from './lib/exec.mjs';
import { loadConfig } from './lib/config.mjs';
import { dataPaths } from './lib/paths.mjs';
import { readJson } from './lib/store.mjs';
import { validateExecutionPatch, validateRunInput } from './lib/validate.mjs';
import { createRun, listRuns, getRun, closeRun, recordExecution, listExecutions, caseHistory } from './lib/runs.mjs';
import { createDefect, getDefect, findDefect, listDefects } from './lib/defects.mjs';
import { buildDefectTitle, buildDefectBody } from './lib/defect-body.mjs';
import { createTracker } from './lib/tracker.mjs';
import { priorityToNumber } from './lib/tracker-beads.mjs';
import { createDispatcher } from './lib/dispatch.mjs';

export { execFileWithInput };

const HOST = '127.0.0.1';
const SHOW_CACHE_MS = 10_000;
const LOG_TAIL_LINES = 200;
const MAX_BODY_BYTES = 1_048_576;
const LOOPBACK_NAMES = ['127.0.0.1', 'localhost'];
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const DEFECT_STATUSES = ['failed', 'blocked'];

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function allowedAuthorities(host, port) {
  const names = LOOPBACK_NAMES.includes(host) ? LOOPBACK_NAMES : [host];
  return names.map((name) => `${name}:${port}`);
}

/**
 * Keep other web pages out. Binding to loopback stops other machines, not
 * other origins in the person's own browser, and a dispatch runs an agent
 * with broad permissions on this machine. Requiring JSON on every write also
 * forces a preflight, which the origin check then refuses.
 */
export function checkRequest(req, { host, port }) {
  const allowed = allowedAuthorities(host, port);
  const origin = req.headers.origin;
  if (origin && !allowed.some((authority) => origin === `http://${authority}`)) return { status: 403, error: 'this portal answers its own origin only' };
  if (!allowed.includes(req.headers.host)) return { status: 403, error: 'host header does not name this portal' };
  if (req.method === 'POST' || req.method === 'PUT') {
    const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') return { status: 415, error: 'content-type must be application/json' };
  }
  return null;
}

function send(res, status, payload, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(payload) : payload);
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
    chunks.push(c);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'body must be JSON'); }
}

async function serveStatic(publicDir, pathname) {
  let rel;
  try { rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1)); } catch { throw new HttpError(404, 'not found'); }
  const type = STATIC_TYPES[extname(rel)];
  const root = resolve(publicDir) + sep;
  const full = resolve(publicDir, normalize(rel));
  if (!type || !full.startsWith(root)) throw new HttpError(404, 'not found');
  try { return { type, body: await readFile(full) }; } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new HttpError(404, 'not found');
    throw err;
  }
}

export function createApp({ config, paths, publicDir, tracker, dispatcher, executedBy, host = HOST, port = null }) {
  const showCache = new Map();
  let chain = Promise.resolve();
  const serialize = (fn) => { const next = chain.then(fn); chain = next.catch(() => {}); return next; };

  const loadCases = () => readJson(paths.cases, []);
  async function loadCase(id) {
    const found = (await loadCases()).find((c) => c.id === id);
    if (!found) throw new HttpError(404, `unknown case ${id}`);
    return found;
  }
  async function loadRun(id) {
    const run = await getRun(paths, id);
    if (!run) throw new HttpError(404, `unknown run ${id}`);
    return run;
  }
  async function loadDefect(id) {
    const d = await getDefect(paths, id);
    if (!d) throw new HttpError(404, `unknown defect ${id}`);
    return d;
  }

  async function casesRoute(url) {
    const cases = await loadCases();
    const runId = url.searchParams.get('runId');
    if (!runId) return cases;
    await loadRun(runId);
    const latest = await listExecutions(paths, runId);
    const defects = new Map((await listDefects(paths)).filter((d) => d.runId === runId).map((d) => [d.caseId, d.id]));
    return cases.map((c) => ({ ...c, execution: latest.get(c.id) ?? null, defectId: defects.get(c.id) ?? null }));
  }

  async function createRunRoute(req) {
    const v = validateRunInput(await readBody(req), config);
    if (!v.ok) throw new HttpError(400, v.error);
    const known = new Set((await loadCases()).map((c) => c.id));
    const missing = v.value.caseIds.filter((id) => !known.has(id));
    if (missing.length) throw new HttpError(400, `unknown case ids: ${missing.join(', ')}`);
    return createRun(paths, v.value);
  }

  async function closeRunRoute(id) {
    await loadRun(id);
    try { return await closeRun(paths, id); } catch (err) {
      if (/already closed/.test(err.message)) throw new HttpError(409, err.message);
      throw err;
    }
  }

  async function executionRoute(req, runId, caseId) {
    const v = validateExecutionPatch(await readBody(req), config);
    if (!v.ok) throw new HttpError(400, v.error);
    const run = await loadRun(runId);
    if (!run.caseIds.includes(caseId)) throw new HttpError(400, `case ${caseId} is not in run ${runId}`);
    const previous = (await listExecutions(paths, runId)).get(caseId);
    // untested is the absence of a record, not a record with no status: a status-free row
    // would otherwise be counted as executed by coverage and reports.
    if (!previous && v.value.status === undefined) throw new HttpError(400, 'status is required for the first execution of a case');
    try { return await recordExecution(paths, { runId, caseId, ...v.value }, { executedBy }); } catch (err) {
      if (/is closed/.test(err.message)) throw new HttpError(409, err.message);
      throw err;
    }
  }

  async function createDefectRoute(req) {
    const { runId, caseId } = await readBody(req);
    if (typeof runId !== 'string' || typeof caseId !== 'string') throw new HttpError(400, 'runId and caseId are required');
    const run = await loadRun(runId);
    const c = await loadCase(caseId);
    const execution = (await listExecutions(paths, runId)).get(caseId);
    if (!execution || !DEFECT_STATUSES.includes(execution.status)) throw new HttpError(400, `case ${caseId} has no failed or blocked execution in ${runId}`);
    // serialize keeps check-then-create atomic, so a double click cannot make two issues.
    return serialize(async () => {
      const existing = await findDefect(paths, runId, caseId);
      if (existing) throw new HttpError(409, `${caseId} in ${runId} already has defect ${existing.id}`);
      // Beads already carries priority as a dedicated field (see priorityToNumber below), so
      // only GitHub Issues needs priority and severity spelled out as labels too.
      const labels = tracker.name === 'beads' ? ['qa-desk', c.component] : ['qa-desk', c.component, c.priority, c.severity];
      const issue = await tracker.create({ title: buildDefectTitle(c, run), body: buildDefectBody({ case: c, run, execution, config }), labels, priority: priorityToNumber(c.priority, config) });
      return createDefect(paths, { runId, caseId, tracker: tracker.name, issueId: issue.id, url: issue.url });
    });
  }

  async function showDefectRoute(id) {
    const d = await loadDefect(id);
    const hit = showCache.get(d.issueId);
    if (hit) {
      if (Date.now() - hit.at < SHOW_CACHE_MS) return { ...d, issue: hit.value };
      showCache.delete(d.issueId);
    }
    const value = await tracker.show(d.issueId);
    showCache.set(d.issueId, { at: Date.now(), value });
    return { ...d, issue: value };
  }

  async function dispatchRoute(id) {
    await loadDefect(id);
    try { return await dispatcher.enqueue(id); } catch (err) {
      if (/already running/.test(err.message)) throw new HttpError(409, err.message);
      if (/not a plain identifier/.test(err.message)) throw new HttpError(400, err.message);
      throw err;
    }
  }

  async function logRoute(id) {
    const d = await loadDefect(id);
    const log = d.dispatch?.log;
    if (!log) throw new HttpError(404, `defect ${id} has no dispatch log`);
    const root = resolve(paths.logs) + sep;
    if (!resolve(log).startsWith(root)) throw new HttpError(400, 'dispatch log path is outside the log directory');
    let text = '';
    try { text = await readFile(log, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return { type: 'text/plain; charset=utf-8', body: text.split('\n').slice(-LOG_TAIL_LINES).join('\n') };
  }

  const routes = [
    ['GET', /^\/api\/config$/, async () => config],
    ['GET', /^\/api\/cases$/, async (req, [], url) => casesRoute(url)],
    ['GET', /^\/api\/cases\/([\w-]+)\/history$/, async (req, [id]) => { await loadCase(id); return caseHistory(paths, id); }],
    ['GET', /^\/api\/runs$/, async () => listRuns(paths)],
    ['POST', /^\/api\/runs$/, async (req) => createRunRoute(req)],
    ['POST', /^\/api\/runs\/([\w-]+)\/close$/, async (req, [id]) => closeRunRoute(id)],
    ['GET', /^\/api\/runs\/([\w-]+)$/, async (req, [id]) => ({ ...(await loadRun(id)), executions: Object.fromEntries(await listExecutions(paths, id)) })],
    ['PUT', /^\/api\/runs\/([\w-]+)\/executions\/([\w-]+)$/, async (req, [runId, caseId]) => executionRoute(req, runId, caseId)],
    ['POST', /^\/api\/defects$/, async (req) => createDefectRoute(req)],
    ['GET', /^\/api\/defects\/([\w-]+)$/, async (req, [id]) => showDefectRoute(id)],
    ['POST', /^\/api\/defects\/([\w-]+)\/dispatch$/, async (req, [id]) => dispatchRoute(id)],
    ['GET', /^\/api\/defects\/([\w-]+)\/log$/, async (req, [id]) => logRoute(id)],
    ['GET', /^\/api\/coverage$/, async () => readJson(paths.coverage, { uncovered: [], counts: {}, byComponent: {} })],
    ['GET', /^\/(?!api\/).*/, async (req, [], url) => serveStatic(publicDir, url.pathname)],
  ];

  const server = http.createServer(async (req, res) => {
    const refusal = checkRequest(req, { host, port: port ?? server.address()?.port });
    if (refusal) { res.setHeader('connection', 'close'); return send(res, refusal.status, { ok: false, error: refusal.error }); }
    const url = new URL(req.url, `http://${host}`);
    const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
    if (!route) return send(res, 404, { ok: false, error: 'not found' });
    try {
      const out = await route[2](req, url.pathname.match(route[1]).slice(1), url);
      if (out && typeof out === 'object' && 'type' in out && 'body' in out) return send(res, 200, out.body, out.type);
      return send(res, 200, { ok: true, data: out });
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (status === 413) res.once('finish', () => req.socket.destroy());
      return send(res, status, { ok: false, error: err.message });
    }
  });
  return server;
}

async function gitUserName(repoRoot) {
  try { return (await execFileWithInput('git', ['config', 'user.name'], { cwd: repoRoot })).stdout.trim() || 'unknown'; } catch { return 'unknown'; }
}

export async function startServer({ repoRoot, skillRoot }) {
  const config = await loadConfig(repoRoot);
  const paths = dataPaths(repoRoot);
  const execFile = execFileWithInput;
  try { await execFile('gh', ['auth', 'status'], { cwd: repoRoot }); } catch (err) {
    throw new Error(`gh is required for pull request detection and must be logged in.\n${err?.stderr?.trim() || err?.message}`);
  }
  const tracker = createTracker(config, { execFile, repoRoot });
  try { await tracker.check(); } catch (err) { throw new Error(`tracker ${tracker.name} is not usable: ${err.message}`); }
  const promptTemplate = await readFile(join(skillRoot, 'prompts', 'fix-agent.md'), 'utf8');
  const dispatcher = createDispatcher({ spawn, execFile, paths, repoRoot, config, tracker, promptTemplate });
  const dead = await dispatcher.recoverOnStart();
  if (dead.length) console.warn(`qa-desk: marked failed after restart: ${dead.join(', ')}`);
  if (dispatcher.current()) console.warn(`qa-desk: still running after restart, adopted: ${dispatcher.current()}`);
  const app = createApp({ config, paths, publicDir: join(skillRoot, 'public'), tracker, dispatcher, executedBy: await gitUserName(repoRoot), host: HOST, port: config.port });
  await new Promise((resolveListen, rejectListen) => { app.once('error', rejectListen); app.listen(config.port, HOST, resolveListen); });
  console.log(`qa-desk: http://${HOST}:${config.port}`);
  return app;
}
