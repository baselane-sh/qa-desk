import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { EventEmitter } from 'node:events';
import { createApp, checkRequest, execFileWithInput, gitUserName } from '../scripts/server.mjs';
import { createDispatcher } from '../scripts/lib/dispatch.mjs';
import { writeJsonAtomic } from '../scripts/lib/store.mjs';
import { dataPaths } from '../scripts/lib/paths.mjs';
import { createDefect, patchDispatch } from '../scripts/lib/defects.mjs';
import { TEST_CONFIG, sampleCase } from './fixtures/config.mjs';

async function boot({ tracker, dispatcher, dispatcherFactory } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'srv-'));
  const paths = dataPaths(root);
  await mkdir(paths.dir, { recursive: true });
  await writeJsonAtomic(paths.cases, [sampleCase(), sampleCase({ id: 'QA-0002', title: 'Second' })]);
  const publicDir = join(root, 'public');
  await mkdir(join(publicDir, 'views'), { recursive: true });
  await writeFile(join(publicDir, 'index.html'), '<title>qa-desk</title>');
  await writeFile(join(publicDir, 'views/cases.js'), 'export const x = 1;');
  const app = createApp({
    config: TEST_CONFIG, paths, publicDir, executedBy: 'tester',
    tracker: tracker ?? { name: 'github', create: async () => ({ id: '17', url: 'https://github.com/o/r/issues/17' }), show: async () => ({ id: '17', url: 'u', state: 'open', notes: '' }) },
    // dispatcherFactory lets a test build a real dispatcher once it knows this boot's paths
    // and root, so a dispatch route exercises the actual queue guard instead of a mock.
    dispatcher: dispatcherFactory ? dispatcherFactory({ paths, root }) : (dispatcher ?? { enqueue: async () => ({ state: 'running' }), current: () => null }),
  });
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text, type: res.headers.get('content-type') };
  };
  return { call, paths, root, port: app.address().port, close: () => new Promise((r) => app.close(r)) };
}

async function makeRun(s, caseIds = ['QA-0001', 'QA-0002']) {
  const r = await s.call('POST', '/api/runs', { name: 'Sprint 3', build: 'v1', env: 'staging', caseIds });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
}

test('static files: index, nested js with the right type, traversal and unknown types refused', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const index = await s.call('GET', '/');
  assert.match(index.body, /<title>qa-desk/); assert.match(index.type, /text\/html/);
  const js = await s.call('GET', '/views/cases.js');
  assert.match(js.type, /javascript/); assert.equal(js.body, 'export const x = 1;');
  assert.equal((await s.call('GET', '/../package.json')).status, 404);
  assert.equal((await s.call('GET', '/%2e%2e/package.json')).status, 404);
  assert.equal((await s.call('GET', '/nope.txt')).status, 404);
  assert.equal((await s.call('GET', '/%')).status, 404);
});

test('GET /api/config and /api/cases', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  assert.equal((await s.call('GET', '/api/config')).body.data.project, 'QA');
  assert.equal((await s.call('GET', '/api/config')).body.data.agentModelsUsable, false);
  const r = await s.call('GET', '/api/cases');
  assert.equal(r.body.data.length, 2);
  assert.equal(r.body.data[0].execution, undefined);
});

test('runs: create, list, get, execution, cases with runId, history', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  const run = await makeRun(s);
  assert.equal(run.id, 'R-0001');
  assert.equal((await s.call('POST', '/api/runs', { name: 'x', build: 'b', env: 'staging', caseIds: ['QA-0099'] })).status, 400);
  assert.equal((await s.call('GET', '/api/runs')).body.data.length, 1);
  const e = await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'failed', actual: 'boom' });
  assert.equal(e.status, 200); assert.equal(e.body.data.executedBy, 'tester');
  assert.equal((await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'nope' })).status, 400);
  assert.equal((await s.call('PUT', '/api/runs/R-0001/executions/QA-0099', { status: 'passed' })).status, 400);
  const got = await s.call('GET', '/api/runs/R-0001');
  assert.equal(got.body.data.executions['QA-0001'].status, 'failed');
  const cases = await s.call('GET', '/api/cases?runId=R-0001');
  assert.equal(cases.body.data[0].execution.status, 'failed');
  assert.equal(cases.body.data[1].execution, null);
  assert.equal((await s.call('GET', '/api/cases/QA-0001/history')).body.data.length, 1);
  assert.equal((await s.call('GET', '/api/runs/R-0009')).status, 404);
});

