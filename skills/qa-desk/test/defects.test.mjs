import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefect, getDefect, findDefect, listDefects, patchDefect, patchDispatch } from '../scripts/lib/defects.mjs';
import { dataPaths } from '../scripts/lib/paths.mjs';

const now = () => '2026-09-12T11:00:00.000Z';
async function paths() { return dataPaths(await mkdtemp(join(tmpdir(), 'def-'))); }

test('createDefect numbers defects and links them to an execution', async () => {
  const p = await paths();
  const d = await createDefect(p, { runId: 'R-0001', caseId: 'QA-0001', tracker: 'github', issueId: '17', url: 'https://github.com/o/r/issues/17' }, { now });
  assert.deepEqual(d, { id: 'D-0001', runId: 'R-0001', caseId: 'QA-0001', tracker: 'github', issueId: '17', url: 'https://github.com/o/r/issues/17', createdAt: now(), dispatch: null });
  assert.equal((await createDefect(p, { runId: 'R-0001', caseId: 'QA-0002', tracker: 'github', issueId: '18', url: 'u' }, { now })).id, 'D-0002');
  assert.equal((await findDefect(p, 'R-0001', 'QA-0002')).id, 'D-0002');
  assert.equal(await findDefect(p, 'R-0001', 'QA-0003'), null);
  assert.equal((await listDefects(p)).length, 2);
});

test('patchDefect and patchDispatch append and latest wins', async () => {
  const p = await paths();
  await createDefect(p, { runId: 'R-0001', caseId: 'QA-0001', tracker: 'beads', issueId: 'b-1', url: null }, { now });
  await patchDispatch(p, 'D-0001', { state: 'running', pid: 42 });
  await patchDispatch(p, 'D-0001', { state: 'failed', error: 'boom' });
  const d = await getDefect(p, 'D-0001');
  assert.deepEqual(d.dispatch, { state: 'failed', pid: 42, error: 'boom' });
  await patchDefect(p, 'D-0001', { url: 'https://x' });
  assert.equal((await getDefect(p, 'D-0001')).url, 'https://x');
  await assert.rejects(patchDefect(p, 'D-0009', {}), /unknown defect D-0009/);
});

test('patchDefect and patchDispatch serialise overlapping read-modify-append so no field is lost', async () => {
  const p = await paths();
  await createDefect(p, { runId: 'R-0001', caseId: 'QA-0001', tracker: 'github', issueId: '17', url: null }, { now });
  await Promise.all(Array.from({ length: 10 }, (_, i) => patchDefect(p, 'D-0001', { [`f${i}`]: i })));
  const d = await getDefect(p, 'D-0001');
  for (let i = 0; i < 10; i += 1) assert.equal(d[`f${i}`], i, `field f${i} was lost to a concurrent patch`);

  await Promise.all(Array.from({ length: 10 }, (_, i) => patchDispatch(p, 'D-0001', { [`g${i}`]: i })));
  const withDispatch = await getDefect(p, 'D-0001');
  for (let i = 0; i < 10; i += 1) assert.equal(withDispatch.dispatch[`g${i}`], i, `dispatch field g${i} was lost to a concurrent patch`);
});
