import { api, onConnection } from './api.js';
import { renderCases, el, filterOptions } from './views/cases.js';
import { renderRuns } from './views/runs.js';
import { nextIndex, debounce, keyAction } from './keys.js';
import { loadFilters, saveFilters } from './filters-store.js';
import { captureField, restoreField } from './ui-restore.js';
import { connectionLabel, OFFLINE_HELP } from './status.js';

const VIEWS = { cases: renderCases, runs: renderRuns };
// caseId isolates this shared, single-slot save state to whichever case it was actually
// written for (see fieldValue/saveStateNode); null never matches a real case id.
const IDLE_SAVE_STATE = { caseId: null, actual: { status: 'idle', at: null, draft: null }, evidence: { status: 'idle', at: null, draft: null } };

let state = { config: null, cases: [], runs: [], run: null, executions: {}, selectedId: null, filters: {}, view: 'cases', history: [], historyLoaded: false, defect: null, log: '', logVisible: false, bootError: null, showClosed: false, confirmClose: null, help: false, scrollToSelected: false, online: true, saveState: IDLE_SAVE_STATE, filtersOpen: false, dispatchModel: null };
const root = document.getElementById('root');
const overlayRoot = document.getElementById('overlay-root');
const toastEl = document.getElementById('toast');
const runBadge = document.getElementById('run-badge');
const bannerWrap = document.getElementById('banner-wrap');
const connDot = document.getElementById('conn-dot');
const connLabel = document.getElementById('conn-label');
const offlineHelp = document.getElementById('offline-help');

export function setState(patch) {
  state = { ...state, ...patch };
  render();
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, 2500);
}

// The banner replaces the vanishing toast for errors: it stays up long enough to read, and
// the tester can dismiss it early. A later error resets the timer instead of stacking.
function showBanner(message) {
  clearTimeout(showBanner.timer);
  bannerWrap.replaceChildren(el('div', { class: 'banner' }, [
    el('span', { text: message }),
    el('button', { text: 'Dismiss', onclick: () => bannerWrap.replaceChildren() }),
  ]));
  showBanner.timer = setTimeout(() => bannerWrap.replaceChildren(), 8000);
}

async function guarded(fn) {
  try { await fn(); } catch (err) { showBanner(err.message); }
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
  clearPoll();
  // saveState is left as-is here on purpose: it already carries the case id it belongs to
  // (see fieldValue), so switching cases no longer needs to reset it, and a failed draft for
  // the case just left is not silently dropped, it just stops being shown until that case is
  // selected again.
  setState({ selectedId: id, history: [], historyLoaded: false, defect: null, log: '', logVisible: false, scrollToSelected: true });
  if (!id) return;
  const history = await api.get(`/api/cases/${encodeURIComponent(id)}/history`);
  const defect = state.run ? await findDefect(state.run.id, id) : null;
  if (token !== selectCase.token) return;
  setState({ history, historyLoaded: true, defect });
  schedulePoll(defect?.id, defect?.dispatch?.state);
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
  clearPoll();
  const runs = await api.get('/api/runs');
  setState({ runs, run, selectedId: null, defect: null, log: '', logVisible: false, confirmClose: null });
  await loadCases();
}

let recordToken = 0;

