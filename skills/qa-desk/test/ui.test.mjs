import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const FILES = ['index.html', 'style.css', 'api.js', 'app.js', 'keys.js', 'views/cases.js', 'views/runs.js'];

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

test('runBadges lists one badge per open run and calls a missing execution untested', async () => {
  const { runBadges } = await import('../public/views/cases.js');
  assert.deepEqual(runBadges({ id: 'QA-0001' }), []);
  assert.deepEqual(runBadges({ id: 'QA-0001', latestByRun: {} }), []);
  assert.deepEqual(runBadges({ id: 'QA-0001', latestByRun: { 'R-0002': { status: 'failed' }, 'R-0003': null } }), [
    { runId: 'R-0002', status: 'failed' },
    { runId: 'R-0003', status: 'untested' },
  ]);
});

test('historyLine names the run, the verdict and one line of the actual result', async () => {
  const { historyLine, truncateLine } = await import('../public/views/cases.js');
  const full = { runId: 'R-0002', runName: 'Sprint 4', status: 'failed', executedBy: 'mo', executedAt: '2026-09-12T11:00:00.000Z', durationSec: 45, actual: 'line one\nline two' };
  assert.equal(historyLine(full), 'R-0002 Sprint 4 · failed · by mo · at 2026-09-12T11:00:00.000Z · 45s: line one line two');
  assert.equal(historyLine({ runId: 'R-0001', status: 'passed' }), 'R-0001 · passed · by unknown · at unknown');
  assert.equal(truncateLine('  a\n\n  b  '), 'a b');
  assert.equal(truncateLine('').length, 0);
  const long = truncateLine('x'.repeat(200));
  assert.equal(long.length, 80);
  assert.ok(long.endsWith('...'));
});

test('recording a status refreshes the case history', async () => {
  const text = await read('app.js');
  const start = text.indexOf('async function record(');
  const end = text.indexOf('async function openDefect(');
  assert.ok(start > 0 && end > start, 'record and openDefect must both exist in app.js');
  assert.match(text.slice(start, end), /\/history/, 'record must refetch the history');
});

test('keyToStatus ignores a key held with a modifier and maps a bare key to its status', async () => {
  const { keyToStatus } = await import('../public/keys.js');
  assert.equal(keyToStatus({ key: 'p', metaKey: true }), null);
  assert.equal(keyToStatus({ key: 'f', ctrlKey: true }), null);
  assert.equal(keyToStatus({ key: 'r', altKey: true }), null);
  assert.equal(keyToStatus({ key: 'p' }), 'passed');
  assert.equal(keyToStatus({ key: 'x' }), null);
});

test('visibleRuns lists newest first, hides closed runs and keeps the selected one', async () => {
  const { visibleRuns, isClosed } = await import('../public/views/runs.js');
  const runs = [
    { id: 'R-0001', closedAt: '2026-09-12T10:00:00.000Z' },
    { id: 'R-0002', closedAt: null },
    { id: 'R-0003', closedAt: '2026-09-12T12:00:00.000Z' },
  ];
  assert.equal(isClosed(runs[0]), true);
  assert.equal(isClosed(runs[1]), false);
  assert.equal(isClosed(undefined), false);
  assert.deepEqual(visibleRuns(runs, {}).map((r) => r.id), ['R-0002']);
  assert.deepEqual(visibleRuns(runs, { showClosed: true }).map((r) => r.id), ['R-0003', 'R-0002', 'R-0001']);
  assert.deepEqual(visibleRuns(runs, { selectedId: 'R-0001' }).map((r) => r.id), ['R-0002', 'R-0001']);
  assert.deepEqual(runs.map((r) => r.id), ['R-0001', 'R-0002', 'R-0003']);
});

test('the UI never opens a browser dialog', async () => {
  for (const f of FILES.filter((x) => x.endsWith('.js'))) {
    const text = await read(f);
    assert.doesNotMatch(text, /\b(?:alert|confirm|prompt)\s*\(/, `${f} opens a browser dialog`);
  }
});

test('execution detail editors default to the run values and stay locked until a status exists', async () => {
  const { executionDefaults, needsStatusFirst } = await import('../public/views/runs.js');
  const run = { id: 'R-0001', env: 'staging', locale: 'en' };
  assert.deepEqual(executionDefaults({ id: 'QA-0001' }, run), { env: 'staging', locale: 'en' });
  assert.deepEqual(executionDefaults({ id: 'QA-0001', execution: { status: 'failed' } }, run), { env: 'staging', locale: 'en' });
  assert.deepEqual(executionDefaults({ id: 'QA-0001', execution: { status: 'failed', env: 'prod', locale: 'any' } }, run), { env: 'prod', locale: 'any' });
  assert.equal(needsStatusFirst({ id: 'QA-0001' }), true);
  assert.equal(needsStatusFirst({ id: 'QA-0001', execution: null }), true);
  assert.equal(needsStatusFirst({ id: 'QA-0001', execution: { status: 'passed' } }), false);
});

test('countStatuses derives untested and summaryLabel reads as progress', async () => {
  const { countStatuses, summaryLabel, SUMMARY_STATUSES } = await import('../public/views/runs.js');
  assert.deepEqual(SUMMARY_STATUSES, ['passed', 'failed', 'blocked', 'skipped', 'retest', 'untested']);
  const cases = [
    { id: 'QA-0001', execution: { status: 'passed' } },
    { id: 'QA-0002', execution: { status: 'failed' } },
    { id: 'QA-0003' },
    { id: 'QA-0004', execution: { status: 'nonsense' } },
  ];
  const summary = countStatuses(cases);
  assert.equal(summary.total, 4);
  assert.equal(summary.executed, 2);
  assert.deepEqual(summary.counts, { passed: 1, failed: 1, blocked: 0, skipped: 0, retest: 0, untested: 2 });
  assert.equal(summaryLabel(summary), '2 of 4 done');
  assert.equal(summaryLabel(countStatuses([])), '0 of 0 done');
  assert.equal(summaryLabel(null), '');
});

test('the defect hint appears only while Open as defect is disabled', async () => {
  const { defectHint } = await import('../public/views/runs.js');
  assert.equal(defectHint('failed'), null);
  assert.equal(defectHint('blocked'), null);
  assert.equal(defectHint('passed'), 'Needs a failed or blocked execution');
  assert.equal(defectHint('untested'), 'Needs a failed or blocked execution');
});