test('a run closes once, keeps its record, and then refuses executions', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  await makeRun(s);
  const closed = await s.call('POST', '/api/runs/R-0001/close');
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(typeof closed.body.data.closedAt, 'string');
  assert.equal((await s.call('POST', '/api/runs/R-0001/close')).status, 409);
  assert.equal((await s.call('POST', '/api/runs/R-0009/close')).status, 404);
  assert.equal((await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'passed' })).status, 409);
  const list = await s.call('GET', '/api/runs');
  assert.equal(list.body.data.length, 1);
  assert.equal(list.body.data[0].closedAt, closed.body.data.closedAt);
});

test('an execution with no status is rejected until one exists, then a status-free patch is fine', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  await makeRun(s);
  assert.equal((await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', {})).status, 400);
  assert.equal((await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { actual: 'still setting up' })).status, 400);
  const first = await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'failed' });
  assert.equal(first.status, 200);
  const second = await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { actual: 'more detail' });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.status, 'failed');
});

test('defects: needs a failed or blocked execution, creates once, shows with issue, dispatches', async (t) => {
  const created = [];
  const s = await boot({ tracker: { name: 'github', create: async (x) => { created.push(x); return { id: '17', url: 'https://github.com/o/r/issues/17' }; }, show: async () => ({ id: '17', url: 'u', state: 'open', notes: 'n' }) } });
  t.after(() => s.close());
  await makeRun(s);
  assert.equal((await s.call('POST', '/api/defects', { runId: 'R-0001', caseId: 'QA-0001' })).status, 400);
  await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'failed', actual: 'boom' });
  const d = await s.call('POST', '/api/defects', { runId: 'R-0001', caseId: 'QA-0001' });
  assert.equal(d.status, 200); assert.equal(d.body.data.id, 'D-0001'); assert.equal(d.body.data.issueId, '17');
  assert.equal(created[0].title, '[QA] Login with a valid OTP failed in Sprint 3');
  assert.deepEqual(created[0].labels, ['qa-desk', 'auth', 'P1', 'major']);
  assert.match(created[0].body, /## Actual result\n```\nboom\n```/);
  assert.equal((await s.call('POST', '/api/defects', { runId: 'R-0001', caseId: 'QA-0001' })).status, 409);
  assert.equal((await s.call('GET', '/api/cases?runId=R-0001')).body.data[0].defectId, 'D-0001');
  const shown = await s.call('GET', '/api/defects/D-0001');
  assert.equal(shown.body.data.issue.notes, 'n');
  assert.equal((await s.call('POST', '/api/defects/D-0001/dispatch')).body.data.state, 'running');
  assert.equal((await s.call('GET', '/api/defects/D-0009')).status, 404);
});

test('defects created against the beads tracker carry only qa-desk and component labels', async (t) => {
  const created = [];
  const s = await boot({ tracker: { name: 'beads', create: async (x) => { created.push(x); return { id: '9', url: null }; }, show: async () => ({ id: '9', url: null, state: 'open', notes: '' }) } });
  t.after(() => s.close());
  await makeRun(s);
  await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'failed', actual: 'boom' });
  await s.call('POST', '/api/defects', { runId: 'R-0001', caseId: 'QA-0001' });
  assert.deepEqual(created[0].labels, ['qa-desk', 'auth']);
});

function fakeSpawn() {
  const children = [];
  const spawn = () => {
    const child = new EventEmitter();
    child.pid = 4242; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    children.push(child);
    return child;
  };
  return { spawn, children };
}

test('dispatch refusals map to 409 through the real dispatcher, and the log is served only from the log dir', async (t) => {
  const { spawn, children } = fakeSpawn();
  const execFile = async () => ({ stdout: '[]', stderr: '' });
  const s = await boot({
    dispatcherFactory: ({ paths, root }) => createDispatcher({
      spawn, execFile, paths, repoRoot: root, config: TEST_CONFIG,
      tracker: { readCommand: () => ['gh'], noteCommand: () => ['gh'] },
      promptTemplate: 'fix {issueId}', now: () => '2026-09-12T12:00:00.000Z',
    }),
  });
  t.after(() => { children.forEach((c) => { c.emit('exit', 0); c.emit('close', 0); }); return s.close(); });
  await createDefect(s.paths, { runId: 'R-0001', caseId: 'QA-0001', tracker: 'github', issueId: '17', url: 'u' });
  const first = await s.call('POST', '/api/defects/D-0001/dispatch');
  assert.equal(first.status, 200);
  assert.equal(first.body.data.state, 'running');
  // The dispatcher, not a mock, refuses the duplicate: this is the guard NEW-1 restored.
  const second = await s.call('POST', '/api/defects/D-0001/dispatch');
  assert.equal(second.status, 409);
  await mkdir(s.paths.logs, { recursive: true });
  await writeFile(join(s.paths.logs, '17.log'), 'a\nb\nc\n');
  await patchDispatch(s.paths, 'D-0001', { state: 'running', log: join(s.paths.logs, '17.log') });
  const log = await s.call('GET', '/api/defects/D-0001/log');
  assert.match(log.type, /text\/plain/); assert.equal(log.body, 'a\nb\nc\n');
  await patchDispatch(s.paths, 'D-0001', { log: '/etc/passwd' });
  assert.equal((await s.call('GET', '/api/defects/D-0001/log')).status, 400);
});

