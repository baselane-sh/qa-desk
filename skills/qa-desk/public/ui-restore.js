// Pure focus/caret/value capture-and-restore logic: no `document` or `window` access at
// import time, so it can be driven directly by node:test with plain objects standing in for
// DOM elements. Kept separate from app.js because app.js touches the DOM at import time and
// is parse tested only.
//
// input[type=number] does not support selectionStart/setSelectionRange. Modern engines
// return null from the selectionStart getter (a value that must not be mistaken for a real
// caret); older engines throw on the getter itself. Both are treated as "no caret" here,
// and setSelectionRange is called by the caller (restoreField) inside the same guard.

export function captureField(activeLike) {
  const key = activeLike?.dataset?.focusKey ?? null;
  if (!key) return { key: null, caret: null, value: null };
  let caret = null;
  try {
    if (typeof activeLike.selectionStart === 'number') caret = [activeLike.selectionStart, activeLike.selectionEnd];
  } catch {
    caret = null;
  }
  return { key, caret, value: activeLike.value ?? null };
}

// A redraw rebuilds every field from state, so a value typed since the last snapshot the
// server or store knows about would otherwise be wiped out from under the tester. The value
// is reassigned before the caret so the caret lands in the string it is meant to address.
export function restoreField(nodeLike, captured) {
  if (!nodeLike || !captured) return;
  nodeLike.focus();
  if (captured.value !== null && captured.value !== undefined && nodeLike.value !== captured.value) {
    nodeLike.value = captured.value;
  }
  if (captured.caret) {
    try { nodeLike.setSelectionRange(captured.caret[0], captured.caret[1]); } catch { /* not every field type supports a selection range */ }
  }
}
