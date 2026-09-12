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
