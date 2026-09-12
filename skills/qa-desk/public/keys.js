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