test('the dispatch route reads a model from the body and passes it to the dispatcher', async (t) => {
  const calls = [];
  const s = await boot({ dispatcher: { enqueue: async (id, opts) => { calls.push([id, opts]); return { state: 'running' }; }, current: () => null } });
  t.after(() => s.close());
  await createDefect(s.paths, { runId: 'R-0001', caseId: 'QA-0001', tracker: 'github', issueId: '17', url: 'u' });
  const r = await s.call('POST', '/api/defects/D-0001/dispatch', { model: 'sonnet' });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0], ['D-0001', { model: 'sonnet' }]);
});

test('dispatching a model outside the allowlist is refused with 400, through the real dispatcher, and nothing is spawned', async (t) => {
  const { spawn, children } = fakeSpawn();
  const execFile = async () => ({ stdout: '[]', stderr: '' });
  const config = { ...TEST_CONFIG, agent: ['claude', '--model', '{model}', 'Fix {issueId}'], agentModels: ['sonnet'] };
  const s = await boot({
    dispatcherFactory: ({ paths, root }) => createDispatcher({
      spawn, execFile, paths, repoRoot: root, config,
      tracker: { readCommand: () => ['gh'], noteCommand: () => ['gh'] },
      promptTemplate: 'fix {issueId}', now: () => '2026-09-12T12:00:00.000Z',
    }),
  });
  t.after(() => s.close());
  await createDefect(s.paths, { runId: 'R-0001', caseId: 'QA-0001', tracker: 'github', issueId: '17', url: 'u' });
  const r = await s.call('POST', '/api/defects/D-0001/dispatch', { model: 'evil; rm -rf /' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /model/);
  assert.equal(children.length, 0);
});

test('checkRequest refuses foreign origins, hosts and non-JSON writes', () => {
  const ok = { host: '127.0.0.1', port: 4173 };
  assert.equal(checkRequest({ method: 'GET', headers: { host: 'localhost:4173' } }, ok), null);
  assert.equal(checkRequest({ method: 'GET', headers: { host: 'evil.test:4173' } }, ok).status, 403);
  assert.equal(checkRequest({ method: 'GET', headers: { host: '127.0.0.1:4173', origin: 'http://evil.test' } }, ok).status, 403);
  assert.equal(checkRequest({ method: 'POST', headers: { host: '127.0.0.1:4173', 'content-type': 'text/plain' } }, ok).status, 415);
});

test('a foreign Host header gets 403 over the wire', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  // fetch drops a forbidden Host header, so use http.request with setHost off.
  const status = await new Promise((resolveStatus, rejectStatus) => {
    const req = request({ host: '127.0.0.1', port: s.port, path: '/api/config', method: 'GET', setHost: false, headers: { host: 'evil.test:1' } }, (res) => { res.resume(); resolveStatus(res.statusCode); });
    req.on('error', rejectStatus);
    req.end();
  });
  assert.equal(status, 403);
});

test('execFileWithInput writes stdin and surfaces stderr on failure', async () => {
  const out = await execFileWithInput('cat', [], { input: 'hello' });
  assert.equal(out.stdout, 'hello');
  await assert.rejects(execFileWithInput('sh', ['-c', 'echo bad >&2; exit 3'], {}), (e) => /bad/.test(e.stderr));
});