function nowLabel() {
  return new Date().toLocaleTimeString([], { hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Only 'actual' and 'evidence' carry a save state label in the UI; a patch that only
// touches status, duration, env or locale leaves saveState untouched (fields is empty). A
// failed save keeps its draft (the value the tester typed) so a redraw can put it straight
// back in the field instead of falling back to the last saved value; a saved one clears it.
// caseId is stamped on every write so fieldValue/saveStateNode can tell "this case's own
// save state" from "the case that was selected the last time a write completed".
function markFields(caseId, fields, status, at = null, draftPatch = null) {
  if (!fields.length) return state.saveState;
  const next = { ...state.saveState, caseId };
  for (const f of fields) next[f] = { status, at, draft: draftPatch?.[f] ?? null };
  return next;
}

// Two records on the same case inside one round trip can otherwise resolve out of order,
// with the older response landing last and overwriting the newer one. A token per call, and
// computing cases only once every await has settled, means a response that is no longer the
// most recent call is dropped instead of applied.
//
// A verdict button or key press has already settled focus by the time this runs, so it is
// applied to state.cases before the request goes out: the case row, the status strip and the
// tally all read from state.cases, so all three move at once. A blur handler is still
// mid-transition when IT calls this, though: redrawing synchronously there would tear down
// the very field the browser is about to focus next (this is the exact hazard the earlier
// capture/restore fixes exist for), so a text-only patch never redraws before its response
// and only ever shows 'saved' or 'failed', never 'saving'.
async function record(caseId, patch) {
  if (!state.run) { showBanner('Create or pick a run first'); return; }
  if (state.run.closedAt) { showBanner('This run is closed'); return; }
  const token = ++recordToken;
  const fields = ['actual', 'evidence'].filter((f) => f in patch);
  const previousExecution = state.cases.find((c) => c.id === caseId)?.execution;
  if ('status' in patch) {
    setState({ cases: state.cases.map((c) => (c.id === caseId ? { ...c, execution: { ...previousExecution, ...patch } } : c)) });
  }
  let execution;
  try {
    execution = await api.put(`/api/runs/${encodeURIComponent(state.run.id)}/executions/${encodeURIComponent(caseId)}`, patch);
  } catch (err) {
    // The cases rollback is gated on this call still being the most recent one for this
    // case. Without the gate, a slower failing call (A) can restore its stale pre-image over
    // a faster call (B) that already succeeded and is on screen: press two verdicts quickly,
    // B lands first and shows the server's answer, then A fails and would otherwise wipe it
    // back out. The field itself is still marked failed either way, so the draft is never lost.
    //
    // Residual, not closed by this gate: if A and B *both* fail, B's own previousExecution is
    // A's optimistic value, which the server never confirmed, so B's rollback (when it is the
    // most recent) restores a verdict that was never real. Closing that needs a refetch of
    // this case's execution on failure instead of restoring a captured pre-image.
    const patchOut = { saveState: markFields(caseId, fields, 'failed', null, patch) };
    if (token === recordToken) patchOut.cases = state.cases.map((c) => (c.id === caseId ? { ...c, execution: previousExecution } : c));
    setState(patchOut);
    throw err;
  }
  const history = state.selectedId === caseId ? await api.get(`/api/cases/${encodeURIComponent(caseId)}/history`) : state.history;
  if (token !== recordToken) {
    // A newer call for this case already owns `cases`/`history`, but this write still
    // succeeded: its field must not be left showing a stale draft or a stale 'failed' label.
    if (fields.length) setState({ saveState: markFields(caseId, fields, 'saved', nowLabel()) });
    return;
  }
  const cases = state.cases.map((c) => (c.id === caseId ? { ...c, execution } : c));
  setState({ cases, history, saveState: markFields(caseId, fields, 'saved', nowLabel()) });
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

// A dispatch that is still running is polled every 5 seconds so its state, and the log if the
// tester has it open, keep moving on screen without a manual Refresh; the poll stops itself
// the moment the dispatch is no longer running, and any earlier timer is always cleared first
// so a fast sequence of dispatches or case switches never leaves two polls ticking at once.
let pollTimer = null;
function clearPoll() { clearTimeout(pollTimer); pollTimer = null; }
function schedulePoll(defectId, dispatchState) {
  clearPoll();
  if (!defectId || dispatchState !== 'running') return;
  pollTimer = setTimeout(() => guarded(() => refreshDefect(defectId)), 5000);
}

async function dispatch(defectId, model) {
  await api.post(`/api/defects/${encodeURIComponent(defectId)}/dispatch`, model ? { model } : {});
  toast('Agent dispatched');
  await refreshDefect(defectId);
}

async function refreshDefect(defectId) {
  // clearPoll only cancels a pending timer, not a fetch already in flight: this call can
  // still be running when the tester switches to a different case. selectCase.token is
  // bumped on every case switch, so capturing it here and checking it again before this
  // call's own setState/schedulePoll drops a stale answer instead of showing case A's
  // defect (and re-arming its poll) inside case B's pane.
  const token = selectCase.token;
  const defect = await api.get(`/api/defects/${encodeURIComponent(defectId)}`);
  let log = state.log;
  if (state.logVisible) {
    try { log = defect.dispatch?.log ? await api.text(`/api/defects/${encodeURIComponent(defectId)}/log`) : ''; } catch { log = ''; }
  }
  if (token !== selectCase.token) return;
  setState({ defect, log });
  schedulePoll(defectId, defect.dispatch?.state);
}

async function toggleLog(defectId) {
  if (state.logVisible) { setState({ logVisible: false, log: '' }); return; }
  let log = '';
  try { log = await api.text(`/api/defects/${encodeURIComponent(defectId)}/log`); } catch { log = ''; }
  setState({ logVisible: true, log });
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
  dispatch: (defectId, model) => guarded(() => dispatch(defectId, model)),
  refreshDefect: (defectId) => guarded(() => refreshDefect(defectId)),
  toggleLog: (defectId) => guarded(() => toggleLog(defectId)),
  createRun: (input) => guarded(() => createRun(input)),
  selectRun: (run) => guarded(() => selectRun(run)),
  askCloseRun: (runId) => setState({ confirmClose: runId }),
  cancelClose: () => setState({ confirmClose: null }),
  closeRun: (runId) => guarded(() => closeCurrentRun(runId)),
  toggleClosed: () => setState({ showClosed: !state.showClosed }),
  setView: (view) => setState({ view, confirmClose: null }),
  toggleFilters: () => setState({ filtersOpen: !state.filtersOpen }),
  setDispatchModel: (model) => setState({ dispatchModel: model }),
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

function renderConnection() {
  const { text, className } = connectionLabel(state.online);
  connDot.className = className;
  connLabel.textContent = text;
  offlineHelp.textContent = OFFLINE_HELP;
  offlineHelp.hidden = state.online;
}

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  renderConnection();
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
onConnection((online) => { if (online !== state.online) setState({ online }); });

// A tab closed (or reloaded) while a field is still focused never fires that field's blur
// handler, so its edit would otherwise be lost. pagehide is the last moment a script runs
// before the page goes away; fetch's keepalive flag lets the request outlive it. This
// bypasses api.js on purpose: there is no page left to show the response to.
window.addEventListener('pagehide', () => {
  const active = document.activeElement;
  const field = active?.dataset?.focusKey;
  if (field !== 'actual' && field !== 'evidence') return;
  if (!state.run || state.run.closedAt || !state.selectedId) return;
  const c = state.cases.find((x) => x.id === state.selectedId);
  const value = active.value;
  if ((c?.execution?.[field] ?? '') === value) return;
  const url = `/api/runs/${encodeURIComponent(state.run.id)}/executions/${encodeURIComponent(state.selectedId)}`;
  try {
    fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ [field]: value }), keepalive: true });
  } catch { /* best effort: the page is already gone */ }
});

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
    showBanner(err.message);
  }
}
boot();
