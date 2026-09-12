import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createApp, checkRequest, execFileWithInput } from '../scripts/server.mjs';
import { writeJsonAtomic } from '../scripts/lib/store.mjs';
import { dataPaths } from '../scripts/lib/paths.mjs';
import { createDefect, patchDispatch } from '../scripts/lib/defects.mjs';
import { TEST_CONFIG, sampleCase } from './fixtures/config.mjs';

async function boot({ tracker, dispatcher } = {}) {
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
    dispatcher: dispatcher ?? { enqueue: async () => ({ state: 'running' }), current: () => null },
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

test('static files: index, nested js with the right type, traversal and unknown types refused', async () => {
  const s = await boot();
  const index = await s.call('GET', '/');
  assert.match(index.body, /<title>qa-desk/); assert.match(index.type, /text\/html/);
  const js = await s.call('GET', '/views/cases.js');
  assert.match(js.type, /javascript/); assert.equal(js.body, 'export const x = 1;');
  assert.equal((await s.call('GET', '/../package.json')).status, 404);
  assert.equal((await s.call('GET', '/%2e%2e/package.json')).status, 404);
  assert.equal((await s.call('GET', '/nope.txt')).status, 404);
  await s.close();
});

test('GET /api/config and /api/cases', async () => {
  const s = await boot();
  assert.equal((await s.call('GET', '/api/config')).body.data.project, 'QA');
  const r = await s.call('GET', '/api/cases');
  assert.equal(r.body.data.length, 2);
  assert.equal(r.body.data[0].execution, undefined);
  await s.close();
});

test('runs: create, list, get, execution, cases with runId, history', async () => {
  const s = await boot();
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
  await s.close();
});

test('defects: needs a failed or blocked execution, creates once, shows with issue, dispatches', async () => {
  const created = [];
  const s = await boot({ tracker: { name: 'github', create: async (x) => { created.push(x); return { id: '17', url: 'https://github.com/o/r/issues/17' }; }, show: async () => ({ id: '17', url: 'u', state: 'open', notes: 'n' }) } });
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
  await s.close();
});

test('dispatch refusals map to 409 and the log is served only from the log dir', async () => {
  const s = await boot({ dispatcher: { enqueue: async () => { throw new Error('dispatch already running for D-0001'); }, current: () => 'D-0001' } });
  await createDefect(s.paths, { runId: 'R-0001', caseId: 'QA-0001', tracker: 'github', issueId: '17', url: 'u' });
  assert.equal((await s.call('POST', '/api/defects/D-0001/dispatch')).status, 409);
  await mkdir(s.paths.logs, { recursive: true });
  await writeFile(join(s.paths.logs, '17.log'), 'a\nb\nc\n');
  await patchDispatch(s.paths, 'D-0001', { state: 'running', log: join(s.paths.logs, '17.log') });
  const log = await s.call('GET', '/api/defects/D-0001/log');
  assert.match(log.type, /text\/plain/); assert.equal(log.body, 'a\nb\nc\n');
  await patchDispatch(s.paths, 'D-0001', { log: '/etc/passwd' });
  assert.equal((await s.call('GET', '/api/defects/D-0001/log')).status, 400);
  await s.close();
});

test('checkRequest refuses foreign origins, hosts and non-JSON writes', () => {
  const ok = { host: '127.0.0.1', port: 4173 };
  assert.equal(checkRequest({ method: 'GET', headers: { host: 'localhost:4173' } }, ok), null);
  assert.equal(checkRequest({ method: 'GET', headers: { host: 'evil.test:4173' } }, ok).status, 403);
  assert.equal(checkRequest({ method: 'GET', headers: { host: '127.0.0.1:4173', origin: 'http://evil.test' } }, ok).status, 403);
  assert.equal(checkRequest({ method: 'POST', headers: { host: '127.0.0.1:4173', 'content-type': 'text/plain' } }, ok).status, 415);
});

test('a foreign Host header gets 403 over the wire', async () => {
  const s = await boot();
  // fetch drops a forbidden Host header, so use http.request with setHost off.
  const status = await new Promise((resolveStatus, rejectStatus) => {
    const req = request({ host: '127.0.0.1', port: s.port, path: '/api/config', method: 'GET', setHost: false, headers: { host: 'evil.test:1' } }, (res) => { res.resume(); resolveStatus(res.statusCode); });
    req.on('error', rejectStatus);
    req.end();
  });
  assert.equal(status, 403);
  await s.close();
});

test('execFileWithInput writes stdin and surfaces stderr on failure', async () => {
  const out = await execFileWithInput('cat', [], { input: 'hello' });
  assert.equal(out.stdout, 'hello');
  await assert.rejects(execFileWithInput('sh', ['-c', 'echo bad >&2; exit 3'], {}), (e) => /bad/.test(e.stderr));
});
