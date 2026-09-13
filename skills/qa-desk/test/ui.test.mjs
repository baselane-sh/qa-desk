import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../public/${rel}`, import.meta.url), 'utf8');
const FILES = ['index.html', 'style.css', 'api.js', 'app.js', 'keys.js', 'filters-store.js', 'ui-restore.js', 'status.js', 'chips.js', 'icons.js', 'views/cases.js', 'views/runs.js'];

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

test('a failed write only rolls back the case row when no newer write for that case has already landed (I1)', async () => {
  const text = await read('app.js');
  const start = text.indexOf('async function record(');
  const end = text.indexOf('async function undo(');
  const body = text.slice(start, end);
  assert.match(
    body,
    /if \(applyWrite\(state\.run\?\.id, runId, recordToken, token\)\) patchOut\.cases = state\.cases\.map/,
    'the rollback of `cases` on a failed write must be gated on the run and on this still being the most recent call',
  );
  assert.match(
    body,
    /if \(!applyWrite\(state\.run\?\.id, runId, recordToken, token\)\) \{/,
    'the success path must be gated the same way, or a write answered after a run change lands on the wrong run',
  );
  assert.match(body, /const runId = state\.run\.id;/, 'record must capture the run it was sent for');
});

test('the execution textareas seed from the unsaved draft, never straight from the saved value, and are keyed to the case on screen', async () => {
  const text = await read('views/runs.js');
  assert.match(text, /actual\.value = fieldValue\(state\.saveState, c\.execution, 'actual', c\.id, state\.run\?\.id \?\? null\)/);
  assert.match(text, /evidence\.value = fieldValue\(state\.saveState, c\.execution, 'evidence', c\.id, state\.run\?\.id \?\? null\)/);
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

test('emptyState tells "no cases at all" apart from "the filters hid them"', async () => {
  const { emptyState } = await import('../public/views/cases.js');
  // The runs view regression: a run holds cases, a status filter hides every one of them.
  // The tester must be offered Clear filters, never the generate-and-merge command.
  const filtered = emptyState(12);
  assert.equal(filtered.text, 'No case matches the filters.');
  assert.equal(filtered.label, 'Clear filters');
  assert.equal(filtered.action, 'clearFilters');
  assert.equal(filtered.hint, null);
  const nothing = emptyState(0);
  assert.equal(nothing.text, 'No cases yet.');
  assert.equal(nothing.label, 'Reload');
  assert.equal(nothing.action, 'reload');
  assert.match(nothing.hint, /qa-desk generate/);
  // an absent denominator must not read as "the filters hid them"
  assert.equal(emptyState(undefined).action, 'reload');
});

test('inRunCases returns nothing rather than throwing on a run with no case list', async () => {
  const { inRunCases } = await import('../public/views/runs.js');
  assert.deepEqual(inRunCases([{ id: 'QA-0001' }], null), []);
  assert.deepEqual(inRunCases([{ id: 'QA-0001' }], {}), []);
  assert.deepEqual(inRunCases([{ id: 'QA-0001' }, { id: 'QA-0002' }], { caseIds: ['QA-0002'] }), [{ id: 'QA-0002' }]);
});

test('restoreField leaves a node that cannot take focus alone', async () => {
  const { restoreField } = await import('../public/ui-restore.js');
  const node = { value: 'old' };
  assert.doesNotThrow(() => restoreField(node, { key: 'q', caret: null, value: 'typed' }));
  assert.equal(node.value, 'typed');
});

test('saveStateLabel names every save state', async () => {
  const { saveStateLabel } = await import('../public/status.js');
  assert.equal(saveStateLabel('idle'), '');
  assert.equal(saveStateLabel('saving'), 'Saving');
  assert.equal(saveStateLabel('saved', '14:05:09'), 'Saved 14:05:09');
  assert.equal(saveStateLabel('failed'), 'Not saved. Edit again to retry.');
});

test('connectionLabel reports both states', async () => {
  const { connectionLabel } = await import('../public/status.js');
  assert.deepEqual(connectionLabel(true), { text: 'Connected', className: 'dot online' });
  assert.deepEqual(connectionLabel(false), { text: 'Server not responding', className: 'dot offline' });
});

test('fieldValue reads the unsaved draft while a save has failed, otherwise the saved value', async () => {
  const { fieldValue } = await import('../public/status.js');
  assert.equal(fieldValue({}, { actual: 'saved text' }, 'actual'), 'saved text');
  assert.equal(fieldValue({ actual: { status: 'failed', draft: 'typed text' } }, { actual: 'saved text' }, 'actual'), 'typed text');
  assert.equal(fieldValue({ actual: { status: 'saved', draft: null } }, { actual: 'saved text' }, 'actual'), 'saved text');
  assert.equal(fieldValue(null, null, 'actual'), '');
});

test('fieldValue ignores a draft left by another case, so a case switch cannot seed the wrong box (C1)', async () => {
  const { fieldValue } = await import('../public/status.js');
  const saveState = { caseId: 'QA-0001', actual: { status: 'failed', draft: 'case 1 text' } };
  // Same case as the failed save: the draft still shows, so the tester does not retype it.
  assert.equal(fieldValue(saveState, { actual: 'saved for QA-0001' }, 'actual', 'QA-0001'), 'case 1 text');
  // A different case reading the very same (shared) saveState slot must never see that
  // draft: it is not this case's draft, and this case's own saved value must win instead.
  assert.equal(fieldValue(saveState, { actual: 'saved for QA-0002' }, 'actual', 'QA-0002'), 'saved for QA-0002');
  assert.equal(fieldValue(saveState, {}, 'actual', 'QA-0002'), '');
});

test('tallyLabel counts what is on screen and what is marked', async () => {
  const { tallyLabel } = await import('../public/status.js');
  assert.equal(tallyLabel({ visible: 600, total: 600, counts: { passed: 0, failed: 0 } }), '600 cases');
  assert.equal(tallyLabel({ visible: 12, total: 600, counts: { passed: 3, failed: 1 } }), '12 of 600 cases · 4 marked · 3 passed · 1 failed');
  assert.equal(tallyLabel({ visible: 0, total: 0, counts: {} }), '0 cases');
});

test('progressBarLabel spells the breakdown out in words, in order, and omits zero counts', async () => {
  const { progressBarLabel } = await import('../public/views/cases.js');
  assert.equal(progressBarLabel('auth', { passed: 4, failed: 1, blocked: 0, skipped: 0, retest: 0 }, 12), 'auth: 4 passed, 1 failed, 7 untested of 12');
  assert.equal(progressBarLabel('billing', { passed: 0, failed: 0, blocked: 0, skipped: 0, retest: 0 }, 5), 'billing: 5 untested of 5');
  assert.equal(progressBarLabel('auth', { passed: 3, failed: 0, blocked: 0, skipped: 0, retest: 0 }, 3), 'auth: 3 passed of 3');
});

test('tallyCounts counts each real verdict among the given cases and omits zero entries (M3)', async () => {
  const { tallyCounts } = await import('../public/views/cases.js');
  const cases = [
    { execution: { status: 'passed' } },
    { execution: { status: 'passed' } },
    { execution: { status: 'failed' } },
    { execution: { status: 'nonsense' } },
    {},
  ];
  assert.deepEqual(tallyCounts(cases), { passed: 2, failed: 1 });
  assert.deepEqual(tallyCounts([]), {});
});

test('dispatchButtonLabel names Agent running, Dispatch again after a failure, and the plain label otherwise', async () => {
  const { dispatchButtonLabel } = await import('../public/views/runs.js');
  assert.equal(dispatchButtonLabel(undefined), 'Dispatch fix agent');
  assert.equal(dispatchButtonLabel({ state: 'running' }), 'Agent running');
  assert.equal(dispatchButtonLabel({ state: 'failed' }), 'Dispatch again');
  assert.equal(dispatchButtonLabel({ state: 'pr-open' }), 'Dispatch fix agent');
  assert.equal(dispatchButtonLabel({ state: 'queued' }), 'Dispatch fix agent');
});

test('showModelPicker appears only once the server reports the argv accepts a model and the allowlist is non-empty', async () => {
  const { showModelPicker } = await import('../public/views/runs.js');
  assert.equal(showModelPicker({ agentModels: [], agentModelsUsable: true }), false);
  assert.equal(showModelPicker({ agentModels: ['sonnet'], agentModelsUsable: false }), false);
  assert.equal(showModelPicker({ agentModels: ['sonnet'], agentModelsUsable: true }), true);
  assert.equal(showModelPicker({}), false);
});

test('the defect panel wires the model select, the dispatch label and the log toggle through the pure helpers, never straight to state', async () => {
  const text = await read('views/runs.js');
  assert.match(text, /showModelPicker\(state\.config\)/, 'the model select must be gated by showModelPicker');
  assert.match(text, /dispatchButtonLabel\(d\)/, 'the dispatch button label must come from dispatchButtonLabel');
  assert.match(text, /actions\.dispatch\(defect\.id, modelSelect\?\.value\)/, 'dispatch must carry the picked model');
  assert.match(text, /actions\.toggleLog\(defect\.id\)/, 'the log button must call toggleLog, not fetch the log itself');
  assert.match(text, /state\.logVisible \? 'Hide log' : 'Show log'/);
});

test('the model picker is seeded from state and writes back to it, so it survives the redraw an unrelated verdict click causes (I5)', async () => {
  const text = await read('views/runs.js');
  assert.match(text, /onchange: \(e\) => actions\.setDispatchModel\(e\.target\.value\)/, 'picking a model must be saved into state, not left to die with the old DOM node');
  assert.match(text, /modelSelect\.value = state\.dispatchModel \?\? state\.config\.agentModels\[0\]/, 'the select must be seeded from the saved model on every render');
});

test('the filters pane opens and closes through state, not a DOM class flip a redraw silently undoes (I4)', async () => {
  const cases = await read('views/cases.js');
  assert.match(cases, /export function filtersToggleButton\(actions\)/, 'the toggle must take actions rather than reach into the DOM itself');
  assert.doesNotMatch(cases, /document\.querySelector\('\[data-pane="filters"\]'\)/, 'the toggle must not flip a class on the pane node directly');
  assert.match(cases, /'aside', \{ class: `pane\$\{state\.filtersOpen \? ' open' : ''\}`, 'data-pane': 'filters' \}/, 'the pane\'s open class must be derived from state.filtersOpen on every render');
  assert.match(cases, /el\('button', \{ class: 'filters-toggle', text: 'Close', onclick: \(\) => actions\.toggleFilters\(\) \}\)/, 'the pane needs its own close control now that .open can only be reached from state');
  // M1 and the shared-flag deferral: the Runs view's aside is a run list and a create-run
  // form, so it gets its own pane name, its own open flag and its own label. Sharing them hid
  // the run list behind a button marked Filters, and opening one pane opened the other.
  const runs = await read('views/runs.js');
  assert.match(runs, /class: `pane\$\{state\.runsPaneOpen \? ' open' : ''\}`, 'data-pane': 'runs'/, 'the Runs aside must have its own open flag and pane name');
  assert.doesNotMatch(runs, /state\.filtersOpen/, 'the Runs view must not share the Cases view filters flag');
  assert.match(runs, /paneToggleButton\('Runs', \(\) => actions\.toggleRunsPane\(\)\)/, 'the toggle that opens it must say what it opens');
  const css = await read('style.css');
  assert.match(css, /\.pane\[data-pane="filters"\], \.pane\[data-pane="runs"\] \{ display: none; \}/, 'the new pane name must hide below the breakpoint like the old one');
  assert.doesNotMatch(css, /\.toast\.error/, 'the error toast style is dead now the banner carries errors (M6)');
});

test('a running dispatch is polled every 5000ms, and the poll is cleared before every case or run switch', async () => {
  const text = await read('app.js');
  assert.match(text, /function schedulePoll\(defectId, dispatchState\) \{/);
  assert.match(text, /dispatchState !== 'running'/, 'the poll must stop once the dispatch is no longer running');
  // M5: a poll failure must back off and try again rather than raise the banner and stop.
  assert.match(text, /function armPoll\(defectId\) \{/);
  assert.match(text, /const delay = nextPollDelay\(pollFailures\);/);
  const armBody = text.slice(text.indexOf('function armPoll('), text.indexOf('async function dispatch('));
  // The manual Refresh action still banners on failure, and should; only the automatic poll
  // must stay quiet and retry.
  assert.doesNotMatch(armBody, /guarded\(/, 'a failed poll must not raise the full width banner');
  assert.match(armBody, /pollFailures \+= 1;\s*\n\s*armPoll\(defectId\);/, 'a failed poll must reschedule itself');
  const selectCaseBody = text.slice(text.indexOf('async function selectCase('), text.indexOf('selectCase.token = 0;'));
  assert.match(selectCaseBody, /clearPoll\(\);/, 'switching cases must clear any earlier poll');
  const selectRunBody = text.slice(text.indexOf('async function selectRun('), text.indexOf('let recordToken'));
  assert.match(selectRunBody, /clearPoll\(\);/, 'switching runs must clear any earlier poll');
});

test('refreshDefect drops a stale answer instead of showing a previous case\'s defect (I3)', async () => {
  const text = await read('app.js');
  const start = text.indexOf('async function refreshDefect(');
  const end = text.indexOf('async function toggleLog(');
  const body = text.slice(start, end);
  assert.match(body, /const token = selectCase\.token;/, 'refreshDefect must capture the current case token before its first await');
  assert.match(body, /if \(token !== selectCase\.token\) return;/, 'a case switch during the fetch must be checked before setState/schedulePoll run');
});

test('chipsFor labels a case with one chip per fact and a class per value', async () => {
  const { chipsFor } = await import('../public/chips.js');
  const chips = chipsFor({ priority: 'P0', severity: 'critical', type: 'security', automation: 'manual', tags: ['smoke'] });
  assert.deepEqual(chips.map((x) => x.text), ['P0', 'critical', 'security', 'smoke']);
  assert.equal(chips[0].className, 'chip p0');
  assert.equal(chips[1].className, 'chip sev-critical');
  assert.equal(chips[2].className, 'chip kind');
  assert.equal(chips[3].className, 'chip tag');
  // automation shows only when it is not the default
  assert.equal(chipsFor({ priority: 'P2', severity: 'minor', type: 'functional', automation: 'automated', tags: [] }).some((x) => x.text === 'automated'), true);
  assert.deepEqual(chipsFor({}).map((x) => x.text), []);
});

test('the stylesheet defines a colour for every priority and severity chip', async () => {
  const css = await read('style.css');
  for (const cls of ['.chip.p0', '.chip.p1', '.chip.p2', '.chip.p3', '.chip.sev-critical', '.chip.sev-major', '.chip.sev-minor']) {
    assert.ok(css.includes(cls), `style.css has no rule for ${cls}`);
  }
});

test('index.html carries an inline favicon and an svg sprite, and loads nothing from a network', async () => {
  const html = await read('index.html');
  assert.match(html, /<link rel="icon"[^>]+data:image\/svg\+xml/);
  for (const id of ['i-search', 'i-chevron', 'i-external']) assert.ok(html.includes(`id="${id}"`), `sprite is missing ${id}`);
  // The favicon is a standalone data-URI SVG image, which must declare its own xmlns to
  // render outside the HTML parser's foreign-content handling; that attribute value contains
  // "http://", so the network-free check below looks for an actual external src/href scheme
  // right after the opening quote, rather than banning the substring "http://" anywhere at all.
  // Both quote styles: the narrowed check (the favicon's xmlns legitimately carries a URL)
  // used to match only double quotes, so src='http://...' would have passed (M2).
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*['"]https?:\/\//);
  assert.doesNotMatch(html, /(?:src|href)\s*=\s*['"]\/\//, 'a protocol relative URL loads over the network too');
});

test('a failed fetch reports offline; any answer reports online again', async () => {
  const { api, onConnection } = await import('../public/api.js');
  const seen = [];
  onConnection((online) => seen.push(online));
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('network down'); };
    await assert.rejects(() => api.get('/api/cases'));
    assert.deepEqual(seen, [false]);
    globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data: [] }) });
    await api.get('/api/cases');
    assert.deepEqual(seen, [false, true]);
  } finally {
    globalThis.fetch = originalFetch;
    onConnection(() => {});
  }
});

test('nextSaveState never carries one case save state onto another', async () => {
  const { nextSaveState, fieldValue } = await import('../public/status.js');
  const idle = { caseId: null, actual: { status: 'idle', at: null, draft: null }, evidence: { status: 'idle', at: null, draft: null } };
  // case 1's actual save fails and keeps the tester's text as a draft
  const afterFail = nextSaveState(idle, idle, 'QA-0001', ['actual'], 'failed', null, { actual: 'SECRET case 1 text' });
  assert.equal(afterFail.actual.draft, 'SECRET case 1 text');
  // the tester moves to case 2 and saves its evidence. The shared slot must not re-point
  // case 1's actual draft at case 2, or the next blur writes case 1's text onto case 2.
  const afterCase2 = nextSaveState(afterFail, idle, 'QA-0002', ['evidence'], 'saved', '14:05:09');
  assert.equal(afterCase2.caseId, 'QA-0002');
  assert.equal(afterCase2.actual.draft, null, 'case 1 draft leaked onto case 2');
  assert.equal(fieldValue(afterCase2, { actual: 'case 2 own actual' }, 'actual', 'QA-0002'), 'case 2 own actual');
  // and the same case keeps its own other field across a write
  const sameCase = nextSaveState(afterFail, idle, 'QA-0001', ['evidence'], 'saved', '14:06:00');
  assert.equal(sameCase.actual.draft, 'SECRET case 1 text');
  // an empty field list changes nothing at all
  assert.equal(nextSaveState(afterFail, idle, 'QA-0002', [], 'saved'), afterFail);
});

test('a failed draft never crosses a run change, so the same case in another run keeps its own text', async () => {
  const { nextSaveState, fieldValue } = await import('../public/status.js');
  const idle = { caseId: null, runId: null, actual: { status: 'idle', at: null, draft: null }, evidence: { status: 'idle', at: null, draft: null } };
  // The tester is in run R-0001, the save of QA-0001's actual fails, and the typed text is
  // held as a draft so the box does not go blank under them.
  const afterFail = nextSaveState(idle, idle, 'QA-0001', ['actual'], 'failed', null, { actual: 'SECRET run 1 text' }, 'R-0001');
  assert.equal(fieldValue(afterFail, { actual: 'saved in run 1' }, 'actual', 'QA-0001', 'R-0001'), 'SECRET run 1 text');
  // They now switch to run R-0002 and open the same case. The draft belongs to the other
  // run, so run 2's own saved value must win; otherwise the next blur or the pagehide
  // flush writes run 1's text onto run 2's execution.
  assert.equal(fieldValue(afterFail, { actual: 'saved in run 2' }, 'actual', 'QA-0001', 'R-0002'), 'saved in run 2');
  assert.equal(fieldValue(afterFail, {}, 'actual', 'QA-0001', 'R-0002'), '');
  // A write in run 2 must start from the idle slot, not inherit run 1's other field.
  const afterRun2 = nextSaveState(afterFail, idle, 'QA-0001', ['evidence'], 'saved', '14:05:09', null, 'R-0002');
  assert.equal(afterRun2.actual.draft, null);
  assert.equal(afterRun2.runId, 'R-0002');
});

test('ownsSlot is the single answer for both the textarea seed and its label (re-review B)', async () => {
  const { ownsSlot, fieldValue } = await import('../public/status.js');
  const slot = { caseId: 'QA-0001', runId: 'R-0001', actual: { status: 'failed', at: null, draft: 'draft text' } };
  assert.equal(ownsSlot(slot, 'QA-0001', 'R-0001'), true);
  assert.equal(ownsSlot(slot, 'QA-0002', 'R-0001'), false);
  assert.equal(ownsSlot(slot, 'QA-0001', 'R-0002'), false);
  // The disagreement that was deferred: an idle slot holds null, and a caller with no case
  // passes undefined. Both must read as "this slot is not yours", the same way in both.
  const idle = { caseId: null, runId: null };
  assert.equal(ownsSlot(idle, undefined, undefined), true);
  assert.equal(ownsSlot(idle, 'QA-0001', null), false);
  assert.equal(fieldValue(slot, { actual: 'saved' }, 'actual', 'QA-0001', 'R-0001'), 'draft text');
  assert.equal(fieldValue(slot, { actual: 'saved' }, 'actual', 'QA-0001', 'R-0002'), 'saved');
});

test('applyWrite refuses a write answered after the tester changed run or started a newer write', async () => {
  const { applyWrite } = await import('../public/status.js');
  assert.equal(applyWrite('R-0001', 'R-0001', 7, 7), true);
  // The deferred defect: the run changed while the write was in flight, so its execution
  // would land on the row now showing a different run.
  assert.equal(applyWrite('R-0002', 'R-0001', 7, 7), false);
  assert.equal(applyWrite('R-0001', 'R-0001', 8, 7), false);
  assert.equal(applyWrite(null, null, 1, 1), true);
});

test('nextPollDelay keeps polling through a hiccup and gives up after a run of failures (M5)', async () => {
  const { nextPollDelay } = await import('../public/status.js');
  assert.equal(nextPollDelay(0), 5000);
  assert.equal(nextPollDelay(1), 10000);
  assert.equal(nextPollDelay(2), 15000);
  assert.equal(nextPollDelay(3), null);
});

test('the selected run card counts from the cases on screen, so it cannot disagree with the strip (qd-d1e)', async () => {
  const { liveSummary } = await import('../public/views/runs.js');
  const run = { id: 'R-0001', caseIds: ['QA-0001', 'QA-0002'], summary: { total: 2, executed: 0, counts: { passed: 0, failed: 0, blocked: 0, skipped: 0, retest: 0, untested: 2 } } };
  const cases = [
    { id: 'QA-0001', execution: { status: 'passed' } },
    { id: 'QA-0002', execution: null },
  ];
  // Another run's row keeps the number the server sent with the runs list.
  assert.equal(liveSummary(run, 'R-0002', cases).executed, 0);
  // The selected run's row is counted from the same cases the strip counts, so recording a
  // verdict moves both at once instead of leaving the card at "0 of 2 done" until a reload.
  assert.equal(liveSummary(run, 'R-0001', cases).executed, 1);
  assert.equal(liveSummary(run, 'R-0001', cases).total, 2);
});
