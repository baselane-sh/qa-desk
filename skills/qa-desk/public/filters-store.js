// Pure filter persistence: no `document` or `window` access at import time, so it can be
// driven directly by node:test with a plain object standing in for localStorage.

export const FILTER_KEYS = ['q', 'component', 'role', 'type', 'priority', 'severity', 'env', 'locale', 'automation', 'status', 'tag'];

const STORAGE_KEY = 'qa-desk-filters';

export function isDefaultFilters(filters) {
  return FILTER_KEYS.every((key) => !filters?.[key]);
}

// `allowed` mirrors the option lists the filter selects render (see filterOptions in
// views/cases.js): a saved value survives only when its select still offers it today, so a
// case set that has shrunk since the last visit cannot pin the list to zero matches forever.
export function sanitizeFilters(saved, allowed) {
  const out = {};
  if (!saved || typeof saved !== 'object') return out;
  for (const key of FILTER_KEYS) {
    const value = saved[key];
    if (value === undefined || value === null) continue;
    if (key === 'q') {
      if (typeof value === 'string' && value !== '') out.q = value;
      continue;
    }
    if (Array.isArray(allowed?.[key]) && allowed[key].includes(value)) out[key] = value;
  }
  return out;
}

export function loadFilters(store, allowed) {
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    return sanitizeFilters(JSON.parse(raw), allowed);
  } catch {
    return {};
  }
}

export function saveFilters(store, filters) {
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // A blocked or full store must never stop the app from rendering.
  }
}
