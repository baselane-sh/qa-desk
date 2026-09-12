import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, listRuns, getRun, closeRun, recordExecution, listExecutions, caseHistory } from '../scripts/lib/runs.mjs';
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

test('three concurrent createRun calls mint distinct ids', async () => {
  const p = await paths();
  const runs = await Promise.all([1, 2, 3].map(() => createRun(p, input, { now })));
  assert.deepEqual(runs.map((r) => r.id).sort(), ['R-0001', 'R-0002', 'R-0003']);
  assert.deepEqual((await listRuns(p)).map((r) => r.id).sort(), ['R-0001', 'R-0002', 'R-0003']);
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

test('recordExecution serialises overlapping read-modify-append so no field is lost', async () => {
  const p = await paths();
  const run = await createRun(p, input, { now });
  await Promise.all(Array.from({ length: 10 }, (_, i) => recordExecution(p, { runId: run.id, caseId: 'QA-0001', status: 'retest', [`f${i}`]: i }, { now, executedBy: 'mo' })));
  const latest = (await listExecutions(p, run.id)).get('QA-0001');
  for (let i = 0; i < 10; i += 1) assert.equal(latest[`f${i}`], i, `field f${i} was lost to a concurrent write`);
});

test('recordExecution refuses an unknown run or a case outside the run', async () => {
  const p = await paths();
  await createRun(p, input, { now });
  await assert.rejects(recordExecution(p, { runId: 'R-0007', caseId: 'QA-0001', status: 'passed' }, { now }), /unknown run R-0007/);
  await assert.rejects(recordExecution(p, { runId: 'R-0001', caseId: 'QA-0099', status: 'passed' }, { now }), /QA-0099 is not in run R-0001/);
});

test('closeRun stamps closedAt once and a closed run takes no more executions', async () => {
  const p = await paths();
  const run = await createRun(p, input, { now });
  const closed = await closeRun(p, run.id, { now });
  assert.equal(closed.closedAt, now());
  assert.equal(closed.id, 'R-0001');
  assert.deepEqual(closed.caseIds, input.caseIds);
  assert.equal((await getRun(p, 'R-0001')).closedAt, now());
  assert.deepEqual((await listRuns(p)).map((r) => r.id), ['R-0001']);
  await assert.rejects(closeRun(p, 'R-0001', { now }), /run R-0001 is already closed/);
  await assert.rejects(closeRun(p, 'R-0009', { now }), /unknown run R-0009/);
  await assert.rejects(recordExecution(p, { runId: 'R-0001', caseId: 'QA-0001', status: 'passed' }, { now }), /run R-0001 is closed/);
});
