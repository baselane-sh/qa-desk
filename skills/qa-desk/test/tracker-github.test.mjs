import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGithubTracker } from '../scripts/lib/tracker-github.mjs';

function fakeExec(responses = {}) {
  const calls = [];
  const execFile = async (cmd, args, opts) => {
    calls.push({ cmd, args, input: opts?.input ?? null });
    const key = args.slice(0, 2).join(' ');
    const r = responses[key];
    if (r instanceof Error) throw r;
    return { stdout: r ?? '', stderr: '' };
  };
  return { execFile, calls };
}

test('create bootstraps labels, sends the body on stdin, returns number and url', async () => {
  const { execFile, calls } = fakeExec({ 'issue create': 'https://github.com/o/r/issues/17\n' });
  const t = createGithubTracker({ execFile, repoRoot: '/r' });
  const out = await t.create({ title: '[QA] x', body: 'hello\n$(rm -rf /)', labels: ['qa-desk', 'auth', 'P1', 'major'] });
  assert.deepEqual(out, { id: '17', url: 'https://github.com/o/r/issues/17' });
  const labelCalls = calls.filter((c) => c.args[0] === 'label');
  assert.equal(labelCalls.length, 4);
  assert.deepEqual(labelCalls[0].args, ['label', 'create', 'qa-desk', '--force']);
  const create = calls.find((c) => c.args[0] === 'issue' && c.args[1] === 'create');
  assert.deepEqual(create.args, ['issue', 'create', '--title', '[QA] x', '--body-file', '-', '--label', 'qa-desk,auth,P1,major']);
  assert.equal(create.input, 'hello\n$(rm -rf /)');
  assert.equal(create.cmd, 'gh');
});

test('labels are created once per process', async () => {
  const { execFile, calls } = fakeExec({ 'issue create': 'https://github.com/o/r/issues/1\n' });
  const t = createGithubTracker({ execFile, repoRoot: '/r' });
  await t.create({ title: 'a', body: 'b', labels: ['qa-desk'] });
  await t.create({ title: 'a', body: 'b', labels: ['qa-desk'] });
  assert.equal(calls.filter((c) => c.args[0] === 'label').length, 1);
});

test('show maps gh json to the adapter shape', async () => {
  const json = JSON.stringify({ number: 17, url: 'https://github.com/o/r/issues/17', state: 'OPEN', comments: [{ body: 'first' }, { body: 'PR: https://github.com/o/r/pull/3' }] });
  const { execFile, calls } = fakeExec({ 'issue view': json });
  const t = createGithubTracker({ execFile, repoRoot: '/r' });
  assert.deepEqual(await t.show('17'), { id: '17', url: 'https://github.com/o/r/issues/17', state: 'open', notes: 'first\nPR: https://github.com/o/r/pull/3' });
  assert.deepEqual(calls[0].args, ['issue', 'view', '17', '--json', 'number,url,state,comments']);
});

test('create wraps gh failures in a readable error', async () => {
  const err = Object.assign(new Error('exit 1'), { stderr: 'gh: Not Found (HTTP 404)' });
  const { execFile } = fakeExec({ 'issue create': err });
  const t = createGithubTracker({ execFile, repoRoot: '/r' });
  await assert.rejects(t.create({ title: 'a', body: 'b', labels: [] }), /gh failed: gh: Not Found/);
});

test('readCommand and noteCommand are argv arrays', () => {
  const t = createGithubTracker({ execFile: async () => ({ stdout: '' }), repoRoot: '/r' });
  assert.deepEqual(t.readCommand('17'), ['gh', 'issue', 'view', '17', '--comments']);
  assert.deepEqual(t.noteCommand('17'), ['gh', 'issue', 'comment', '17', '--body']);
  assert.equal(t.name, 'github');
});
