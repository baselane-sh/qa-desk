import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const FILES = ['index.html', 'style.css', 'api.js', 'app.js', 'views/cases.js', 'views/runs.js'];

test('every UI file exists and stays under 800 lines', async () => {
  for (const f of FILES) {
    const text = await read(f);
    assert.ok(text.length > 0, `${f} is empty`);
    assert.ok(text.split('\n').length < 800, `${f} is too long`);
  }
});

test('index.html loads app.js as a module and has no inline script or build artefact', async () => {
  const html = await read('index.html');
  assert.match(html, /<script type="module" src="app\.js"><\/script>/);
  assert.doesNotMatch(html, /<script>[^<]/);
  assert.match(html, /<link rel="stylesheet" href="style\.css">/);
});

test('modules parse once import lines and the export keyword are dropped', async () => {
  for (const f of FILES.filter((x) => x.endsWith('.js'))) {
    const text = await read(f);
    const plain = text.replace(/^\s*import\b.*$/gm, '').replace(/^\s*export\s+/gm, '');
    assert.doesNotThrow(() => new Function(plain), `${f} does not parse`);
  }
});

test('matchesFilters filters by every config list and by text', async () => {
  const { matchesFilters } = await import('../public/views/cases.js');
  const c = { id: 'QA-0001', title: 'Login with OTP', component: 'auth', actors: ['user'], type: 'smoke', priority: 'P0', severity: 'major', env: 'any', locale: 'en', tags: ['smoke'], automation: 'manual' };
  assert.equal(matchesFilters(c, {}), true);
  assert.equal(matchesFilters(c, { component: 'auth', priority: 'P0' }), true);
  assert.equal(matchesFilters(c, { component: 'billing' }), false);
  assert.equal(matchesFilters(c, { role: 'user' }), true);
  assert.equal(matchesFilters(c, { role: 'admin' }), false);
  assert.equal(matchesFilters(c, { q: 'otp' }), true);
  assert.equal(matchesFilters(c, { q: 'qa-0001' }), true);
  assert.equal(matchesFilters(c, { q: 'invoice' }), false);
  assert.equal(matchesFilters(c, { status: 'untested' }), true);
  assert.equal(matchesFilters({ ...c, execution: { status: 'failed' } }, { status: 'failed' }), true);
  assert.equal(matchesFilters({ ...c, execution: { status: 'failed' } }, { status: 'untested' }), false);
});