test('an execution carries evidence and an env override into the defect body', async (t) => {
  const created = [];
  const s = await boot({ tracker: { name: 'github', create: async (x) => { created.push(x); return { id: '21', url: 'https://github.com/o/r/issues/21' }; }, show: async () => ({ id: '21', url: 'u', state: 'open', notes: '' }) } });
  t.after(() => s.close());
  await makeRun(s);
  const e = await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'failed', actual: 'boom', evidence: 'logs/app.log line 42', env: 'prod', locale: 'any' });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal(e.body.data.evidence, 'logs/app.log line 42');
  assert.equal(e.body.data.env, 'prod');
  assert.equal(e.body.data.locale, 'any');
  assert.equal((await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { env: 'moon' })).status, 400);
  assert.equal((await s.call('POST', '/api/defects', { runId: 'R-0001', caseId: 'QA-0001' })).status, 200);
  assert.match(created[0].body, /Environment: prod/);
  assert.match(created[0].body, /Locale: any/);
  assert.match(created[0].body, /## Evidence\n/);
  assert.match(created[0].body, /logs\/app\.log line 42/);
});

test('runs carry a status summary in the list and in the detail', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  await makeRun(s);
  await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'passed' });
  const list = await s.call('GET', '/api/runs');
  assert.equal(list.body.data[0].summary.total, 2);
  assert.equal(list.body.data[0].summary.executed, 1);
  assert.deepEqual(list.body.data[0].summary.counts, { passed: 1, failed: 0, blocked: 0, skipped: 0, retest: 0, untested: 1 });
  const one = await s.call('GET', '/api/runs/R-0001');
  assert.equal(one.body.data.summary.executed, 1);
  assert.equal(one.body.data.executions['QA-0001'].status, 'passed');
});

test('GET /api/cases attaches the latest execution per open run and drops closed runs', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  await makeRun(s, ['QA-0001']);
  await makeRun(s, ['QA-0001', 'QA-0002']);
  await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'passed' });
  const before = (await s.call('GET', '/api/cases')).body.data;
  assert.deepEqual(Object.keys(before[0].latestByRun), ['R-0001', 'R-0002']);
  assert.equal(before[0].latestByRun['R-0001'].status, 'passed');
  assert.equal(before[0].latestByRun['R-0002'], null);
  assert.deepEqual(Object.keys(before[1].latestByRun), ['R-0002']);
  assert.equal(before[0].execution, undefined);
  await s.call('POST', '/api/runs/R-0001/close');
  const after = (await s.call('GET', '/api/cases')).body.data;
  assert.deepEqual(Object.keys(after[0].latestByRun), ['R-0002']);
  const inRun = (await s.call('GET', '/api/cases?runId=R-0002')).body.data;
  assert.equal(inRun[0].latestByRun, undefined);
  assert.equal(inRun[0].execution, null);
});

test('case history carries the run name across runs', async (t) => {
  const s = await boot();
  t.after(() => s.close());
  await makeRun(s);
  await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'failed', actual: 'boom' });
  await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'retest' });
  const history = (await s.call('GET', '/api/cases/QA-0001/history')).body.data;
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((h) => h.status), ['failed', 'retest']);
  assert.deepEqual(history.map((h) => h.runName), ['Sprint 3', 'Sprint 3']);
  assert.equal(history[0].runId, 'R-0001');
  assert.equal((await s.call('GET', '/api/cases/QA-9999/history')).status, 404);
  await s.close();
});

test('executedBy comes from git config user.name and falls back to unknown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gituser-'));
  await execFileWithInput('git', ['init', '-q'], { cwd: root });
  await execFileWithInput('git', ['config', 'user.name', 'Ada Lovelace'], { cwd: root });
  assert.equal(await gitUserName(root), 'Ada Lovelace');
  assert.equal(await gitUserName(join(root, 'no-such-directory')), 'unknown');
  const source = await readFile(new URL('../scripts/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /executedBy: await gitUserName\(repoRoot\)/, 'startServer must pass the git name as executedBy');
});

test('a dispatch body of the literal null is refused cleanly, not with a server error (M4)', async (t) => {
  const s = await boot({ tracker: { name: 'github', create: async () => ({ id: '17', url: 'u' }), show: async () => ({ id: '17', url: 'u', state: 'open', notes: '' }) } });
  t.after(() => s.close());
  await makeRun(s);
  await s.call('PUT', '/api/runs/R-0001/executions/QA-0001', { status: 'failed', actual: 'boom' });
  await s.call('POST', '/api/defects', { runId: 'R-0001', caseId: 'QA-0001' });
  // The call helper drops a falsy body entirely, so the raw request is sent here: readBody
  // returns {} only for an EMPTY body, and parses a body of `null` to null, which used to
  // destructure to a TypeError and so a 500.
  const res = await fetch(`http://127.0.0.1:${s.port}/api/defects/D-0001/dispatch`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null',
  });
  assert.notEqual(res.status, 500, 'a null body must not reach the caller as a server error');
  assert.equal(res.status, 200, 'a null body carries no model, which is the same as sending none');
});
