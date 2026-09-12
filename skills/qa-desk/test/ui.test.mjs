import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const FILES = ['index.html', 'style.css', 'api.js', 'app.js', 'keys.js', 'filters-store.js', 'ui-restore.js', 'views/cases.js', 'views/runs.js'];

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

test('headerSummary folds run.summary.total in so the header cannot disagree with the run list badge', async () => {
  const { countStatuses, headerSummary } = await import('../public/views/runs.js');
  const cases = [{ id: 'QA-0001', execution: { status: 'passed' } }, { id: 'QA-0002' }];
  const counted = countStatuses(cases);
  assert.deepEqual(headerSummary(counted, undefined), counted, 'no run summary yet: pass the live count through untouched');
  assert.deepEqual(headerSummary(counted, { total: 2, executed: 1, counts: counted.counts }), { ...counted, total: 2 });
  // QA-0003 is in the run's frozen caseIds but no longer in cases.json: the server's total (3)
  // already counts it, and the browser must count the gap as untested rather than drop it.
  const withMissing = headerSummary(counted, { total: 3, executed: 1, counts: {} });
  assert.equal(withMissing.total, 3);
  assert.equal(withMissing.executed, 1);
  assert.deepEqual(withMissing.counts, { passed: 1, failed: 0, blocked: 0, skipped: 0, retest: 0, untested: 2 });
});

test('inRunCases counts every case in the run, ignoring the active filters (regression: the runs view empty state)', async () => {
  const { inRunCases } = await import('../public/views/runs.js');
  const run = { caseIds: ['QA-0001', 'QA-0002'] };
  const cases = [{ id: 'QA-0001' }, { id: 'QA-0002' }, { id: 'QA-0003' }];
  assert.deepEqual(inRunCases(cases, run).map((c) => c.id), ['QA-0001', 'QA-0002']);
  assert.deepEqual(inRunCases([], run), []);
});

test('the defect hint appears only while Open as defect is disabled', async () => {
  const { defectHint } = await import('../public/views/runs.js');
  assert.equal(defectHint('failed'), null);
  assert.equal(defectHint('blocked'), null);
  assert.equal(defectHint('passed'), 'Needs a failed or blocked execution');
  assert.equal(defectHint('untested'), 'Needs a failed or blocked execution');
});

test('nextIndex clamps at both ends and starts at the top from nothing', async () => {
  const { nextIndex } = await import('../public/keys.js');
  assert.equal(nextIndex(10, -1, 1), 0);
  assert.equal(nextIndex(10, -1, -1), 0);
  assert.equal(nextIndex(10, 0, -1), 0);
  assert.equal(nextIndex(10, 9, 1), 9);
  assert.equal(nextIndex(10, 4, 1), 5);
  assert.equal(nextIndex(0, -1, 1), -1);
});

test('keyAction maps every binding and refuses what the context cannot do', async () => {
  const { keyAction } = await import('../public/keys.js');
  const ctx = { hasSelection: true, hasRun: true, overlayOpen: false };
  const ev = (key, extra = {}) => ({ key, target: { tagName: 'BODY' }, ...extra });
  assert.deepEqual(keyAction(ev('j'), ctx), { type: 'move', delta: 1 });
  assert.deepEqual(keyAction(ev('ArrowDown'), ctx), { type: 'move', delta: 1 });
  assert.deepEqual(keyAction(ev('k'), ctx), { type: 'move', delta: -1 });
  assert.deepEqual(keyAction(ev('ArrowUp'), ctx), { type: 'move', delta: -1 });
  assert.deepEqual(keyAction(ev('p'), ctx), { type: 'status', status: 'passed' });
  assert.deepEqual(keyAction(ev('P'), ctx), { type: 'status', status: 'passed' });
  assert.deepEqual(keyAction(ev('u'), ctx), { type: 'undo' });
  assert.deepEqual(keyAction(ev('/'), ctx), { type: 'search' });
  assert.deepEqual(keyAction(ev('?'), ctx), { type: 'help' });
  assert.deepEqual(keyAction(ev('Enter'), ctx), { type: 'focusField', field: 'actual' });
  assert.deepEqual(keyAction(ev('Escape'), ctx), { type: 'blur' });
  // a verdict needs both a case and an open run
  assert.equal(keyAction(ev('p'), { ...ctx, hasRun: false }), null);
  assert.equal(keyAction(ev('p'), { ...ctx, hasSelection: false }), null);
  assert.equal(keyAction(ev('u'), { ...ctx, hasRun: false }), null);
  // Enter on a real button stays with the button
  assert.equal(keyAction(ev('Enter', { target: { tagName: 'BUTTON' } }), ctx), null);
  // every modifier aborts, including on Escape
  for (const mod of ['metaKey', 'ctrlKey', 'altKey']) {
    assert.equal(keyAction(ev('j', { [mod]: true }), ctx), null, mod);
    assert.equal(keyAction(ev('Escape', { [mod]: true }), ctx), null, mod);
  }
  // typing in a field blocks everything but Escape
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(keyAction(ev('j', { target: { tagName: tag } }), ctx), null, tag);
    assert.deepEqual(keyAction(ev('Escape', { target: { tagName: tag } }), ctx), { type: 'blur' }, tag);
  }
  assert.equal(keyAction(ev('j', { target: { tagName: 'DIV', isContentEditable: true } }), ctx), null);
  // an open overlay swallows everything but Escape
  assert.equal(keyAction(ev('j'), { ...ctx, overlayOpen: true }), null);
  assert.deepEqual(keyAction(ev('Escape'), { ...ctx, overlayOpen: true }), { type: 'blur' });
  assert.equal(keyAction(ev('x'), ctx), null);
});

