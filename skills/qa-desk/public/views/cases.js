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
  const s = el('select', { onchange: (e) => onchange(key, e.target.value) }, [el('option', { value: '', text: 'All' }), ...options.map((o) => el('option', { value: o, text: o }))]);
  s.value = value ?? '';
  return el('label', { text: label }, [s]);
}

export function renderFilters(state, actions) {
  const { config, filters } = state;
  const set = (key, value) => actions.setFilters({ ...filters, [key]: value || undefined });
  const q = el('input', { placeholder: 'Search id, title, objective', value: filters.q ?? '', oninput: (e) => set('q', e.target.value) });
  const lists = [
    ['Component', 'component', config.components.map((c) => c.name)],
    ...(config.roles.length ? [['Role', 'role', config.roles]] : []),
    ['Type', 'type', config.types], ['Priority', 'priority', config.priorities], ['Severity', 'severity', config.severities],
    ['Environment', 'env', [...config.environments, 'any']], ['Locale', 'locale', [...config.locales, 'any']],
    ['Automation', 'automation', ['manual', 'candidate', 'automated']], ['Status', 'status', ['untested', ...STATUSES]],
  ];
  const tags = [...new Set(state.cases.flatMap((c) => c.tags ?? []))].sort();
  if (tags.length) lists.push(['Tag', 'tag', tags]);
  return el('div', { class: 'filters' }, [el('label', { text: 'Search' }, [q]), ...lists.map(([label, key, opts]) => select(label, key, opts, filters[key], set))]);
}

export function renderProgress(state, groupKey = 'component') {
  if (!state.run) return el('div', { class: 'progress' }, [el('p', { class: 'empty', text: 'Pick a run to see progress' })]);
  const groups = groupKey === 'role' ? state.config.roles : state.config.components.map((c) => c.name);
  const inRun = state.cases.filter((c) => state.run.caseIds.includes(c.id));
  return el('div', { class: 'progress' }, groups.map((g) => {
    const items = inRun.filter((c) => (groupKey === 'role' ? (c.actors ?? []).includes(g) : c.component === g));
    if (!items.length) return null;
    const counts = Object.fromEntries(STATUSES.map((s) => [s, items.filter((c) => statusOf(c) === s).length]));
    const bar = el('div', { class: 'bar' }, STATUSES.map((s) => el('span', { class: s, style: `width:${(counts[s] / items.length) * 100}%` })));
    const done = items.length - items.filter((c) => statusOf(c) === 'untested').length;
    return el('div', { class: 'row' }, [el('span', { text: g, style: 'width:90px' }), bar, el('span', { text: `${done}/${items.length}` })]);
  }));
}

export function renderList(state, actions, cases) {
  if (!cases.length) return el('p', { class: 'empty', text: 'No cases match' });
  return el('ul', { class: 'list' }, cases.map((c) => el('li', { 'data-id': c.id, class: c.id === state.selectedId ? 'selected' : '', onclick: () => actions.select(c.id) }, [
    el('span', { text: `${c.id} ${c.title}` }),
    el('span', { class: `status ${statusOf(c)}`, text: statusOf(c) }),
    el('span', { class: 'meta', text: [c.component, c.priority, c.severity, c.type, ...(c.actors ?? [])].join(' · ') }),
  ])));
}

function kv(pairs) {
  return el('dl', { class: 'kv' }, pairs.filter(([, v]) => v !== undefined && v !== null && v !== '').flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: Array.isArray(v) ? v.join(', ') : String(v) })]));
}

export function renderCaseDetail(c, state) {
  const steps = el('table', { class: 'steps' }, [
    el('thead', {}, [el('tr', {}, [el('th', { text: '#' }), el('th', { text: 'Action' }), el('th', { text: 'Expected' })])]),
    el('tbody', {}, c.steps.map((s, i) => el('tr', {}, [el('td', { text: String(i + 1) }), el('td', { text: s.data ? `${s.action}\nData: ${s.data}` : s.action, style: 'white-space:pre-wrap' }), el('td', { text: s.expected })]))),
  ]);
  const history = el('ul', { class: 'history list' }, state.history.length ? state.history.map((h) => el('li', { text: `${h.runId} ${h.status} by ${h.executedBy} at ${h.executedAt}${h.actual ? `: ${h.actual}` : ''}` })) : [el('li', { text: 'No executions yet' })]);
  return el('div', { class: 'detail' }, [
    el('h3', { text: `${c.id} ${c.title}` }),
    el('p', { text: c.objective ?? '' }),
    kv([['Component', c.component], ['Actors', c.actors], ['Type', c.type], ['Priority', c.priority], ['Severity', c.severity], ['Environment', c.env], ['Locale', c.locale], ['Automation', c.automation], ['Estimate', c.estimateMinutes ? `${c.estimateMinutes} min` : undefined], ['References', c.references], ['Tags', c.tags]]),
    el('h4', { text: 'Preconditions' }), el('ul', {}, (c.preconditions.length ? c.preconditions : ['none']).map((p) => el('li', { text: p }))),
    c.testData ? el('p', { text: `Test data: ${c.testData}` }) : null,
    el('h4', { text: 'Steps' }), steps,
    c.postconditions?.length ? el('div', {}, [el('h4', { text: 'Postconditions' }), el('ul', {}, c.postconditions.map((p) => el('li', { text: p })))]) : null,
    el('h4', { text: 'Source' }), el('ul', {}, c.source.map((s) => el('li', {}, [el('code', { text: s })]))),
    el('h4', { text: 'History' }), history,
  ]);
}

export function renderCases(root, state, actions) {
  if (!state.config) { root.append(el('p', { class: 'empty', text: 'Loading' })); return; }
  const visible = state.cases.filter((c) => !c.supersededBy && matchesFilters(c, state.filters));
  const selected = state.cases.find((c) => c.id === state.selectedId);
  root.append(
    el('aside', { class: 'pane' }, [el('h2', { text: 'Filters' }), renderFilters(state, actions), el('h2', { text: 'Progress', style: 'margin-top:16px' }), renderProgress(state)]),
    el('section', { class: 'pane' }, [el('h2', { text: `Cases (${visible.length})` }), renderList(state, actions, visible)]),
    el('section', { class: 'pane' }, selected ? [renderCaseDetail(selected, state)] : [el('p', { class: 'empty', text: 'Select a case. Keys: j/k move, p f b s r record in the current run.' })]),
  );
}

export { el };
