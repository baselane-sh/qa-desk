import { api } from './api.js';
import { renderCases } from './views/cases.js';
import { renderRuns } from './views/runs.js';
import { hasModifier, keyToStatus } from './keys.js';

const VIEWS = { cases: renderCases, runs: renderRuns };

let state = { config: null, cases: [], runs: [], run: null, executions: {}, selectedId: null, filters: {}, view: 'cases', history: [], defect: null, log: '', bootError: null, showClosed: false, confirmClose: null };
const root = document.getElementById('root');
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

async function selectCase(id) {
  const history = id ? await api.get(`/api/cases/${encodeURIComponent(id)}/history`) : [];
  const defect = id && state.run ? await findDefect(state.run.id, id) : null;
  setState({ selectedId: id, history, defect, log: '' });
}

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

const actions = {
  select: (id) => guarded(() => selectCase(id)),
  setFilters: (filters) => setState({ filters }),
  record: (caseId, patch) => guarded(() => record(caseId, patch)),
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

function render() {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  root.replaceChildren();
  VIEWS[state.view](root, state, actions);
}

function visibleIds() {
  return [...root.querySelectorAll('.list li[data-id]')].map((li) => li.dataset.id);
}

function onKey(event) {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  if (hasModifier(event)) return;
  const ids = visibleIds();
  const i = ids.indexOf(state.selectedId);
  if (event.key === 'j' && ids.length) actions.select(ids[Math.min(i + 1, ids.length - 1)]);
  else if (event.key === 'k' && ids.length) actions.select(ids[Math.max(i - 1, 0)]);
  else {
    const status = keyToStatus(event);
    if (status && state.selectedId && state.run) actions.record(state.selectedId, { status });
  }
}

document.getElementById('tabs').addEventListener('click', (e) => { if (e.target.dataset.view) actions.setView(e.target.dataset.view); });
document.addEventListener('keydown', onKey);

async function boot() {
  try {
    const [config, runs] = await Promise.all([api.get('/api/config'), api.get('/api/runs')]);
    setState({ config, runs });
    await loadCases();
  } catch (err) {
    // A toast alone clears after 6 seconds and leaves the page stuck on "Loading" for ever
    // with nothing on screen explaining why, so the failure is kept in state too.
    setState({ bootError: err.message });
    toast(err.message, true);
  }
}
boot();