test('debounce runs once after the quiet time and keeps the last arguments', async () => {
  const { debounce } = await import('../public/keys.js');
  let timer = null;
  const setTimer = (fn, ms) => { timer = { fn, ms }; return 1; };
  const clearTimer = () => { timer = null; };
  const seen = [];
  const d = debounce((v) => seen.push(v), 140, setTimer, clearTimer);
  d('a'); d('b'); d('c');
  assert.deepEqual(seen, []);
  assert.equal(timer.ms, 140);
  timer.fn();
  assert.deepEqual(seen, ['c']);
});

test('the key legend in index.html names every bound key', async () => {
  const html = await read('index.html');
  for (const k of ['j', 'k', 'p', 'f', 'b', 's', 'r', 'u', 'Enter', 'Esc', '?']) {
    assert.match(html, new RegExp(`<kbd>${k.replace('?', '\\?')}</kbd>`), `legend is missing ${k}`);
  }
});

test('sanitizeFilters drops values the current case set no longer has', async () => {
  const { sanitizeFilters } = await import('../public/filters-store.js');
  const allowed = { component: ['auth'], priority: ['P0', 'P1'], status: ['untested', 'passed'] };
  assert.deepEqual(sanitizeFilters({ component: 'auth', priority: 'P0' }, allowed), { component: 'auth', priority: 'P0' });
  assert.deepEqual(sanitizeFilters({ component: 'gone', priority: 'P1' }, allowed), { priority: 'P1' });
  assert.deepEqual(sanitizeFilters({ q: 'otp' }, allowed), { q: 'otp' });
  assert.deepEqual(sanitizeFilters({ nonsense: 'x' }, allowed), {});
  assert.deepEqual(sanitizeFilters(null, allowed), {});
  assert.deepEqual(sanitizeFilters({ q: 42 }, allowed), {});
});

test('isDefaultFilters knows an untouched filter set', async () => {
  const { isDefaultFilters } = await import('../public/filters-store.js');
  assert.equal(isDefaultFilters({}), true);
  assert.equal(isDefaultFilters({ q: '', component: undefined }), true);
  assert.equal(isDefaultFilters({ component: 'auth' }), false);
  assert.equal(isDefaultFilters({ q: 'x' }), false);
});

test('loadFilters and saveFilters survive a broken store', async () => {
  const { loadFilters, saveFilters } = await import('../public/filters-store.js');
  const allowed = { component: ['auth'] };
  const good = { getItem: () => JSON.stringify({ component: 'auth' }), setItem() {} };
  assert.deepEqual(loadFilters(good, allowed), { component: 'auth' });
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadFilters(broken, allowed), {});
  assert.doesNotThrow(() => saveFilters(broken, { component: 'auth' }));
  const garbage = { getItem: () => '{not json', setItem() {} };
  assert.deepEqual(loadFilters(garbage, allowed), {});
});

test('captureField returns no key/caret/value when nothing is focused', async () => {
  const { captureField } = await import('../public/ui-restore.js');
  assert.deepEqual(captureField(null), { key: null, caret: null, value: null });
  assert.deepEqual(captureField({ dataset: {} }), { key: null, caret: null, value: null });
});

test('captureField treats a number input as caret-less: selectionStart null (modern engines) and selectionStart throwing (older engines)', async () => {
  const { captureField } = await import('../public/ui-restore.js');
  const nullSelection = { dataset: { focusKey: 'duration' }, selectionStart: null, selectionEnd: null, value: '30' };
  assert.deepEqual(captureField(nullSelection), { key: 'duration', caret: null, value: '30' });
  const throwingSelection = {
    dataset: { focusKey: 'duration' },
    get selectionStart() { throw new DOMException('not supported on this input type'); },
    value: '30',
  };
  assert.deepEqual(captureField(throwingSelection), { key: 'duration', caret: null, value: '30' });
});

test('captureField captures a real caret on a text-like field', async () => {
  const { captureField } = await import('../public/ui-restore.js');
  const field = { dataset: { focusKey: 'evidence' }, selectionStart: 3, selectionEnd: 3, value: 'evi' };
  assert.deepEqual(captureField(field), { key: 'evidence', caret: [3, 3], value: 'evi' });
});

test('restoreField reassigns a mid-typing value before restoring the caret', async () => {
  const { restoreField } = await import('../public/ui-restore.js');
  let focused = false;
  const ranges = [];
  const node = {
    value: '',
    focus() { focused = true; },
    setSelectionRange(start, end) { ranges.push([start, end]); },
  };
  restoreField(node, { caret: [3, 3], value: 'evi' });
  assert.equal(focused, true);
  assert.equal(node.value, 'evi', 'the value the tester was typing must survive the redraw');
  assert.deepEqual(ranges, [[3, 3]]);
});

test('restoreField tolerates setSelectionRange throwing on a number input, and does nothing without a target', async () => {
  const { restoreField } = await import('../public/ui-restore.js');
  const node = {
    value: '',
    focus() {},
    setSelectionRange() { throw new DOMException('not supported on input[type=number]'); },
  };
  assert.doesNotThrow(() => restoreField(node, { caret: [0, 0], value: '30' }));
  assert.equal(node.value, '30');
  assert.doesNotThrow(() => restoreField(null, { caret: [0, 0], value: 'x' }));
});
