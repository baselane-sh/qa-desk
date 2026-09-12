import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDispatcher, buildChildEnv, findOpenPr } from '../scripts/lib/dispatch.mjs';
import { createDefect, getDefect } from '../scripts/lib/defects.mjs';
import { dataPaths } from '../scripts/lib/paths.mjs';
import { TEST_CONFIG } from './fixtures/config.mjs';

const now = () => '2026-09-12T12:00:00.000Z';
const tracker = { readCommand: (id) => ['gh', 'issue', 'view', id], noteCommand: (id) => ['gh', 'issue', 'comment', id, '--body'] };

function fakeSpawn() {
  const children = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.pid = 4242; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.cmd = cmd; child.args = args; child.opts = opts;
    children.push(child);
    return child;
  };
  return { spawn, children };
}

const endChild = (child, code) => { child.emit('exit', code); child.emit('close', code); };

async function settled(dispatcher, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (dispatcher.current() !== null) {
    if (Date.now() > deadline) throw new Error('dispatcher never settled');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function setup({ prUrl = null, config = TEST_CONFIG, isPidAlive = () => false, closeGraceMs = 30_000 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'disp-'));
  const paths = dataPaths(root);
  const defect = await createDefect(paths, { runId: 'R-0001', caseId: 'QA-0001', tracker: 'github', issueId: '17', url: 'u' }, { now });
  const { spawn, children } = fakeSpawn();
  const execCalls = [];
  const execFile = async (cmd, args) => { execCalls.push({ cmd, args }); return { stdout: JSON.stringify(prUrl ? [{ url: prUrl }] : []), stderr: '' }; };
  const dispatcher = createDispatcher({ spawn, execFile, paths, repoRoot: root, config, tracker, promptTemplate: 'Fix {issueId} on {branch}\n{trackerRead}\n{trackerNote}\n{gates}\n{repoRoot}', isPidAlive, now, orphanPollMs: 10, closeGraceMs });
  return { dispatcher, children, execCalls, paths, defect, root };
}

test('buildChildEnv strips exact names and prefix patterns', () => {
  const env = buildChildEnv({ PATH: '/bin', CLAUDECODE: '1', CLAUDE_PID: '9', CLAUDE_CODE_X: 'y', OTHER: 'z' }, ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_*']);
  assert.deepEqual(env, { PATH: '/bin', OTHER: 'z' });
});

test('findOpenPr runs gh pr list with the branch and returns the first url', async () => {
  const calls = [];
  const execFile = async (cmd, args) => { calls.push({ cmd, args }); return { stdout: '[{"url":"https://github.com/o/r/pull/3"}]' }; };
  assert.equal(await findOpenPr({ execFile, repoRoot: '/r', branch: 'qa/17' }), 'https://github.com/o/r/pull/3');
  assert.deepEqual(calls[0], { cmd: 'gh', args: ['pr', 'list', '--head', 'qa/17', '--state', 'open', '--json', 'url'] });
  assert.equal(await findOpenPr({ execFile: async () => ({ stdout: '[]' }), repoRoot: '/r', branch: 'b' }), null);
});

test('enqueue spawns the config argv with placeholders filled, no shell, stripped env, and records running', async () => {
  const s = await setup();
  const out = await s.dispatcher.enqueue('D-0001');
  assert.deepEqual(out, { state: 'running' });
  const child = s.children[0];
  assert.equal(child.cmd, 'claude');
  assert.equal(child.args.at(-1), 'Fix issue 17');
  const promptFile = child.args[child.args.indexOf('--append-system-prompt-file') + 1];
  assert.equal(promptFile, join(s.paths.logs, '17.prompt.md'));
  assert.match(await readFile(promptFile, 'utf8'), /Fix 17 on qa\/17/);
  assert.equal(child.opts.shell, false);
  assert.equal(child.opts.cwd, s.root);
  assert.equal(child.opts.env.CLAUDECODE, undefined);
  const d = await getDefect(s.paths, 'D-0001');
  assert.equal(d.dispatch.state, 'running');
  assert.equal(d.dispatch.pid, 4242);
  assert.equal(d.dispatch.branch, 'qa/17');
  assert.equal(d.dispatch.log, join(s.paths.logs, '17.log'));
  assert.equal(s.dispatcher.current(), 'D-0001');
});

test('a second enqueue while running is queued, then starts once the first finishes', async () => {
  const s = await setup();
  const second = await createDefect(s.paths, { runId: 'R-0001', caseId: 'QA-0002', tracker: 'github', issueId: '18', url: 'u' }, { now });
  await s.dispatcher.enqueue('D-0001');
  const queued = await s.dispatcher.enqueue(second.id);
  assert.deepEqual(queued, { state: 'queued' });
  assert.equal((await getDefect(s.paths, second.id)).dispatch.state, 'queued');
  assert.equal(s.children.length, 1, 'the second dispatch must not spawn while the first is running');
  assert.equal(s.dispatcher.current(), 'D-0001');

  endChild(s.children[0], 0);
  const deadline = Date.now() + 3000;
  let secondDefect = await getDefect(s.paths, second.id);
  while (secondDefect.dispatch.state !== 'running') {
    if (Date.now() > deadline) throw new Error(`the queued dispatch never started (state: ${secondDefect.dispatch.state})`);
    await new Promise((r) => setTimeout(r, 5));
    secondDefect = await getDefect(s.paths, second.id);
  }
  assert.equal(s.children.length, 2);
  assert.equal(s.children[1].cmd, 'claude');
  assert.equal(s.dispatcher.current(), second.id);

  endChild(s.children[1], 0);
  await settled(s.dispatcher);
});

test('an open PR on the branch means pr-open, regardless of exit code', async () => {
  const s = await setup({ prUrl: 'https://github.com/o/r/pull/3' });
  await s.dispatcher.enqueue('D-0001');
  s.children[0].stdout.emit('data', Buffer.from('working\n'));
  endChild(s.children[0], 1);
  await settled(s.dispatcher);
  const d = await getDefect(s.paths, 'D-0001');
  assert.equal(d.dispatch.state, 'pr-open');
  assert.equal(d.dispatch.pr, 'https://github.com/o/r/pull/3');
  assert.equal(d.dispatch.error, null);
  assert.equal(d.dispatch.endedAt, now());
  assert.match(await readFile(d.dispatch.log, 'utf8'), /working/);
  assert.deepEqual(s.execCalls[0].args.slice(0, 4), ['pr', 'list', '--head', 'qa/17']);
});

test('a failure reported only on stderr still surfaces as the last log line', async () => {
  const s = await setup();
  await s.dispatcher.enqueue('D-0001');
  s.children[0].stderr.emit('data', Buffer.from('step one\nblocked: cannot reproduce\n'));
  endChild(s.children[0], 1);
  await settled(s.dispatcher);
  const d = await getDefect(s.paths, 'D-0001');
  assert.equal(d.dispatch.state, 'failed');
  assert.match(d.dispatch.error, /Last output: blocked: cannot reproduce/);
});

test('no PR means failed with the last log line as the error', async () => {
  const s = await setup();
  await s.dispatcher.enqueue('D-0001');
  s.children[0].stdout.emit('data', Buffer.from('step one\nblocked: cannot reproduce\n'));
  endChild(s.children[0], 0);
  await settled(s.dispatcher);
  const d = await getDefect(s.paths, 'D-0001');
  assert.equal(d.dispatch.state, 'failed');
  assert.equal(d.dispatch.pr, null);
  assert.match(d.dispatch.error, /no open pull request on qa\/17. Last output: blocked: cannot reproduce/);
});

test('exit without close completes after the grace timer', async () => {
  const s = await setup({ closeGraceMs: 20 });
  await s.dispatcher.enqueue('D-0001');
  s.children[0].emit('exit', 0);
  await settled(s.dispatcher);
  assert.equal((await getDefect(s.paths, 'D-0001')).dispatch.state, 'failed');
});

test('a spawn error is recorded and releases the guard', async () => {
  const s = await setup();
  await s.dispatcher.enqueue('D-0001');
  s.children[0].emit('error', new Error('ENOENT claude'));
  await settled(s.dispatcher);
  const d = await getDefect(s.paths, 'D-0001');
  assert.equal(d.dispatch.state, 'failed');
  assert.match(d.dispatch.error, /ENOENT claude/);
});

test('recoverOnStart fails dead running defects and adopts live ones', async () => {
  const s = await setup({ isPidAlive: (pid) => pid === 7 });
  const { patchDispatch, createDefect: create } = await import('../scripts/lib/defects.mjs');
  await patchDispatch(s.paths, 'D-0001', { state: 'running', pid: 999 });
  await create(s.paths, { runId: 'R-0001', caseId: 'QA-0002', tracker: 'github', issueId: '18', url: 'u' }, { now });
  await patchDispatch(s.paths, 'D-0002', { state: 'running', pid: 7 });
  const dead = await s.dispatcher.recoverOnStart();
  assert.deepEqual(dead, ['D-0001']);
  assert.equal((await getDefect(s.paths, 'D-0001')).dispatch.error, 'server restarted');
  assert.equal(s.dispatcher.current(), 'D-0002');
});

test('an adopted orphan that opened a pull request before it died is reported pr-open, not failed', async () => {
  let alive = true;
  const s = await setup({ prUrl: 'https://github.com/o/r/pull/9', isPidAlive: () => alive });
  const { patchDispatch } = await import('../scripts/lib/defects.mjs');
  await patchDispatch(s.paths, 'D-0001', { state: 'running', pid: 555, branch: 'qa/17' });
  const dead = await s.dispatcher.recoverOnStart();
  assert.deepEqual(dead, []);
  assert.equal(s.dispatcher.current(), 'D-0001');
  alive = false;
  await settled(s.dispatcher);
  const d = await getDefect(s.paths, 'D-0001');
  assert.equal(d.dispatch.state, 'pr-open');
  assert.equal(d.dispatch.pr, 'https://github.com/o/r/pull/9');
  assert.equal(d.dispatch.error, null);
});

test('an adopted orphan with no pull request keeps the orphan wording, not the generic no-output message', async () => {
  let alive = true;
  const s = await setup({ isPidAlive: () => alive });
  const { patchDispatch } = await import('../scripts/lib/defects.mjs');
  await patchDispatch(s.paths, 'D-0001', { state: 'running', pid: 555, branch: 'qa/17' });
  await s.dispatcher.recoverOnStart();
  alive = false;
  await settled(s.dispatcher);
  const d = await getDefect(s.paths, 'D-0001');
  assert.equal(d.dispatch.state, 'failed');
  assert.equal(d.dispatch.error, 'orphaned by restart, check the issue');
});

test('enqueue refuses an issue id that is not a plain identifier', async () => {
  const s = await setup();
  const { patchDefect } = await import('../scripts/lib/defects.mjs');
  await patchDefect(s.paths, 'D-0001', { issueId: '../x' });
  await assert.rejects(s.dispatcher.enqueue('D-0001'), /not a plain identifier/);
  await patchDefect(s.paths, 'D-0001', { issueId: '..' });
  await assert.rejects(s.dispatcher.enqueue('D-0001'), /not a plain identifier/);
  assert.equal(s.dispatcher.current(), null);
});
