import { el, renderList, renderProgress, renderCaseDetail, matchesFilters, statusOf } from './cases.js';

const STATUSES = ['passed', 'failed', 'blocked', 'skipped', 'retest'];
const DEFECT_STATUSES = ['failed', 'blocked'];

export const isClosed = (run) => Boolean(run?.closedAt);

export function visibleRuns(runs, { showClosed = false, selectedId = null } = {}) {
  return [...runs].reverse().filter((r) => showClosed || !isClosed(r) || r.id === selectedId);
}

// Every case whose id is in the run's frozen caseIds list, regardless of the active
// filters. This is the denominator renderList needs to tell "nothing has ever been in this
// run" apart from "the filters hide everything that is" (see the `total` parameter).
export function inRunCases(cases, run) {
  if (!run?.caseIds) return [];
  return cases.filter((c) => run.caseIds.includes(c.id));
}

export function executionDefaults(c, run) {
  return { env: c.execution?.env ?? run.env, locale: c.execution?.locale ?? run.locale };
}

export function needsStatusFirst(c) {
  return statusOf(c) === 'untested';
}

// The browser cannot import from scripts/lib, so this list is a copy of
// SUMMARY_STATUSES in scripts/lib/runs.mjs. Keep the two in step.
export const SUMMARY_STATUSES = ['passed', 'failed', 'blocked', 'skipped', 'retest', 'untested'];

export function countStatuses(cases) {
  const counts = Object.fromEntries(SUMMARY_STATUSES.map((s) => [s, 0]));
  for (const c of cases) {
    const status = statusOf(c);
    counts[SUMMARY_STATUSES.includes(status) ? status : 'untested'] += 1;
  }
  return { total: cases.length, executed: cases.length - counts.untested, counts };
}

export function summaryLabel(summary) {
  return summary ? `${summary.executed} of ${summary.total} done` : '';
}

/**
 * countStatuses(cases) only sees cases still in cases.json, so if a case id in the run's
 * frozen list has since been removed the total it derives falls short of run.summary.total
 * (scripts/lib/runs.mjs, counted straight from caseIds) and the header disagrees with the
 * run list badge. Folding in run.summary.total, and counting the gap as untested, keeps the
 * two totals in step and treats a missing case the same way the server already does.
 */
export function headerSummary(counted, runSummary) {
  if (!runSummary) return counted;
  const missing = runSummary.total - counted.total;
  if (missing <= 0) return { ...counted, total: runSummary.total };
  const counts = { ...counted.counts, untested: counted.counts.untested + missing };
  return { total: runSummary.total, executed: runSummary.total - counts.untested, counts };
}

export function defectHint(status) {
  return DEFECT_STATUSES.includes(status) ? null : 'Needs a failed or blocked execution';
}

function newRunForm(state, actions) {
  const { config } = state;
  const name = el('input', { 'data-focus-key': 'run-name', placeholder: 'Sprint 12 regression' });
  const build = el('input', { 'data-focus-key': 'run-build', placeholder: 'v1.4.0 or commit sha' });
  const env = el('select', { 'data-focus-key': 'run-env' }, config.environments.map((e) => el('option', { value: e, text: e })));
  const locale = el('select', { 'data-focus-key': 'run-locale' }, config.locales.map((l) => el('option', { value: l, text: l })));
  const scope = el('select', { 'data-focus-key': 'run-scope' }, [el('option', { value: 'all', text: 'All cases' }), el('option', { value: 'filter', text: 'Cases matching the current filters' })]);
  const submit = el('button', { class: 'primary', text: 'Create run', onclick: () => {
    const pool = state.cases.filter((c) => !c.supersededBy && (scope.value === 'all' || matchesFilters(c, state.filters)));
    actions.createRun({ name: name.value.trim(), build: build.value.trim(), env: env.value, locale: locale.value, caseIds: pool.map((c) => c.id) });
  } });
  return el('div', { class: 'form' }, [el('h2', { text: 'New run' }), el('label', { text: 'Name' }, [name]), el('label', { text: 'Build' }, [build]), el('label', { text: 'Environment' }, [env]), el('label', { text: 'Locale' }, [locale]), el('label', { text: 'Scope' }, [scope]), el('div', { class: 'actions' }, [submit])]);
}

