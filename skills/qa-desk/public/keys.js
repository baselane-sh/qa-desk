export const KEY_STATUS = { p: 'passed', f: 'failed', b: 'blocked', s: 'skipped', r: 'retest' };

/**
 * Every key qa-desk maps to a verdict is also a first-rank browser shortcut
 * (Cmd+P print, Cmd+F find, Cmd+S save, Cmd+R reload, and so on), so a key
 * event carrying a modifier must never be read as a verdict. Kept free of
 * the DOM so it can be unit tested under plain Node, and used by app.js's
 * real keydown handler rather than mirrored there.
 */
export function hasModifier(event) {
  return Boolean(event.metaKey || event.ctrlKey || event.altKey);
}

/** The execution status a bare keydown maps to, or null if it should record nothing. */
export function keyToStatus(event) {
  return hasModifier(event) ? null : (KEY_STATUS[event.key] ?? null);
}

/**
 * The next list index for a j/k or arrow move. `current` of -1 (nothing selected yet)
 * starts at the top for either direction. Clamped so a move at either end is a no-op
 * rather than wrapping, and an empty list (`length` 0) stays at -1.
 */
export function nextIndex(length, current, delta) {
  if (length <= 0) return -1;
  if (current < 0) return 0;
  return Math.min(length - 1, Math.max(0, current + delta));
}

/**
 * Runs `fn` once, `ms` after the last call, with the arguments of that last call.
 * `setTimer`/`clearTimer` are injected so this is testable under plain Node without
 * a real event loop, and default to the real timers in the browser.
 */
export function debounce(fn, ms, setTimer = setTimeout, clearTimer = clearTimeout) {
  let timer = null;
  return (...args) => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => { timer = null; fn(...args); }, ms);
  };
}

const TYPING_TAGS = ['INPUT', 'TEXTAREA', 'SELECT'];

function isTyping(target) {
  return TYPING_TAGS.includes(target?.tagName) || Boolean(target?.isContentEditable);
}

/**
 * The single source of truth for every keyboard binding qa-desk has. Reads only
 * `event.key`/modifier flags and `event.target.tagName`/`isContentEditable`, never a
 * real DOM node method, so it is unit testable with a plain object standing in for
 * the event. `hasSelection`/`hasRun`/`overlayOpen` are the only context it needs from
 * the app; everything else about "can this key do anything right now" lives here.
 */
export function keyAction(event, { hasSelection, hasRun, overlayOpen }) {
  if (hasModifier(event)) return null;
  // Single character keys are lowercased first, so Shift+P still records a pass;
  // multi-character key names (Escape, Enter, ArrowDown, ...) pass through as-is.
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === 'Escape') return { type: 'blur' };
  if (overlayOpen) return null;
  if (isTyping(event.target)) return null;
  if (key === 'j' || key === 'ArrowDown') return { type: 'move', delta: 1 };
  if (key === 'k' || key === 'ArrowUp') return { type: 'move', delta: -1 };
  if (key === 'Enter') {
    if (['BUTTON', 'A'].includes(event.target?.tagName)) return null;
    return { type: 'focusField', field: 'actual' };
  }
  if (key === '/') return { type: 'search' };
  if (key === '?') return { type: 'help' };
  const status = KEY_STATUS[key] ?? null;
  if (status) return hasSelection && hasRun ? { type: 'status', status } : null;
  if (key === 'u') return hasSelection && hasRun ? { type: 'undo' } : null;
  return null;
}
