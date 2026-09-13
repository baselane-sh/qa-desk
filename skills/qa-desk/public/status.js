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
//
// saveState is shared across every case (it is one slot in app.js's state, not one per
// case), so it also carries the id of the case it belongs to. A draft only applies to the
// case that produced it: reading it back for any other case (the normal result of a case
// switch racing a save, see app.js's `record`) would seed that case's box with someone
// else's text, so a caseId mismatch is treated exactly like no draft at all.
export function fieldValue(saveState, execution, field, caseId, runId = null) {
  const matches = (saveState?.caseId ?? undefined) === caseId
    && (saveState?.runId ?? null) === (runId ?? null);
  const draft = matches ? saveState?.[field]?.draft : undefined;
  return draft ?? execution?.[field] ?? '';
}

// The slot is shared by both fields, so a write for a different case must not carry the
// previous case's other field across: re-stamping caseId alone would re-point case A's
// failed actual draft at case B the moment case B saved its evidence, and the next blur or
// the pagehide flush would then write A's text onto B. The run id is half of the identity
// for the same reason: one case exists in every run it was added to, so a draft left by a
// failed save in run A must not seed that same case's box in run B.
export function nextSaveState(current, idle, caseId, fields, status, at = null, draftPatch = null, runId = null) {
  if (!fields.length) return current;
  const sameSlot = current?.caseId === caseId && (current?.runId ?? null) === (runId ?? null);
  const base = sameSlot ? current : idle;
  const next = { ...base, caseId, runId: runId ?? null };
  for (const f of fields) next[f] = { status, at, draft: draftPatch?.[f] ?? null };
  return next;
}
