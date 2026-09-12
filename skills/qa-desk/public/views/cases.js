import { isDefaultFilters } from '../filters-store.js';
import { tallyLabel } from '../status.js';
import { chipsFor } from '../chips.js';
import { icon } from '../icons.js';

const STATUSES = ['passed', 'failed', 'blocked', 'skipped', 'retest'];

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c !== null && c !== undefined) node.append(c);
  return node;
};

export function statusOf(c) {
  return c.execution?.status ?? 'untested';
}

export function runBadges(c) {
  return Object.entries(c.latestByRun ?? {}).map(([runId, execution]) => ({ runId, status: execution?.status ?? 'untested' }));
}

const MAX_LINE = 80;

export function truncateLine(text, max = MAX_LINE) {
  const one = String(text ?? '').replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 3)}...` : one;
}

export function historyLine(h) {
  const parts = [`${h.runId} ${h.runName ?? ''}`.trim(), h.status ?? 'untested', `by ${h.executedBy ?? 'unknown'}`, `at ${h.executedAt ?? 'unknown'}`];
  if (Number.isInteger(h.durationSec)) parts.push(`${h.durationSec}s`);
  const line = parts.join(' · ');
  return h.actual ? `${line}: ${truncateLine(h.actual)}` : line;
}

export function matchesFilters(c, f) {
  for (const key of ['component', 'type', 'priority', 'severity', 'env', 'locale', 'automation']) {
    if (f[key] && c[key] !== f[key]) return false;
  }
  if (f.role && !(c.actors ?? []).includes(f.role)) return false;
  if (f.tag && !(c.tags ?? []).includes(f.tag)) return false;
  if (f.status && statusOf(c) !== f.status) return false;
  if (f.q) {
    const hay = `${c.id} ${c.title} ${c.objective ?? ''}`.toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  return true;
}

function select(label, key, options, value, onchange) {
  const s = el('select', { 'data-focus-key': `filter-${key}`, onchange: (e) => onchange(key, e.target.value) }, [el('option', { value: '', text: 'All' }), ...options.map((o) => el('option', { value: o, text: o }))]);
  s.value = value ?? '';
  return el('label', { text: label }, [s]);
}

const FILTER_LABELS = { component: 'Component', role: 'Role', type: 'Type', priority: 'Priority', severity: 'Severity', env: 'Environment', locale: 'Locale', automation: 'Automation', status: 'Status', tag: 'Tag' };
const FILTER_ORDER = ['component', 'role', 'type', 'priority', 'severity', 'env', 'locale', 'automation', 'status', 'tag'];

// The single source of truth for what each filter select offers. Used both to render the
// selects here and, in app.js, to build the `allowed` map that sanitizeFilters checks a
// restored filter set against, so a saved value only survives when its select still offers it.
export function filterOptions(state) {
  const { config } = state;
  const opts = {
    component: config.components.map((c) => c.name),
    type: config.types,
    priority: config.priorities,
    severity: config.severities,
    env: [...config.environments, 'any'],
    locale: [...config.locales, 'any'],
    automation: ['manual', 'candidate', 'automated'],
    status: ['untested', ...STATUSES],
  };
  if (config.roles.length) opts.role = config.roles;
  const tags = [...new Set(state.cases.flatMap((c) => c.tags ?? []))].sort();
  if (tags.length) opts.tag = tags;
  return opts;
}

export function renderFilters(state, actions) {
  const { filters } = state;
  const set = (key, value) => actions.setFilters({ ...filters, [key]: value || undefined });
  const q = el('input', { 'data-focus-key': 'q', placeholder: 'Search id, title, objective', value: filters.q ?? '', oninput: (e) => actions.setSearch(e.target.value) });
  const searchBox = el('div', { class: 'search-box' }, [icon('search'), q]);
  const opts = filterOptions(state);
  const selects = FILTER_ORDER.filter((key) => opts[key]).map((key) => select(FILTER_LABELS[key], key, opts[key], filters[key], set));
  return el('div', { class: 'filters' }, [el('label', { text: 'Search' }, [searchBox]), ...selects]);
}

// The words behind each bar's aria-label, e.g. "auth: 4 passed, 1 failed, 7 untested of 12".
// A pure function so it can be checked directly, without a DOM, unlike the bar itself.
export function progressBarLabel(name, counts, total) {
  const parts = STATUSES.filter((s) => counts[s] > 0).map((s) => `${counts[s]} ${s}`);
  const untested = total - STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  if (untested > 0) parts.push(`${untested} untested`);
  return `${name}: ${parts.join(', ')} of ${total}`;
}

// With a run selected, the denominator is exactly that run's frozen caseIds, unfiltered: this
// keeps the run version of this bar exactly as it always was. With no run (the Cases view's
// default, or the Runs view before one is picked), there is no per-run status to show, so this
// groups the cases visible under the current filters instead, and every bar reads as untested.
export function renderProgress(state, groupKey = 'component') {
  const { run, cases, filters } = state;
  const groups = groupKey === 'role' ? state.config.roles : state.config.components.map((c) => c.name);
  const source = run ? cases.filter((c) => run.caseIds.includes(c.id)) : cases.filter((c) => !c.supersededBy && matchesFilters(c, filters));
  return el('div', { class: 'progress' }, groups.map((g) => {
    const items = source.filter((c) => (groupKey === 'role' ? (c.actors ?? []).includes(g) : c.component === g));
    if (!items.length) return null;
    const counts = Object.fromEntries(STATUSES.map((s) => [s, items.filter((c) => statusOf(c) === s).length]));
    const bar = el('div', { class: 'bar', role: 'img', 'aria-label': progressBarLabel(g, counts, items.length) }, STATUSES.map((s) => el('span', { class: s, style: `width:${(counts[s] / items.length) * 100}%` })));
    const done = items.length - items.filter((c) => statusOf(c) === 'untested').length;
    return el('div', { class: 'row' }, [el('span', { text: g, style: 'width:90px' }), bar, el('span', { text: `${done}/${items.length}` })]);
  }));
}

// How many of the visible cases carry each real verdict, canonically ordered and with the
// zero entries dropped, ready to hand straight to tallyLabel's `counts`.
export function tallyCounts(cases) {
  const out = {};
  for (const s of STATUSES) {
    const n = cases.filter((c) => statusOf(c) === s).length;
    if (n > 0) out[s] = n;
  }
  return out;
}

// Which empty state an empty list gets, decided away from the DOM so a test can hold it to
// account. `total` is how many cases exist before the filters run: zero means the project
// has no cases at all, any other number means the filters hid every one of them.
export function emptyState(total) {
  return total
    ? { text: 'No case matches the filters.', hint: null, label: 'Clear filters', action: 'clearFilters' }
    : { text: 'No cases yet.', hint: 'Run qa-desk generate, then qa-desk merge.', label: 'Reload', action: 'reload' };
}

export function renderList(state, actions, cases, total) {
  if (!cases.length) {
    const { text, hint, label, action } = emptyState(total);
    return el('div', { class: 'empty' }, [
      el('p', { text }),
      hint ? el('p', { text: hint }) : null,
      el('button', { text: label, onclick: () => actions[action]() }),
    ]);
  }
  return el('ul', { class: 'list' }, cases.map((c) => {
    const badges = runBadges(c);
    const status = statusOf(c);
    const chips = chipsFor(c);
    return el('li', { 'data-id': c.id, class: c.id === state.selectedId ? 'selected' : '', onclick: () => actions.select(c.id) }, [
      el('span', { class: 'title-row' }, [
        el('span', { class: `verdict-dot ${status}`, title: status }),
        el('span', { class: 'case-id tabular', text: c.id }),
        el('span', { class: 'case-title', text: c.title }),
      ]),
      el('span', { class: 'meta', text: [c.component, ...(c.actors ?? [])].join(' · ') }),
      chips.length ? el('span', { class: 'chips' }, chips.map((x) => el('span', { class: x.className, text: x.text }))) : null,
      badges.length ? el('span', { class: 'meta' }, badges.map((b) => el('span', { class: `status ${b.status}`, title: b.runId, text: `${b.runId} ${b.status}` }))) : null,
    ]);
  }));
}

function kv(pairs) {
  return el('dl', { class: 'kv' }, pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: Array.isArray(v) ? v.join(', ') : String(v) })]));
}

export function renderCaseDetail(c, state) {
  const steps = el('table', { class: 'steps' }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: '#' }), el('th', { text: 'Action' }), el('th', { text: 'Expected' })])]),
    el('tbody', {}, c.steps.map((s, i) => el('tr', {}, [el('td', { text: String(i + 1) }), el('td', { text: s.data ? `${s.action}\nData: ${s.data}` : s.action, style: 'white-space:pre-wrap', dir: 'auto' }), el('td', { text: s.expected, dir: 'auto' })]))),
  ]);
  const history = el('ul', { class: 'history list' }, state.history.length ? state.history.map((h) => el('li', { text: historyLine(h) })) : [el('li', { text: 'No executions yet' })]);
  const head = el('div', { class: 'detail-head' }, [
    matchesFilters(c, state.filters) ? null : el('p', { class: 'warn', text: 'This case is hidden by the current filters.' }),
    el('h3', {}, [el('span', { class: 'tabular', text: c.id }), ' ', el('span', { dir: 'auto', text: c.title })]),
  ]);
  return el('div', { class: 'detail' }, [
    head,
    el('p', { text: c.objective ?? '' }),
    kv([['Component', c.component], ['Actors', c.actors], ['Type', c.type], ['Priority', c.priority], ['Severity', c.severity], ['Environment', c.env], ['Locale', c.locale], ['Automation', c.automation], ['Estimate', c.estimateMinutes ? `${c.estimateMinutes} min` : undefined], ['References', c.references], ['Tags', c.tags]]),
    el('h4', { text: 'Preconditions' }), el('ul', {}, (c.preconditions.length ? c.preconditions : ['none']).map((p) => el('li', { text: p, dir: 'auto' }))),
    c.testData ? el('p', { text: `Test data: ${c.testData}` }) : null,
    el('h4', { text: 'Steps' }), steps,
    c.postconditions?.length ? el('div', {}, [el('h4', { text: 'Postconditions' }), el('ul', {}, c.postconditions.map((p) => el('li', { text: p, dir: 'auto' })))]) : null,
    el('h4', { text: 'Source' }), el('ul', {}, c.source.map((s) => el('li', {}, [el('code', { text: s })]))),
    el('h4', { text: 'History' }), history,
  ]);
}

// Below the two-column breakpoint the filters pane is hidden behind this button, which just
// flips a CSS class on the pane it is not itself part of (it lives in the list pane's
// pane-head, which stays visible, so it can still be reached once the filters pane is hidden).
export function filtersToggleButton() {
  return el('button', { class: 'filters-toggle', text: 'Filters', onclick: () => document.querySelector('[data-pane="filters"]')?.classList.toggle('open') });
}

export function renderCases(root, state, actions) {
  if (state.bootError) {
    root.append(el('div', { class: 'empty error' }, [
      el('p', { text: `Could not load qa-desk: ${state.bootError}` }),
      el('button', { text: 'Retry', onclick: () => actions.reload() }),
    ]));
    return;
  }
  if (!state.config) { root.append(el('p', { class: 'empty', text: 'Loading' })); return; }
  const total = state.cases.filter((c) => !c.supersededBy).length;
  const visible = state.cases.filter((c) => !c.supersededBy && matchesFilters(c, state.filters));
  const selected = state.cases.find((c) => c.id === state.selectedId);
  const filtersHead = el('div', { class: 'pane-head' }, [
    el('h2', { text: 'Filters' }),
    isDefaultFilters(state.filters) ? null : el('button', { text: 'Clear', onclick: () => actions.clearFilters() }),
  ]);
  root.append(
    el('aside', { class: 'pane', 'data-pane': 'filters' }, [filtersHead, renderFilters(state, actions), el('h2', { text: 'Progress', style: 'margin-top:16px' }), renderProgress(state)]),
    el('section', { class: 'pane', 'data-pane': 'list' }, [el('div', { class: 'pane-head' }, [el('h2', { text: tallyLabel({ visible: visible.length, total, counts: tallyCounts(visible) }) }), filtersToggleButton()]), renderList(state, actions, visible, total)]),
    el('section', { class: 'pane', 'data-pane': 'detail' }, selected ? [renderCaseDetail(selected, state)] : [el('p', { class: 'empty', text: 'Select a case. Keys: j/k move, p f b s r record in the current run.' })]),
  );
}

export { el };
