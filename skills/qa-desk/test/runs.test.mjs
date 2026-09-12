import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, listRuns, getRun, recordExecution, listExecutions, caseHistory } from '../scripts/lib/runs.mjs';
import { dataPaths } from '../scripts/lib/paths.mjs';

const now = () => '2026-09-12T10:00:00.000Z';
const input = { name: 'Sprint 3', build: 'v1.2.0', env: 'staging', locale: 'en', caseIds: ['QA-0001', 'QA-0002'] };

async function paths() { return dataPaths(await mkdtemp(join(tmpdir(), 'runs-'))); }

test('createRun numbers runs and freezes caseIds', async () => {
  const p = await paths();
  const r1 = await createRun(p, input, { now });
  const r2 = await createRun(p, { ...input, name: 'Sprint 4' }, { now });
  assert.equal(r1.id, 'R-0001');
  assert.equal(r2.id, 'R-0002');
  assert.deepEqual(r1, { id: 'R-0001', ...input, createdAt: now(), closedAt: null });
  assert.deepEqual((await listRuns(p)).map((r) => r.id), ['R-0001', 'R-0002']);
  assert.equal((await getRun(p, 'R-0002')).name, 'Sprint 4');
  assert.equal(await getRun(p, 'R-0009'), null);
});

test('recordExecution merges over the previous execution and history keeps every record', async () => {
  const p = await paths();
  const run = await createRun(p, input, { now });
  const e1 = await recordExecution(p, { runId: run.id, caseId: 'QA-0001', status: 'failed', actual: 'crash on step 2' }, { now, executedBy: 'mo' });
  assert.deepEqual(e1, { runId: 'R-0001', caseId: 'QA-0001', status: 'failed', actual: 'crash on step 2', env: 'staging', locale: 'en', executedBy: 'mo', executedAt: now() });
  const e2 = await recordExecution(p, { runId: run.id, caseId: 'QA-0001', status: 'retest' }, { now, executedBy: 'mo' });
  assert.equal(e2.actual, 'crash on step 2');
  assert.equal(e2.status, 'retest');
  const latest = await listExecutions(p, run.id);
  assert.equal(latest.get('QA-0001').status, 'retest');
  assert.equal((await caseHistory(p, 'QA-0001')).length, 2);
});

test('recordExecution refuses an unknown run or a case outside the run', async () => {
  const p = await paths();
  await createRun(p, input, { now });
  await assert.rejects(recordExecution(p, { runId: 'R-0007', caseId: 'QA-0001', status: 'passed' }, { now }), /unknown run R-0007/);
  await assert.rejects(recordExecution(p, { runId: 'R-0001', caseId: 'QA-0099', status: 'passed' }, { now }), /QA-0099 is not in run R-0001/);
});
