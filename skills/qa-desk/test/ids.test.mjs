import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, allocateIds } from '../scripts/lib/ids.mjs';

const item = (component, title, extra = {}) => ({ component, title, ...extra });

test('normalizeTitle folds case, punctuation and whitespace', () => {
  assert.equal(normalizeTitle('  Login,  with   OTP! '), 'login with otp');
});

test('allocateIds numbers new cases after the highest existing id', () => {
  const existing = [{ id: 'QA-0007', component: 'auth', title: 'Old' }];
  const r = allocateIds(existing, [item('auth', 'New one'), item('billing', 'New two')], 'QA');
  assert.deepEqual(r.added, ['QA-0008', 'QA-0009']);
  assert.equal(r.cases.length, 3);
  assert.equal(r.cases.find((c) => c.title === 'New two').id, 'QA-0009');
});

test('allocateIds updates a matching title inside the same component and keeps the id', () => {
  const existing = [{ id: 'QA-0001', component: 'auth', title: 'Login with OTP', priority: 'P2' }];
  const r = allocateIds(existing, [item('auth', 'login with otp!', { priority: 'P0' })], 'QA');
  assert.deepEqual(r.updated, ['QA-0001']);
  assert.deepEqual(r.added, []);
  assert.equal(r.cases[0].priority, 'P0');
  assert.equal(existing[0].priority, 'P2');
});

test('allocateIds drops duplicates inside the incoming batch', () => {
  const r = allocateIds([], [item('auth', 'Same'), item('auth', 'same')], 'QA');
  assert.deepEqual(r.added, ['QA-0001']);
  assert.deepEqual(r.duplicates, [{ component: 'auth', title: 'same' }]);
});

test('allocateIds pads to four digits and grows past 9999', () => {
  const r = allocateIds([{ id: 'QA-9999', component: 'a', title: 'x' }], [item('a', 'y')], 'QA');
  assert.deepEqual(r.added, ['QA-10000']);
});