function runList(state, actions) {
  const toggle = el('input', { type: 'checkbox', 'data-focus-key': 'show-closed', onchange: () => actions.toggleClosed() });
  toggle.checked = Boolean(state.showClosed);
  const bar = el('label', { class: 'inline', text: 'Show closed' }, [toggle]);
  const rows = visibleRuns(state.runs, { showClosed: state.showClosed, selectedId: state.run?.id ?? null });
  if (!rows.length) {
    return el('div', {}, [bar, el('p', { class: 'empty', text: state.runs.length ? 'Every run is closed' : 'No runs yet' })]);
  }
  const items = rows.map((r) => el('li', { class: state.run?.id === r.id ? 'selected' : '', onclick: () => actions.selectRun(r) }, [
    el('span', { text: `${r.id} ${r.name}` }),
    isClosed(r) ? el('span', { class: 'badge closed', text: 'Closed' }) : el('span', { class: 'badge', text: summaryLabel(r.summary) || `${r.caseIds.length} cases` }),
    el('span', { class: 'meta', text: `${r.build} · ${r.env} · ${r.createdAt.slice(0, 10)}` }),
  ]));
  return el('div', {}, [bar, el('ul', { class: 'list' }, items)]);
}

function closeControl(state, actions) {
  const run = state.run;
  if (isClosed(run)) return el('span', { class: 'badge closed', text: 'Closed' });
  if (state.confirmClose === run.id) {
    return el('span', { class: 'actions' }, [
      el('span', { class: 'badge muted', text: 'Close this run? No further executions can be recorded.' }),
      el('button', { class: 'primary', text: 'Confirm close', onclick: () => actions.closeRun(run.id) }),
      el('button', { text: 'Cancel', onclick: () => actions.cancelClose() }),
    ]);
  }
  return el('button', { text: 'Close run', onclick: () => actions.askCloseRun(run.id) });
}

function statusStrip(summary) {
  const shown = SUMMARY_STATUSES.filter((s) => summary.counts[s] > 0);
  const width = (s) => `width:${(summary.counts[s] / Math.max(1, summary.total)) * 100}%`;
  return el('div', { class: 'strip' }, [
    el('div', { class: 'bar' }, shown.map((s) => el('span', { class: s, style: width(s) }))),
    ...shown.map((s) => el('span', { class: `status ${s}`, text: `${s} ${summary.counts[s]}` })),
  ]);
}

function statusFilter(state, actions) {
  const box = el('select', { 'data-focus-key': 'filter-status', onchange: (e) => actions.setFilters({ ...state.filters, status: e.target.value || undefined }) }, [
    el('option', { value: '', text: 'All statuses' }),
    ...SUMMARY_STATUSES.map((s) => el('option', { value: s, text: s })),
  ]);
  box.value = state.filters.status ?? '';
  return el('label', { class: 'inline', text: 'Status' }, [box]);
}

function closedExecutionPanel(c, state) {
  const execution = c.execution;
  return el('div', {}, [
    el('h4', { text: `Execution in ${state.run.id}` }),
    el('p', {}, [el('span', { class: `status ${statusOf(c)}`, text: statusOf(c) })]),
    el('p', { class: 'muted', text: 'This run is closed. Its executions cannot be changed.' }),
    execution?.actual ? el('div', {}, [el('h4', { text: 'Actual result' }), el('pre', { class: 'quote', text: execution.actual })]) : null,
    execution?.evidence ? el('div', {}, [el('h4', { text: 'Evidence' }), el('pre', { class: 'quote', text: execution.evidence })]) : null,
  ]);
}

function pickList(values, current, locked, onchange, focusKey) {
  const box = el('select', { 'data-focus-key': focusKey, onchange: (e) => onchange(e.target.value) }, values.map((v) => el('option', { value: v, text: v })));
  box.value = current;
  box.disabled = locked;
  return box;
}

function executionPanel(c, state, actions) {
  const status = statusOf(c);
  const locked = needsStatusFirst(c);
  const lock = locked ? 'disabled' : null;
  const { env, locale } = executionDefaults(c, state.run);
  const buttons = el('div', { class: 'verdicts' }, STATUSES.map((s) => el('button', { class: `status-btn ${s === status ? 'on' : ''}`, text: s, onclick: () => actions.record(c.id, { status: s }) }, [el('kbd', { text: s[0] })])));
  const actual = el('textarea', { 'data-focus-key': 'actual', placeholder: 'Actual result: what you saw, step number, error text', disabled: lock, onblur: (e) => { if (e.target.value !== (c.execution?.actual ?? '')) actions.record(c.id, { actual: e.target.value }); } });
  actual.value = c.execution?.actual ?? '';
  const evidence = el('textarea', { 'data-focus-key': 'evidence', placeholder: 'Evidence: links or paths to screenshots, logs or recordings', disabled: lock, onblur: (e) => { if (e.target.value !== (c.execution?.evidence ?? '')) actions.record(c.id, { evidence: e.target.value }); } });
  evidence.value = c.execution?.evidence ?? '';
  const duration = el('input', { 'data-focus-key': 'duration', type: 'number', min: '0', placeholder: 'seconds', value: c.execution?.durationSec ?? '', disabled: lock, onblur: (e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v !== c.execution?.durationSec) actions.record(c.id, { durationSec: v }); } });
  const envBox = pickList([...state.config.environments, 'any'], env, locked, (v) => actions.record(c.id, { env: v }), 'env');
  const localeBox = pickList([...state.config.locales, 'any'], locale, locked, (v) => actions.record(c.id, { locale: v }), 'locale');
  return el('div', {}, [
    el('h4', { text: `Execution in ${state.run.id}` }),
    buttons,
    locked ? el('p', { class: 'muted', text: 'Record a status first. The details below open once this case has an execution.' }) : null,
    el('label', { text: 'Actual result' }, [actual]),
    el('label', { text: 'Evidence' }, [evidence]),
    el('div', { class: 'fields' }, [
      el('label', { text: 'Duration (s)' }, [duration]),
      el('label', { text: 'Environment' }, [envBox]),
      el('label', { text: 'Locale' }, [localeBox]),
    ]),
  ]);
}

