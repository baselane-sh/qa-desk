import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBeadsTracker, priorityToNumber } from '../scripts/lib/tracker-beads.mjs';
import { createTracker } from '../scripts/lib/tracker.mjs';
import { TEST_CONFIG } from './fixtures/config.mjs';

function fakeExec(handler) {
  const calls = [];
  const execFile = async (cmd, args, opts) => { calls.push({ cmd, args }); return handler(args, calls.length); };
  return { execFile, calls };
}

test('priorityToNumber uses the config order', () => {
  assert.equal(priorityToNumber('P0', TEST_CONFIG), 0);
  assert.equal(priorityToNumber('P3', TEST_CONFIG), 3);
  assert.equal(priorityToNumber('nope', TEST_CONFIG), 2);
});

test('create passes the body as an argument, parses the id, then exports', async () => {
  const { execFile, calls } = fakeExec((args) => ({ stdout: args[0] === 'create' ? JSON.stringify({ id: 'proj-abc' }) : '' }));
  const t = createBeadsTracker({ execFile, repoRoot: '/r' });
  const out = await t.create({ title: '[QA] x', body: 'steps', labels: ['qa-desk', 'auth'], priority: 1 });
  assert.deepEqual(out, { id: 'proj-abc', url: null });
  assert.deepEqual(calls[0].args, ['create', '--json', '--title', '[QA] x', '--description', 'steps', '--type', 'bug', '--priority', '1', '--labels', 'qa-desk,auth']);
  assert.deepEqual(calls[1].args, ['export', '-o', '.beads/issues.jsonl']);
  assert.equal(calls[0].cmd, 'bd');
});

test('a lock error is retried three times then surfaced', async () => {
  const { execFile, calls } = fakeExec(() => { throw Object.assign(new Error('x'), { stderr: 'database is locked' }); });
  const t = createBeadsTracker({ execFile, repoRoot: '/r', backoffMs: 1 });
  await assert.rejects(t.show('proj-abc'), /bd failed: database is locked/);
  assert.equal(calls.length, 3);
});

test('show maps bd json and readCommand/noteCommand are argv arrays', async () => {
  const { execFile } = fakeExec(() => ({ stdout: JSON.stringify([{ id: 'proj-abc', status: 'open', notes: 'PR: https://github.com/o/r/pull/9' }]) }));
  const t = createBeadsTracker({ execFile, repoRoot: '/r' });
  assert.deepEqual(await t.show('proj-abc'), { id: 'proj-abc', url: null, state: 'open', notes: 'PR: https://github.com/o/r/pull/9' });
  assert.deepEqual(t.readCommand('proj-abc'), ['bd', 'show', 'proj-abc']);
  assert.deepEqual(t.noteCommand('proj-abc'), ['bd', 'update', 'proj-abc', '--append-notes']);
});

test('createTracker picks the adapter from config', () => {
  const deps = { execFile: async () => ({ stdout: '' }), repoRoot: '/r' };
  assert.equal(createTracker(TEST_CONFIG, deps).name, 'github');
  assert.equal(createTracker({ ...TEST_CONFIG, tracker: 'beads' }, deps).name, 'beads');
  assert.throws(() => createTracker({ ...TEST_CONFIG, tracker: 'jira' }, deps), /unknown tracker jira/);
});
