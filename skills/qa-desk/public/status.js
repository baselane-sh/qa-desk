// Pure presentation helpers for the connection and save-state UI: no `document` or
// `window` access at import time, so these are driven directly by node:test.

export function saveStateLabel(state, at) {
  switch (state) {
    case 'saving': return 'Saving';
    case 'saved': return `Saved ${at}`;
    case 'failed': return 'Not saved. Edit again to retry.';
    default: return '';
  }
}

export function connectionLabel(online) {
  return online
    ? { text: 'Connected', className: 'dot online' }
    : { text: 'Server not responding', className: 'dot offline' };
}

export const OFFLINE_HELP = 'Could not reach the qa-desk server. Start it again with qa-desk serve.';

// The Cases header tally: how many of the total are on screen after filtering, and how many
// of those carry a real verdict (never "untested"). `counts` is keyed by status, in the order
// they should read out, with a zero entry simply omitted rather than the caller filtering it.
export function tallyLabel({ visible, total, counts = {} }) {
  if (visible === total) return `${total} cases`;
  const marked = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const parts = [`${visible} of ${total} cases`];
  if (marked > 0) {
    parts.push(`${marked} marked`);
    for (const [status, n] of Object.entries(counts)) if (n > 0) parts.push(`${n} ${status}`);
  }
  return parts.join(' · ');
}

// A failed save must never make the tester retype what they wrote. saveState carries the
// unsaved draft alongside the failure so a redraw can put it straight back in the field;
// once a save succeeds the draft clears and the field falls back to the saved value.
export function fieldValue(saveState, execution, field) {
  const draft = saveState?.[field]?.draft;
  return draft ?? execution?.[field] ?? '';
}
