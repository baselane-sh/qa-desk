import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCase, validateExecutionPatch, validateRunInput } from '../scripts/lib/validate.mjs';
import { TEST_CONFIG, sampleCase } from './fixtures/config.mjs';

test('a full sample case is valid', () => {
  assert.deepEqual(validateCase(sampleCase(), TEST_CONFIG), []);
});

test('validateCase reports every enum and shape problem', () => {
  const bad = sampleCase({ id: 'x', component: 'nope', actors: ['ghost'], type: 'weird', priority: 'P9', severity: 'huge', env: 'moon', locale: 'xx', steps: [{ action: 'a' }], source: [], automation: 'robot', estimateMinutes: -1, references: 'REQ-1' });
  const text = validateCase(bad, TEST_CONFIG).join('\n');
  for (const re of [/id must match QA-<digits>/, /component must be one of auth, billing/, /actors\[0\] must be one of admin, user/, /type must be one of/, /priority must be one of/, /severity must be one of/, /env must be one of local, staging, prod, any/, /locale must be one of en, any/, /steps\[0\]\.expected must be a non-empty string/, /source must not be empty/, /automation must be one of/, /estimateMinutes must be a non-negative integer/, /references must be an array of strings/]) {
    assert.match(text, re);
  }
});

test('actors is required when config has roles and forbidden when it has none', () => {
  assert.match(validateCase(sampleCase({ actors: undefined }), TEST_CONFIG).join('\n'), /actors is required/);
  const noRoles = { ...TEST_CONFIG, roles: [] };
  assert.deepEqual(validateCase(sampleCase({ actors: undefined }), noRoles), []);
  assert.match(validateCase(sampleCase(), noRoles).join('\n'), /actors must be absent/);
});

test('optional fields default cleanly', () => {
  const c = sampleCase({ testData: undefined, postconditions: undefined, references: undefined, tags: undefined, automation: undefined, estimateMinutes: undefined });
  assert.deepEqual(validateCase(c, TEST_CONFIG), []);
});

test('objective is required', () => {
  assert.match(validateCase(sampleCase({ objective: undefined }), TEST_CONFIG).join('\n'), /objective must be a non-empty string/);
  assert.match(validateCase(sampleCase({ objective: '' }), TEST_CONFIG).join('\n'), /objective must be a non-empty string/);
});

test('validateExecutionPatch accepts status and actual, rejects others', () => {
  assert.deepEqual(validateExecutionPatch({ status: 'failed', actual: 'crashed', durationSec: 12 }, TEST_CONFIG), { ok: true, value: { status: 'failed', actual: 'crashed', durationSec: 12 } });
  assert.equal(validateExecutionPatch({ status: 'pass' }, TEST_CONFIG).ok, false);
  assert.equal(validateExecutionPatch({ env: 'moon' }, TEST_CONFIG).ok, false);
  assert.equal(validateExecutionPatch({ actual: 'x'.repeat(20001) }, TEST_CONFIG).ok, false);
  assert.equal(validateExecutionPatch(null, TEST_CONFIG).ok, false);
});

test('validateRunInput needs name, build, env and caseIds', () => {
  const ok = validateRunInput({ name: 'Sprint 3', build: 'v1.2.0', env: 'staging', caseIds: ['QA-0001'] }, TEST_CONFIG);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.locale, 'en');
  assert.equal(validateRunInput({ name: '', build: 'b', env: 'staging', caseIds: [] }, TEST_CONFIG).ok, false);
  assert.equal(validateRunInput({ name: 'n', build: 'b', env: 'moon', caseIds: ['QA-0001'] }, TEST_CONFIG).ok, false);
});
