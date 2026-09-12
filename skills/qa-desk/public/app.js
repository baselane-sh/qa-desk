import { api } from './api.js';
import { renderCases, el, filterOptions } from './views/cases.js';
import { renderRuns } from './views/runs.js';
import { nextIndex, debounce, keyAction } from './keys.js';
import { loadFilters, saveFilters } from './filters-store.js';
import { captureField, restoreField } from './ui-restore.js';

const VIEWS = { cases: renderCases, runs: renderRuns };

let state = { config: null, cases: [], runs: [], run: null, executions: {}, selectedId: null, filters: {}, view: 'cases', history: [], historyLoaded: false, defect: null, log: '', bootError: null, showClosed: false, confirmClose: null, help: false, scrollToSelected: false };
const root = document.getElementById('root');
const overlayRoot = document.getElementById('overlay-root');
const toastEl = document.getElementById('toast');
const runBadge = document.getElementById('run-badge');

export function setState(patch) {
  state = { ...state, ...patch };
  render();
}

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.toggle('error', isError);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, isError ? 6000 : 2500);
}

async function guarded(fn) {
  try { await fn(); } catch (err) { toast(err.message, true); }
}

async function loadCases() {
  const path = state.run ? `/api/cases?runId=${encodeURIComponent(state.run.id)}` : '/api/cases';
  const cases = await api.get(path);
  setState({ cases });
}

// Setting selectedId at once, before either fetch resolves, is what makes the row highlight
// and the detail pane switch feel instant. A token per call means a slower, older selection
// that resolves after a newer one cannot overwrite the newer answer.
async function selectCase(id) {
  const token = ++selectCase.token;
  setState({ selectedId: id, history: [], historyLoaded: false, defect: null, log: '', scrollToSelected: true });
  if (!id) return;
  const history = await api.get(`/api/cases/${encodeURIComponent(id)}/history`);
  const defect = state.run ? await findDefect(state.run.id, id) : null;
  if (token !== selectCase.token) return;
  setState({ history, historyLoaded: true, defect });
}
selectCase.token = 0;

async function findDefect(runId, caseId) {
  const c = state.cases.find((x) => x.id === caseId);
  if (!c?.defectId) return null;
  try { return await api.get(`/api/defects/${encodeURIComponent(c.defectId)}`); } catch { return null; }
}

async function selectRun(run) {
  runBadge.textContent = run ? `${run.name} on ${run.build} (${run.env})` : 'No run selected';
  runBadge.classList.toggle('muted', !run);
  const runs = await api.get('/api/runs');
  setState({ runs, run, selectedId: null, defect: null, log: '', confirmClose: null });
  await loadCases();
}

let recordToken = 0;

// Two records on the same case inside one round trip can otherwise resolve out of order,
// with the older response landing last and overwriting the newer one. A token per call, and
// computing cases only once every await has settled, means a response that is no longer the
// most recent call is dropped instead of applied.
async function record(caseId, patch) {
  if (!state.run) { toast('Create or pick a run first', true); return; }
  if (state.run.closedAt) { toast('This run is closed', true); return; }
  const token = ++recordToken;
  const execution = await api.put(`/api/runs/${encodeURIComponent(state.run.id)}/executions/${encodeURIComponent(caseId)}`, patch);
  const history = state.selectedId === caseId ? await api.get(`/api/cases/${encodeURIComponent(caseId)}/history`) : state.history;
  if (token !== recordToken) return;
  const cases = state.cases.map((c) => (c.id === caseId ? { ...c, execution } : c));
  setState({ cases, history });
}

// caseHistory on the server is every append to executions.jsonl for this case, oldest first,
// each one a full snapshot (not a diff). The entry before the last one for this run is what
// "undo" restores. Untested is the absence of an execution and the store is append only, so
// with fewer than two entries there is nothing earlier to go back to.
async function undo(caseId) {
  if (!caseId || !state.run) return;
  const history = state.historyLoaded ? state.history : await api.get(`/api/cases/${encodeURIComponent(caseId)}/history`);
  const entries = history.filter((h) => h.runId === state.run.id);
  if (entries.length < 2) { toast('Nothing to undo for this case in this run.'); return; }
  const previous = entries[entries.length - 2];
  await record(caseId, { status: previous.status, actual: previous.actual ?? '', evidence: previous.evidence ?? '' });
}

