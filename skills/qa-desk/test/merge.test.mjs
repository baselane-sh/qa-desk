import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeOutputs, formatMergeReport } from '../scripts/merge.mjs';
import { readJson } from '../scripts/lib/store.mjs';
import { dataPaths } from '../scripts/lib/paths.mjs';
import { TEST_CONFIG, sampleCase } from './fixtures/config.mjs';

const stripId = ({ id, ...rest }) => rest;

async function repo() {
  const root = await mkdtemp(join(tmpdir(), 'merge-'));
  const p = dataPaths(root);
  await mkdir(p.generateOut, { recursive: true });
  return { root, p };
}

test('mergeOutputs validates, allocates ids, writes cases and coverage, removes out files', async () => {
  const { root, p } = await repo();
  await writeFile(join(p.generateOut, 'auth.json'), JSON.stringify([stripId(sampleCase()), { title: 'broken' }]));
  await writeFile(join(p.generateOut, 'billing.json'), JSON.stringify([stripId(sampleCase({ component: 'billing', title: 'Pay an invoice', source: ['src/billing/invoice.ts'] }))]));
  const r = await mergeOutputs({ repoRoot: root, config: TEST_CONFIG });
  assert.deepEqual(r.added, ['QA-0001', 'QA-0002']);
  assert.equal(r.invalid.length, 1);
  assert.equal(r.invalid[0].file, 'auth.json');
  assert.deepEqual(r.uncovered, ['src/auth/otp.ts']);
  const cases = await readJson(p.cases, []);
  assert.equal(cases.length, 2);
  const cov = await readJson(p.coverage, null);
  assert.deepEqual(cov.uncovered, ['src/auth/otp.ts']);
  assert.deepEqual(await readdir(p.generateOut), []);
  assert.match(formatMergeReport(r), /added 2, updated 0, invalid 1, duplicates 0, uncovered 1/);
  assert.match(formatMergeReport(r), /INVALID auth.json\[1\]/);
});

test('mergeOutputs keeps invalid files in place when nothing was valid', async () => {
  const { root, p } = await repo();
  await writeFile(join(p.generateOut, 'auth.json'), '{"not":"an array"}');
  const r = await mergeOutputs({ repoRoot: root, config: TEST_CONFIG });
  assert.deepEqual(r.added, []);
  assert.equal(r.invalid[0].problems[0], 'file must contain an array');
  assert.deepEqual(await readdir(p.generateOut), ['auth.json']);
});

test('mergeOutputs reports a malformed JSON file as one INVALID entry', async () => {
  const { root, p } = await repo();
  await writeFile(join(p.generateOut, 'auth.json'), '{ not json');
  const r = await mergeOutputs({ repoRoot: root, config: TEST_CONFIG });
  assert.deepEqual(r.invalid, [{ file: 'auth.json', index: null, title: null, problems: ['file is not valid JSON'] }]);
});

test('mergeOutputs works with no out directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'merge-'));
  const r = await mergeOutputs({ repoRoot: root, config: TEST_CONFIG });
  assert.deepEqual(r.added, []);
  assert.equal(r.uncovered.length, 3);
});
