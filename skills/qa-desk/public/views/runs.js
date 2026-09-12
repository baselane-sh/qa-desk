import { el, renderList, renderProgress, renderCaseDetail, matchesFilters, statusOf } from './cases.js';

const STATUSES = ['passed', 'failed', 'blocked', 'skipped', 'retest'];
const DEFECT_STATUSES = ['failed', 'blocked'];

function newRunForm(state, actions) {
  const { config } = state;
  const name = el('input', { placeholder: 'Sprint 12 regression' });
  const build = el('input', { placeholder: 'v1.4.0 or commit sha' });
  const env = el('select', {}, config.environments.map((e) => el('option', { value: e, text: e })));
  const locale = el('select', {}, config.locales.map((l) => el('option', { value: l, text: l })));
  const scope = el('select', {}, [el('option', { value: 'all', text: 'All cases' }), el('option', { value: 'filter', text: 'Cases matching the current filters' })]);
  const submit = el('button', { class: 'primary', text: 'Create run', onclick: () => {
    const pool = state.cases.filter((c) => !c.supersededBy && (scope.value === 'all' || matchesFilters(c, state.filters)));
    actions.createRun({ name: name.value.trim(), build: build.value.trim(), env: env.value, locale: locale.value, caseIds: pool.map((c) => c.id) });
  } });
  return el('div', { class: 'form' }, [el('h2', { text: 'New run' }), el('label', { text: 'Name' }, [name]), el('label', { text: 'Build' }, [build]), el('label', { text: 'Environment' }, [env]), el('label', { text: 'Locale' }, [locale]), el('label', { text: 'Scope' }, [scope]), el('div', { class: 'actions' }, [submit])]);
}

function runList(state, actions) {
  if (!state.runs.length) return el('p', { class: 'empty', text: 'No runs yet' });
  return el('ul', { class: 'list' }, [...state.runs].reverse().map((r) => el('li', { class: state.run?.id === r.id ? 'selected' : '', onclick: () => actions.selectRun(r) }, [
    el('span', { text: `${r.id} ${r.name}` }), el('span', { class: 'badge', text: `${r.caseIds.length} cases` }),
    el('span', { class: 'meta', text: `${r.build} · ${r.env} · ${r.createdAt.slice(0, 10)}` }),
  ])));
}

function executionPanel(c, state, actions) {
  const status = statusOf(c);
  const buttons = el('div', { class: 'verdicts' }, STATUSES.map((s) => el('button', { class: `status-btn ${s === status ? 'on' : ''}`, text: s, onclick: () => actions.record(c.id, { status: s }) })));
  const actual = el('textarea', { placeholder: 'Actual result: what you saw, step number, error text', onblur: (e) => { if (e.target.value !== (c.execution?.actual ?? '')) actions.record(c.id, { actual: e.target.value }); } });
  actual.value = c.execution?.actual ?? '';
  const duration = el('input', { type: 'number', min: '0', placeholder: 'seconds', value: c.execution?.durationSec ?? '', onblur: (e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v !== c.execution?.durationSec) actions.record(c.id, { durationSec: v }); } });
  return el('div', {}, [el('h4', { text: `Execution in ${state.run.id}` }), buttons, el('label', { text: 'Actual result' }, [actual]), el('label', { text: 'Duration (s)', style: 'width:140px' }, [duration])]);
}

function defectPanel(c, state, actions) {
  const status = statusOf(c);
  const defect = state.defect;
  if (!defect) {
    return el('div', { class: 'actions' }, [el('button', { class: 'primary', text: 'Open as defect', disabled: DEFECT_STATUSES.includes(status) ? null : 'disabled', onclick: () => actions.openDefect(c.id) }), el('span', { class: 'badge muted', text: 'Needs a failed or blocked execution' })]);
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
  if (!state.config) { root.append(el('p', { class: 'empty', text: 'Loading' })); return; }
  const left = el('aside', { class: 'pane' }, [el('h2', { text: 'Runs' }), runList(state, actions), newRunForm(state, actions)]);
  if (!state.run) {
    root.append(left, el('section', { class: 'pane' }, [el('p', { class: 'empty', text: 'Pick a run or create one' })]), el('section', { class: 'pane' }, [renderProgress(state)]));
    return;
  }
  const inRun = state.cases.filter((c) => state.run.caseIds.includes(c.id) && matchesFilters(c, state.filters));
  const selected = inRun.find((c) => c.id === state.selectedId);
  const right = selected
    ? [renderCaseDetail(selected, state), executionPanel(selected, state, actions), defectPanel(selected, state, actions)]
    : [renderProgress(state), ...(state.config.roles.length ? [el('h2', { text: 'By role' }), renderProgress(state, 'role')] : []), el('p', { class: 'empty', text: 'Select a case. Keys: j/k move, p f b s r record.' })];
  root.append(left, el('section', { class: 'pane' }, [el('h2', { text: `${state.run.name} (${inRun.length})` }), renderList(state, actions, inRun)]), el('section', { class: 'pane' }, right));
}
