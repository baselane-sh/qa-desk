import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCoverage } from '../scripts/lib/coverage.mjs';
import { TEST_CONFIG, sampleCase } from './fixtures/config.mjs';

test('computeCoverage lists config sources with zero cases', () => {
  const cases = [sampleCase({ source: ['src/auth/login.ts'] }), sampleCase({ id: 'QA-0002', source: ['src/auth/login.ts', 'src/billing/invoice.ts'] })];
  const r = computeCoverage(TEST_CONFIG, cases);
  assert.deepEqual(r.uncovered, ['src/auth/otp.ts']);
  assert.equal(r.counts['src/auth/login.ts'], 2);
  assert.deepEqual(r.byComponent.auth, { sources: 2, uncovered: 1, cases: 2 });
  assert.deepEqual(r.byComponent.billing, { sources: 1, uncovered: 0, cases: 0 });
});

test('computeCoverage ignores superseded cases and unknown sources', () => {
  const cases = [sampleCase({ source: ['src/auth/login.ts', 'elsewhere.ts'], supersededBy: 'QA-0009' })];
  const r = computeCoverage(TEST_CONFIG, cases);
  assert.equal(r.counts['src/auth/login.ts'], 0);
  assert.equal(r.counts['elsewhere.ts'], undefined);
});
