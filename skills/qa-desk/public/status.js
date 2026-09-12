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

// A failed save must never make the tester retype what they wrote. saveState carries the
// unsaved draft alongside the failure so a redraw can put it straight back in the field;
// once a save succeeds the draft clears and the field falls back to the saved value.
export function fieldValue(saveState, execution, field) {
  const draft = saveState?.[field]?.draft;
  return draft ?? execution?.[field] ?? '';
}