async function openDefect(caseId) {
  const defect = await api.post('/api/defects', { runId: state.run.id, caseId });
  await loadCases();
  setState({ defect: await api.get(`/api/defects/${defect.id}`) });
  toast(`Opened ${defect.id}`);
}

async function dispatch(defectId) {
  await api.post(`/api/defects/${encodeURIComponent(defectId)}/dispatch`);
  toast('Agent dispatched');
  await refreshDefect(defectId);
}

async function refreshDefect(defectId) {
  const defect = await api.get(`/api/defects/${encodeURIComponent(defectId)}`);
  let log = '';
  if (defect.dispatch?.log) { try { log = await api.text(`/api/defects/${encodeURIComponent(defectId)}/log`); } catch { log = ''; } }
  setState({ defect, log });
}

async function createRun(input) {
  const run = await api.post('/api/runs', input);
  const runs = await api.get('/api/runs');
  setState({ runs, view: 'runs' });
  await selectRun(run);
  toast(`Created ${run.id}`);
}

async function closeCurrentRun(runId) {
  const closed = await api.post(`/api/runs/${encodeURIComponent(runId)}/close`);
  const runs = await api.get('/api/runs');
  setState({ runs, confirmClose: null });
  if (state.run?.id === runId) await selectRun(closed);
  toast(`Closed ${runId}`);
}

// window.localStorage is a getter that can itself throw (e.g. site data blocked), before
// filters-store.js's own try/catch around getItem/setItem ever runs. A blocked store must
// never stop the app from rendering, so the getter is read behind its own guard and a
// no-op fallback stands in when it is unavailable.
function storage() {
  try { return window.localStorage; } catch { return null; }
}
const NULL_STORE = { getItem: () => null, setItem() {} };

// Every filter change is persisted, not just the ones made through a select: setFilters
// covers the selects, and setSearch (below) routes through this too, so the search box
// sticks across a reload exactly like every other filter.
function commitFilters(filters) {
  saveFilters(storage() ?? NULL_STORE, filters);
  setState({ filters });
}

// Built once so the debounce timer survives redraws; rebuilding it on every render would
// reset the timer on every keystroke and the search box would never fire.
const setSearchDebounced = debounce((q) => commitFilters({ ...state.filters, q: q || undefined }), 140);

const actions = {
  select: (id) => guarded(() => selectCase(id)),
  setFilters: (filters) => commitFilters(filters),
  clearFilters: () => commitFilters({}),
  setSearch: (q) => setSearchDebounced(q),
  reload: () => boot(),
  record: (caseId, patch) => guarded(() => record(caseId, patch)),
  undo: () => guarded(() => undo(state.selectedId)),
  openDefect: (caseId) => guarded(() => openDefect(caseId)),
  dispatch: (defectId) => guarded(() => dispatch(defectId)),
  refreshDefect: (defectId) => guarded(() => refreshDefect(defectId)),
  createRun: (input) => guarded(() => createRun(input)),
  selectRun: (run) => guarded(() => selectRun(run)),
  askCloseRun: (runId) => setState({ confirmClose: runId }),
  cancelClose: () => setState({ confirmClose: null }),
  closeRun: (runId) => guarded(() => closeCurrentRun(runId)),
  toggleClosed: () => setState({ showClosed: !state.showClosed }),
  setView: (view) => setState({ view, confirmClose: null }),
};

// A redraw replaces the whole pane subtree, which by default drops scroll position and
// input focus even when the same field is still logically on screen. Every scrollable
// pane and every field the user types in carries a stable identity (data-pane /
// data-focus-key) precisely so a redraw can put both back afterward.
function captureUi() {
  const scroll = {};
  for (const pane of root.querySelectorAll('[data-pane]')) scroll[pane.dataset.pane] = pane.scrollTop;
  const { key, caret, value } = captureField(document.activeElement);
  return { scroll, key, caret, value };
}

