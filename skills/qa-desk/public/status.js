// Pure presentation helpers for the connection and save-state UI: no `document` or
// `window` access at import time, so these are driven directly by node:test.

export function saveStateLabel(state, at) {
  switch (state) {
    // Not rendered today: a save starts from a blur handler and showing it would need a
    // redraw mid blur, which is the hazard the focus capture and restore work exists to
    // prevent. Kept because the label belongs with its siblings the day a save is started
    // from somewhere other than a blur.
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
// The one predicate that decides whether the shared save-state slot belongs to the case and
// run being drawn right now. fieldValue (the textarea seed) and saveStateNode (the label
// beside it) both ask it, so the two can never disagree: before this was shared, a caseId of
// undefined matched a slot holding null in one of them and not in the other.
export function ownsSlot(saveState, caseId, runId = null) {
  return (saveState?.caseId ?? null) === (caseId ?? null)
    && (saveState?.runId ?? null) === (runId ?? null);
}

export function fieldValue(saveState, execution, field, caseId, runId = null) {
  const draft = ownsSlot(saveState, caseId, runId) ? saveState?.[field]?.draft : undefined;
  return draft ?? execution?.[field] ?? '';
}

// A write is answered by the server some time after it was sent. It may only be written into
// `cases` and `history` if the tester is still looking at the run it was sent for and no
// newer write for the same case has overtaken it. Without the run half, switching runs mid
// write lands run A's execution on the row now showing run B.
export function applyWrite(currentRunId, writeRunId, currentToken, writeToken) {
  return (currentRunId ?? null) === (writeRunId ?? null) && currentToken === writeToken;
}

// Polling a running dispatch must survive a hiccup: one failed poll used to raise the full
// width banner and stop the timer, so the panel froze until the tester pressed Refresh.
// Returns the delay for the next attempt, or null once the run of consecutive failures is
// long enough that the server is clearly not coming back on its own.
export function nextPollDelay(consecutiveFailures, base = 5000, maxFailures = 3) {
  if (consecutiveFailures >= maxFailures) return null;
  return base * (consecutiveFailures + 1);
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