function defectPanel(c, state, actions) {
  const status = statusOf(c);
  const defect = state.defect;
  if (!defect) {
    const hint = defectHint(status);
    return el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: 'Open as defect', disabled: hint ? 'disabled' : null, onclick: () => actions.openDefect(c.id) }),
      hint ? el('span', { class: 'badge muted', text: hint }) : null,
    ]);
  }
  const d = defect.dispatch;
  const issueLink = defect.url ? el('a', { href: defect.url, target: '_blank', text: `${defect.tracker} #${defect.issueId}` }) : el('span', { text: `${defect.tracker} ${defect.issueId}` });
  const canDispatch = !d || ['failed', 'pr-open'].includes(d.state);
  const rows = [
    el('h4', { text: `Defect ${defect.id}` }),
    el('div', { class: 'kv' }, [el('span', { text: 'Issue' }), issueLink, el('span', { text: 'Issue state' }), el('span', { text: defect.issue?.state ?? 'unknown' }), el('span', { text: 'Dispatch' }), el('span', { text: d ? d.state : 'not started' })]),
    d?.pr ? el('p', {}, [el('a', { href: d.pr, target: '_blank', text: d.pr })]) : null,
    d?.error ? el('p', { class: 'toast error', text: d.error }) : null,
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', text: d?.state === 'running' ? 'Agent running' : 'Dispatch fix agent', disabled: canDispatch ? null : 'disabled', onclick: () => actions.dispatch(defect.id) }),
      el('button', { text: 'Refresh', onclick: () => actions.refreshDefect(defect.id) }),
    ]),
    state.log ? el('pre', { class: 'log', text: state.log }) : null,
  ];
  return el('div', {}, rows);
}

export function renderRuns(root, state, actions) {
  if (state.bootError) { root.append(el('p', { class: 'empty error', text: `Could not load qa-desk: ${state.bootError}` })); return; }
  if (!state.config) { root.append(el('p', { class: 'empty', text: 'Loading' })); return; }
  const left = el('aside', { class: 'pane', 'data-pane': 'filters' }, [el('h2', { text: 'Runs' }), runList(state, actions), newRunForm(state, actions)]);
  if (!state.run) {
    root.append(left, el('section', { class: 'pane', 'data-pane': 'list' }, [el('p', { class: 'empty', text: 'Pick a run or create one' })]), el('section', { class: 'pane', 'data-pane': 'detail' }, [renderProgress(state)]));
    return;
  }
  const inRunAll = inRunCases(state.cases, state.run);
  const inRun = inRunAll.filter((c) => matchesFilters(c, state.filters));
  const selected = inRun.find((c) => c.id === state.selectedId);
  const panelFor = (c) => (isClosed(state.run) ? closedExecutionPanel(c, state) : executionPanel(c, state, actions));
  const right = selected
    ? [renderCaseDetail(selected, state), panelFor(selected), defectPanel(selected, state, actions)]
    : [renderProgress(state), ...(state.config.roles.length ? [el('h2', { text: 'By role' }), renderProgress(state, 'role')] : []), el('p', { class: 'empty', text: 'Select a case. Keys: j/k move, p f b s r record.' })];
  const summary = headerSummary(countStatuses(inRunAll), state.run.summary);
  const controls = el('div', { class: 'pane-head' }, [statusFilter(state, actions), closeControl(state, actions)]);
  const head = el('div', {}, [el('div', { class: 'pane-head' }, [el('h2', { text: `${state.run.name} (${inRun.length})` }), el('span', { class: 'badge', text: summaryLabel(summary) })]), statusStrip(summary), controls]);
  root.append(left, el('section', { class: 'pane', 'data-pane': 'list' }, [head, renderList(state, actions, inRun, inRunAll.length)]), el('section', { class: 'pane', 'data-pane': 'detail' }, right));
}