function restoreUi({ scroll, key, caret, value }) {
  for (const pane of root.querySelectorAll('[data-pane]')) {
    if (scroll[pane.dataset.pane] !== undefined) pane.scrollTop = scroll[pane.dataset.pane];
  }
  if (!key) return;
  const next = root.querySelector(`[data-focus-key="${key}"]`);
  restoreField(next, { caret, value });
}

const HELP_ROWS = [
  ['j / k', 'Move the selection up or down'],
  ['p f b s r', 'Record a verdict: passed, failed, blocked, skipped, retest'],
  ['u', 'Undo: restore the previous verdict for this case in this run'],
  ['Enter', 'Focus the actual result field'],
  ['/', 'Focus search'],
  ['Esc', 'Leave the current field, or close this'],
  ['?', 'Show this help'],
];

function helpOverlay() {
  return el('div', { class: 'overlay' }, [
    el('div', { class: 'overlay-panel' }, [
      el('h2', { text: 'Keyboard shortcuts' }),
      el('dl', { class: 'kv' }, HELP_ROWS.flatMap(([keys, desc]) => [el('dt', {}, [el('kbd', { text: keys })]), el('dd', { text: desc })])),
      el('div', { class: 'actions' }, [el('button', { class: 'primary', text: 'Close', onclick: () => setState({ help: false }) })]),
    ]),
  ]);
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  const ui = captureUi();
  root.replaceChildren();
  VIEWS[state.view](root, state, actions);
  restoreUi(ui);
  if (state.scrollToSelected) {
    root.querySelector('.list li.selected')?.scrollIntoView({ block: 'nearest' });
    state = { ...state, scrollToSelected: false };
  }
  overlayRoot.replaceChildren();
  if (state.help) overlayRoot.append(helpOverlay());
}

function visibleIds() {
  return [...root.querySelectorAll('.list li[data-id]')].map((li) => li.dataset.id);
}

function onKey(event) {
  const action = keyAction(event, { hasSelection: Boolean(state.selectedId), hasRun: Boolean(state.run) && !state.run.closedAt, overlayOpen: state.help });
  if (!action) return;
  event.preventDefault();
  if (action.type === 'move') {
    const ids = visibleIds();
    const i = nextIndex(ids.length, ids.indexOf(state.selectedId), action.delta);
    if (i >= 0) actions.select(ids[i]);
  } else if (action.type === 'status') {
    actions.record(state.selectedId, { status: action.status });
  } else if (action.type === 'undo') {
    actions.undo();
  } else if (action.type === 'help') {
    setState({ help: true });
  } else if (action.type === 'focusField') {
    root.querySelector(`[data-focus-key="${action.field}"]`)?.focus();
  } else if (action.type === 'search') {
    root.querySelector('[data-focus-key="q"]')?.focus();
  } else if (action.type === 'blur') {
    document.activeElement?.blur?.();
    if (state.help) setState({ help: false });
  }
}

document.getElementById('tabs').addEventListener('click', (e) => { if (e.target.dataset.view) actions.setView(e.target.dataset.view); });
document.addEventListener('keydown', onKey);

async function boot() {
  try {
    const [config, runs] = await Promise.all([api.get('/api/config'), api.get('/api/runs')]);
    setState({ config, runs, bootError: null });
    await loadCases();
    // sanitizeFilters needs both the config lists and the tags derived from the loaded
    // cases, so a saved filter set can only be trusted once both are in state.
    setState({ filters: loadFilters(storage() ?? NULL_STORE, filterOptions(state)) });
  } catch (err) {
    // A toast alone clears after 6 seconds and leaves the page stuck on "Loading" for ever
    // with nothing on screen explaining why, so the failure is kept in state too.
    setState({ bootError: err.message });
    toast(err.message, true);
  }
}
boot();
