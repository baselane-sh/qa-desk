# Phase 3a: dashboard parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give qa-desk the controls, the keyboard and the visual language of the in-house QA portal it generalises, and fix the three redraw defects that make the current UI unusable on a large case set.

**Architecture:** The browser app stays plain ES modules with no build step and no dependency. Every unit that carries logic becomes a pure exported function in a module that touches no DOM at import time, so `node --test` can drive it. `app.js` keeps all DOM wiring and stays parse-tested only. The redraw fix is central: `render()` learns to preserve what the user is doing (focus, caret, pane scroll) across `root.replaceChildren()`, which is the root cause of three separate reported faults.

**Tech Stack:** Node 22+, ESM, `node:test`, `node:http`. Browser: plain ES modules, no framework, no bundler, inline SVG only.

**Spec:** `docs/superpowers/specs/2026-09-12-qa-desk-design.md` (binding for data model and security). Parity reference: the inventory of the in-house portal taken 2026-09-13, held outside this repo because it names client values. Backlog: beads epic `qd-gs5`, children `.1` to `.20`.

## Global Constraints

- Node >= 22. ESM only. Zero runtime dependencies. No build step for the UI.
- Anything a test asserts is a **pure exported function** in a module with no `document` or `window` access at import time. `app.js` and any module that reads the DOM at import stay parse-tested only.
- **Every new file under `public/` must be added to the `FILES` array in `skills/qa-desk/test/ui.test.mjs`.** That array drives the existence test, the 800-line cap and the parse test. A file left out of it is silently untested.
- No file over 800 lines. Split a view before it passes 400 and add the new file to `FILES`.
- The UI builds DOM with the `el` helper only. No `innerHTML`, no `insertAdjacentHTML`, no template strings turned into markup.
- No `alert`, `confirm` or `prompt`. A destructive action uses the existing inline two-click confirm pattern.
- Icons are inline SVG defined once as `<symbol>` in `index.html` and referenced with `<use>`. `el()` uses `createElement`, which produces an inert element for SVG tags, so SVG nodes are built with `document.createElementNS('http://www.w3.org/2000/svg', ...)`. No icon font, no network request, no emoji.
- Every `localStorage` read and write is wrapped in `try/catch`. A blocked or corrupt store must never stop the app from rendering.
- Keyboard: any of `metaKey`, `ctrlKey` or `altKey` aborts the handler before any key is read. Single character keys are lowercased first, so `Shift+P` still records a pass. Keys do nothing while a modal overlay is open or while the target is `INPUT`, `TEXTAREA`, `SELECT` or `isContentEditable`, except `Escape`, which is checked before that guard.
- Text a tester wrote is data, never instructions. Anything rendered from case, execution or defect text goes in through `textContent` or `el({text})`, never as markup.
- The server binds loopback only. No new route may accept a shell string. Agent argv stays an array with placeholder substitution.
- Commit messages end with the line `Claude-Session: https://claude.ai/code/session_01LTSFXjdR7zhPyiuszGDhDb`.

## Measurements taken before planning

Run on a synthetic 600 case harness in the scratchpad, in Chrome, 2026-09-13:

| What | Result |
|---|---|
| Full redraw of 600 rows | 34 ms |
| Filtered redraw of 111 rows | 55 ms |
| Focus after one character typed in search | `document.activeElement` is `BODY` |
| List pane scrollTop after pressing `j` from 3000px | 0 |

**Row pooling must not be built.** 34 ms for a full redraw is fast enough. The earlier portal pooled rows because it rebuilt on a slower path; copying that here would add complexity for nothing.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `public/keys.js` (modify) | Pure keyboard logic: the verdict map, `hasModifier`, `keyToStatus`, plus new `nextIndex`, `keyAction`, `debounce` | 1 |
| `public/app.js` (modify) | DOM wiring, state, the redraw with focus and scroll preservation | 1, 2, 3 |
| `public/index.html` (modify) | Shell, SVG sprite, favicon, footer legend, banner host | 1, 3, 5 |
| `public/style.css` (modify) | Key caps, banner, chips, layout, icons | 1, 3, 5 |
| `public/filters-store.js` (new) | Pure filter persistence: `sanitizeFilters`, `isDefaultFilters`, `loadFilters`, `saveFilters` | 2 |
| `public/views/cases.js` (modify) | Filters pane, list, detail, tally, chips | 2, 4, 5 |
| `public/views/runs.js` (modify) | Run list, execution panel, defect panel | 3, 4 |
| `public/status.js` (new) | Pure presentation helpers: `saveStateLabel`, `connectionLabel`, `tallyLabel` | 3, 4 |
| `public/chips.js` (new) | Pure class and label mapping for priority, severity, type, tag chips | 5 |
| `public/icons.js` (new) | `icon(name)` building a `<use>` node by `createElementNS` | 5 |
| `scripts/lib/config.mjs` (modify) | `{model}` placeholder, `agentModels` allowlist | 4 |
| `scripts/lib/dispatch.mjs` (modify) | Per dispatch model, validated against the allowlist | 4 |
| `scripts/server.mjs` (modify) | Dispatch route accepts a model | 4 |

---

### Task 1: The redraw keeps the user's place, and the full keyboard

Closes `qd-gs5.20`, `qd-gs5.2`, `qd-gs5.1`, `qd-gs5.3`, `qd-gs5.11`, `qd-gs5.12`, `qd-gs5.13`.

**Files:**
- Modify: `skills/qa-desk/public/keys.js`
- Modify: `skills/qa-desk/public/app.js`
- Modify: `skills/qa-desk/public/index.html`, `skills/qa-desk/public/style.css`
- Modify: `skills/qa-desk/public/views/cases.js` (verdict key caps are rendered in `views/runs.js`; the list gets `data-id` already)
- Test: `skills/qa-desk/test/ui.test.mjs`

**Interfaces produced:**

```js
// keys.js
export function nextIndex(length, current, delta)   // clamped, -1 current means 0 for +1 and 0 for -1
export function debounce(fn, ms, setTimer = setTimeout, clearTimer = clearTimeout)
export function keyAction(event, { hasSelection, hasRun, overlayOpen })
// returns one of:
//   null
//   { type: 'move', delta: 1 | -1 }
//   { type: 'status', status: 'passed' | 'failed' | 'blocked' | 'skipped' | 'retest' }
//   { type: 'undo' }
//   { type: 'help' }
//   { type: 'focusField', field: 'actual' }
//   { type: 'blur' }
//   { type: 'search' }
```

**Key map, complete and binding:**

| Key | Action | Guard |
|---|---|---|
| `j`, `ArrowDown` | `{type:'move',delta:1}` | not typing, no overlay |
| `k`, `ArrowUp` | `{type:'move',delta:-1}` | not typing, no overlay |
| `p` `f` `b` `s` `r` | `{type:'status',...}` | needs `hasSelection` and `hasRun` |
| `u` | `{type:'undo'}` | needs `hasSelection` and `hasRun` |
| `Enter` | `{type:'focusField',field:'actual'}` | not typing, target is not `BUTTON` or `A` |
| `/` | `{type:'search'}` | not typing |
| `?` | `{type:'help'}` | not typing |
| `Escape` | `{type:'blur'}` | checked **before** the typing guard, and closes the overlay when it is open |

- [ ] **Step 1: Write the failing tests**

Add to `skills/qa-desk/test/ui.test.mjs`:

```js
test('nextIndex clamps at both ends and starts at the top from nothing', async () => {
  const { nextIndex } = await import('../public/keys.js');
  assert.equal(nextIndex(10, -1, 1), 0);
  assert.equal(nextIndex(10, -1, -1), 0);
  assert.equal(nextIndex(10, 0, -1), 0);
  assert.equal(nextIndex(10, 9, 1), 9);
  assert.equal(nextIndex(10, 4, 1), 5);
  assert.equal(nextIndex(0, -1, 1), -1);
});

test('keyAction maps every binding and refuses what the context cannot do', async () => {
  const { keyAction } = await import('../public/keys.js');
  const ctx = { hasSelection: true, hasRun: true, overlayOpen: false };
  const ev = (key, extra = {}) => ({ key, target: { tagName: 'BODY' }, ...extra });
  assert.deepEqual(keyAction(ev('j'), ctx), { type: 'move', delta: 1 });
  assert.deepEqual(keyAction(ev('ArrowDown'), ctx), { type: 'move', delta: 1 });
  assert.deepEqual(keyAction(ev('k'), ctx), { type: 'move', delta: -1 });
  assert.deepEqual(keyAction(ev('ArrowUp'), ctx), { type: 'move', delta: -1 });
  assert.deepEqual(keyAction(ev('p'), ctx), { type: 'status', status: 'passed' });
  assert.deepEqual(keyAction(ev('P'), ctx), { type: 'status', status: 'passed' });
  assert.deepEqual(keyAction(ev('u'), ctx), { type: 'undo' });
  assert.deepEqual(keyAction(ev('/'), ctx), { type: 'search' });
  assert.deepEqual(keyAction(ev('?'), ctx), { type: 'help' });
  assert.deepEqual(keyAction(ev('Enter'), ctx), { type: 'focusField', field: 'actual' });
  assert.deepEqual(keyAction(ev('Escape'), ctx), { type: 'blur' });
  // a verdict needs both a case and an open run
  assert.equal(keyAction(ev('p'), { ...ctx, hasRun: false }), null);
  assert.equal(keyAction(ev('p'), { ...ctx, hasSelection: false }), null);
  assert.equal(keyAction(ev('u'), { ...ctx, hasRun: false }), null);
  // Enter on a real button stays with the button
  assert.equal(keyAction(ev('Enter', { target: { tagName: 'BUTTON' } }), ctx), null);
  // every modifier aborts, including on Escape
  for (const mod of ['metaKey', 'ctrlKey', 'altKey']) {
    assert.equal(keyAction(ev('j', { [mod]: true }), ctx), null, mod);
    assert.equal(keyAction(ev('Escape', { [mod]: true }), ctx), null, mod);
  }
  // typing in a field blocks everything but Escape
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    assert.equal(keyAction(ev('j', { target: { tagName: tag } }), ctx), null, tag);
    assert.deepEqual(keyAction(ev('Escape', { target: { tagName: tag } }), ctx), { type: 'blur' }, tag);
  }
  assert.equal(keyAction(ev('j', { target: { tagName: 'DIV', isContentEditable: true } }), ctx), null);
  // an open overlay swallows everything but Escape
  assert.equal(keyAction(ev('j'), { ...ctx, overlayOpen: true }), null);
  assert.deepEqual(keyAction(ev('Escape'), { ...ctx, overlayOpen: true }), { type: 'blur' });
  assert.equal(keyAction(ev('x'), ctx), null);
});

test('debounce runs once after the quiet time and keeps the last arguments', async () => {
  const { debounce } = await import('../public/keys.js');
  let timer = null;
  const setTimer = (fn, ms) => { timer = { fn, ms }; return 1; };
  const clearTimer = () => { timer = null; };
  const seen = [];
  const d = debounce((v) => seen.push(v), 140, setTimer, clearTimer);
  d('a'); d('b'); d('c');
  assert.deepEqual(seen, []);
  assert.equal(timer.ms, 140);
  timer.fn();
  assert.deepEqual(seen, ['c']);
});

test('the key legend in index.html names every bound key', async () => {
  const html = await read('index.html');
  for (const k of ['j', 'k', 'p', 'f', 'b', 's', 'r', 'u', 'Enter', 'Esc', '?']) {
    assert.match(html, new RegExp(`<kbd>${k.replace('?', '\\?')}</kbd>`), `legend is missing ${k}`);
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- --test-name-pattern="nextIndex|keyAction|debounce|key legend"`
Expected: FAIL, `nextIndex is not a function` and the legend regex not matching.

- [ ] **Step 3: Implement the pure helpers in `keys.js`**

Keep `KEY_STATUS`, `hasModifier` and `keyToStatus` as they are, they are used elsewhere. Add `nextIndex`, `debounce` and `keyAction` with the map in the table above. `keyAction` reads `event.target.tagName` and `event.target.isContentEditable` only, never a real DOM node method, so the test can pass a plain object.

- [ ] **Step 4: Make the redraw keep the user's place, in `app.js`**

Give every pane a stable identity so its scroll can be restored: in `views/cases.js` and `views/runs.js`, pass `'data-pane'` on each `el('aside'|'section', { class: 'pane', 'data-pane': 'filters' | 'list' | 'detail' })`. Then in `app.js`:

```js
function captureUi() {
  const scroll = {};
  for (const pane of root.querySelectorAll('[data-pane]')) scroll[pane.dataset.pane] = pane.scrollTop;
  const active = document.activeElement;
  const key = active?.dataset?.focusKey ?? null;
  const caret = key && active.selectionStart !== undefined ? [active.selectionStart, active.selectionEnd] : null;
  return { scroll, key, caret };
}

function restoreUi({ scroll, key, caret }) {
  for (const pane of root.querySelectorAll('[data-pane]')) {
    if (scroll[pane.dataset.pane] !== undefined) pane.scrollTop = scroll[pane.dataset.pane];
  }
  if (!key) return;
  const next = root.querySelector(`[data-focus-key="${key}"]`);
  if (!next) return;
  next.focus();
  if (caret && next.setSelectionRange) next.setSelectionRange(caret[0], caret[1]);
}
```

`render()` becomes: `const ui = captureUi(); root.replaceChildren(); VIEWS[state.view](root, state, actions); restoreUi(ui);`

Every input, textarea and select the user types in gets a stable `data-focus-key`: the search box `'q'`, each filter select `filter-<key>`, the execution fields `'actual'`, `'evidence'`, `'duration'`, `'env'`, `'locale'`, and the new run form fields `run-<field>`.

- [ ] **Step 5: Make selection synchronous, and show the selected row**

`selectCase(id)` must set `selectedId` at once and fetch history after:

```js
async function selectCase(id) {
  const token = ++selectCase.token;
  setState({ selectedId: id, history: [], defect: null, log: '', scrollToSelected: true });
  if (!id) return;
  const history = await api.get(`/api/cases/${encodeURIComponent(id)}/history`);
  const defect = state.run ? await findDefect(state.run.id, id) : null;
  if (token !== selectCase.token) return;   // a later selection won, drop this answer
  setState({ history, defect });
}
selectCase.token = 0;
```

After `restoreUi`, when `state.scrollToSelected` is true, call `root.querySelector('.list li.selected')?.scrollIntoView({ block: 'nearest' })` and clear the flag. A selection made by mouse sets the flag false, so clicking a row never moves the list under the pointer.

`onKey` reads `keyAction(event, { hasSelection: Boolean(state.selectedId), hasRun: Boolean(state.run) && !state.run.closedAt, overlayOpen: state.help })` and dispatches. `move` uses `nextIndex(ids.length, ids.indexOf(state.selectedId), delta)`. Call `event.preventDefault()` for every action the app handles, so `j` does not scroll the page and `/` does not open the browser find bar.

- [ ] **Step 6: Debounce the search box**

In `views/cases.js`, wrap the search `oninput` with `debounce(fn, 140)`. Build the debounced function once per render is wrong, it would reset the timer every redraw: create it once in `app.js` and pass it down through `actions.setSearch`.

- [ ] **Step 7: Undo**

`u` re-records the previous execution for the selected case in the open run. `actions.undo()` reads `state.history`, finds the newest entry for the current run **before** the current one, and calls `record` with its `status`, `actual` and `evidence`. With no earlier entry it raises the toast `Nothing to undo for this case in this run.` and writes nothing.

**Ruling carried from planning:** undo cannot make a case untested again, because `untested` is the absence of an execution and the store is append only. Undo restores the previous verdict, and says so when there is none. Recorded in the ledger.

- [ ] **Step 8: Key caps and the legend**

In `views/runs.js`, each verdict button gets a trailing `el('kbd', { text: s[0] })`. Add a footer to `index.html` after `<main>`:

```html
<footer class="legend">
  <span><kbd>j</kbd> <kbd>k</kbd> move</span>
  <span><kbd>p</kbd> <kbd>f</kbd> <kbd>b</kbd> <kbd>s</kbd> <kbd>r</kbd> verdict</span>
  <span><kbd>u</kbd> undo</span>
  <span><kbd>Enter</kbd> actual result</span>
  <span><kbd>/</kbd> search</span>
  <span><kbd>Esc</kbd> leave field</span>
  <span><kbd>?</kbd> keys</span>
</footer>
```

Style `kbd` as a key cap. `?` opens an overlay listing the same set with a one line description each, closed by `Escape` or a `Close` button. The overlay is a `div` the app renders, not a native `dialog`, so the existing `el` helper covers it.

- [ ] **Step 9: Run the whole suite and commit**

Run: `npm test`
Expected: PASS, no test removed.
```bash
git add -A && git commit -m "fix(ui): keep focus and scroll across a redraw, and complete the keyboard"
```

---

### Task 2: Filters that clear, persist and explain themselves

Closes `qd-gs5.4`, `qd-gs5.5`, `qd-gs5.10`.

**Files:**
- Create: `skills/qa-desk/public/filters-store.js`
- Modify: `skills/qa-desk/public/views/cases.js`, `skills/qa-desk/public/app.js`
- Modify: `skills/qa-desk/test/ui.test.mjs` (add `filters-store.js` to `FILES`)

**Interfaces produced:**

```js
export const FILTER_KEYS = ['q','component','role','type','priority','severity','env','locale','automation','status','tag'];
export function isDefaultFilters(filters)                    // true when every key is empty or undefined
export function sanitizeFilters(saved, allowed)              // allowed: { component: [...], role: [...], ... }
export function loadFilters(store, allowed)                  // store is a localStorage-like object, try/catch inside
export function saveFilters(store, filters)                  // try/catch inside, never throws
```

- [ ] **Step 1: Write the failing tests**

```js
test('sanitizeFilters drops values the current case set no longer has', async () => {
  const { sanitizeFilters } = await import('../public/filters-store.js');
  const allowed = { component: ['auth'], priority: ['P0', 'P1'], status: ['untested', 'passed'] };
  assert.deepEqual(sanitizeFilters({ component: 'auth', priority: 'P0' }, allowed), { component: 'auth', priority: 'P0' });
  assert.deepEqual(sanitizeFilters({ component: 'gone', priority: 'P1' }, allowed), { priority: 'P1' });
  assert.deepEqual(sanitizeFilters({ q: 'otp' }, allowed), { q: 'otp' });
  assert.deepEqual(sanitizeFilters({ nonsense: 'x' }, allowed), {});
  assert.deepEqual(sanitizeFilters(null, allowed), {});
  assert.deepEqual(sanitizeFilters({ q: 42 }, allowed), {});
});

test('isDefaultFilters knows an untouched filter set', async () => {
  const { isDefaultFilters } = await import('../public/filters-store.js');
  assert.equal(isDefaultFilters({}), true);
  assert.equal(isDefaultFilters({ q: '', component: undefined }), true);
  assert.equal(isDefaultFilters({ component: 'auth' }), false);
  assert.equal(isDefaultFilters({ q: 'x' }), false);
});

test('loadFilters and saveFilters survive a broken store', async () => {
  const { loadFilters, saveFilters } = await import('../public/filters-store.js');
  const allowed = { component: ['auth'] };
  const good = { getItem: () => JSON.stringify({ component: 'auth' }), setItem() {} };
  assert.deepEqual(loadFilters(good, allowed), { component: 'auth' });
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(loadFilters(broken, allowed), {});
  assert.doesNotThrow(() => saveFilters(broken, { component: 'auth' }));
  const garbage = { getItem: () => '{not json', setItem() {} };
  assert.deepEqual(loadFilters(garbage, allowed), {});
});
```

- [ ] **Step 2: Run them and watch them fail.** Expected: cannot find module `filters-store.js`.

- [ ] **Step 3: Write `filters-store.js`.** Storage key `qa-desk-filters`. `sanitizeFilters` keeps `q` only when it is a non empty string, keeps a key only when it is in `FILTER_KEYS` and its value is in `allowed[key]` (a key with no `allowed` entry is dropped).

- [ ] **Step 4: Wire it in.** `boot()` loads filters after the config and the cases are known, because `allowed` is built from them. Every `setFilters` saves. The `allowed` map is built from the same lists the selects render.

- [ ] **Step 5: The Clear button.** Render it beside the `Filters` heading, hidden while `isDefaultFilters(state.filters)` is true. It sets the filters to `{}` and saves.

- [ ] **Step 6: Empty states with an action.** `renderList` gets three states, each with its own copy and button:
  - boot error: `Could not load qa-desk: <message>` with a `Retry` button calling `actions.reload()`.
  - no cases at all: `No cases yet.` plus, on its own line, `Run qa-desk generate, then qa-desk merge.` with a `Reload` button.
  - filters hide everything: `No case matches the filters.` with a `Clear filters` button.

- [ ] **Step 7: Hidden by filters.** When `state.selectedId` names a case that `matchesFilters` rejects, the detail pane shows, above the title, `el('p', { class: 'warn', text: 'This case is hidden by the current filters.' })`.

- [ ] **Step 8: Run the suite and commit.**

---

### Task 3: Say what the app is doing

Closes `qd-gs5.6`, `qd-gs5.7`, `qd-gs5.19`.

**Files:**
- Create: `skills/qa-desk/public/status.js`
- Modify: `skills/qa-desk/public/app.js`, `index.html`, `style.css`, `views/runs.js`
- Modify: `skills/qa-desk/test/ui.test.mjs` (add `status.js` to `FILES`)

**Interfaces produced:**

```js
export function saveStateLabel(state, at)   // 'idle' -> '', 'saving' -> 'Saving', 'saved' -> `Saved ${at}`, 'failed' -> 'Not saved. Edit again to retry.'
export function connectionLabel(online)     // { text, className }
export const OFFLINE_HELP = 'Could not reach the qa-desk server. Start it again with qa-desk serve.';
```

- [ ] **Step 1: Write the failing tests**

```js
test('saveStateLabel names every save state', async () => {
  const { saveStateLabel } = await import('../public/status.js');
  assert.equal(saveStateLabel('idle'), '');
  assert.equal(saveStateLabel('saving'), 'Saving');
  assert.equal(saveStateLabel('saved', '14:05:09'), 'Saved 14:05:09');
  assert.equal(saveStateLabel('failed'), 'Not saved. Edit again to retry.');
});

test('connectionLabel reports both states', async () => {
  const { connectionLabel } = await import('../public/status.js');
  assert.deepEqual(connectionLabel(true), { text: 'Connected', className: 'dot online' });
  assert.deepEqual(connectionLabel(false), { text: 'Server not responding', className: 'dot offline' });
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Write `status.js`.**

- [ ] **Step 4: The banner replaces the vanishing toast.** Add `<div id="banner-wrap" aria-live="assertive"></div>` to `index.html` under the topbar. An error renders a banner with the message and a `Dismiss` button, and clears itself after 8000 ms. Success keeps the existing short toast. A failed `fetch` in `api.js` sets `online: false`; any answer sets it back to true. The footer shows the connection dot and, when offline, `OFFLINE_HELP`.

- [ ] **Step 5: Save state for the free text fields.** The `Actual result` and `Evidence` boxes keep saving on `blur`, and now show their save state beside the label. Add a `pagehide` listener that flushes a pending edit with `fetch(url, { method: 'POST', body, keepalive: true })`.

**Ruling carried from planning:** no debounced autosave per typing pause. `recordExecution` appends one execution record per call and the history panel lists every record, so a save per pause would fill a case history with near identical lines. Parity here means not losing text, which blur plus the `pagehide` flush gives. Recorded in the ledger.

- [ ] **Step 6: Optimistic verdict.** `record()` updates `state.cases` in place with the new status before the request, then sends it. On failure it puts the old execution back and raises the banner. The case row, the status strip and the tally all read from `state.cases`, so all three move at once with no extra work.

- [ ] **Step 7: Run the suite and commit.**

---

### Task 4: Numbers on screen, and a complete fix agent panel

Closes `qd-gs5.9`, `qd-gs5.8`.

**Files:**
- Modify: `skills/qa-desk/public/status.js`, `views/cases.js`, `views/runs.js`
- Modify: `skills/qa-desk/scripts/lib/config.mjs`, `scripts/lib/dispatch.mjs`, `scripts/server.mjs`
- Test: `skills/qa-desk/test/ui.test.mjs`, `test/config.test.mjs`, `test/dispatch.test.mjs`, `test/server.test.mjs`

**Interfaces produced:**

```js
// status.js
export function tallyLabel({ visible, total, counts })
// config.mjs
export const PLACEHOLDERS = ['issueId', 'promptFile', 'repoRoot', 'model'];
// config.agentModels: string[]  (default [])
// dispatch.mjs
async function enqueue(defectId, { model } = {})
```

- [ ] **Step 1: Write the failing tests**

```js
test('tallyLabel counts what is on screen and what is marked', async () => {
  const { tallyLabel } = await import('../public/status.js');
  assert.equal(tallyLabel({ visible: 600, total: 600, counts: { passed: 0, failed: 0 } }), '600 cases');
  assert.equal(tallyLabel({ visible: 12, total: 600, counts: { passed: 3, failed: 1 } }), '12 of 600 cases · 4 marked · 3 passed · 1 failed');
});
```

```js
// test/config.test.mjs
test('agentModels is an allowlist and {model} is a known placeholder', async () => {
  const { validateConfig } = await import('../scripts/lib/config.mjs');
  const base = { project: 'QA', components: [{ name: 'auth', sources: ['a.ts'] }] };
  const ok = validateConfig({ ...base, agent: ['claude', '--model', '{model}', 'go'], agentModels: ['sonnet', 'opus'] });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  assert.deepEqual(ok.config.agentModels, ['sonnet', 'opus']);
  const bad = validateConfig({ ...base, agentModels: 'sonnet' });
  assert.equal(bad.ok, false);
  const unknown = validateConfig({ ...base, agent: ['claude', '{nonsense}'] });
  assert.equal(unknown.ok, false, 'an unknown placeholder must be refused at config time');
});
```

```js
// test/dispatch.test.mjs
test('a model outside the allowlist is refused and nothing is spawned', async () => {
  // build a dispatcher with config.agentModels = ['sonnet'] and agent argv containing {model}
  await assert.rejects(() => dispatcher.enqueue('QA-D-0001', { model: 'evil; rm -rf /' }), /model/);
  assert.equal(spawned.length, 0);
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Header tally and progress with no run.** `renderCases` header shows `tallyLabel(...)`. `renderProgress` no longer needs a run: with no run it groups the visible cases by component and shows the bar as fully untested, with the `pass/total` count. Keep the run version exactly as it is. Give each bar `role="img"` and an `aria-label` that spells the breakdown out in words, for example `auth: 4 passed, 1 failed, 7 untested of 12`.

- [ ] **Step 4: Config.** Add `agentModels` (array of strings, default `[]`) and add `'model'` to `PLACEHOLDERS`. `validateConfig` refuses an agent argv holding a placeholder that is not in `PLACEHOLDERS`, which it does not do today.

- [ ] **Step 5: Dispatch.** `enqueue(defectId, { model })`. When the argv holds `{model}`: reject with a clear error unless `model` is a member of `config.agentModels`. When the argv holds no `{model}`, a supplied model is ignored. The server route reads `model` from the JSON body and passes it through. **The model never reaches a shell.** It is one element of an argv array, `shell: false`, and it must be in the allowlist first.

**Ruling carried from planning:** the model picker appears only when the configured agent argv contains `{model}`, and the default argv keeps no model token. A default that carried `--model` would change the command under every existing user, and the codex flags are still unverified. So this ships as an opt in documented in the README.

- [ ] **Step 6: The panel.** Add to the defect panel: the model select (only when `config.agentModels.length` and the argv has a model token, which the server reports as `config.agentModelsUsable`), a `Show log` and `Hide log` toggle calling `GET /api/defects/:id/log`, and `Dispatch again` as the label once a dispatch has failed. While any dispatch is `running`, poll every 5000 ms, and stop as soon as none is running.

- [ ] **Step 7: Run the suite and commit.**

---

### Task 5: The visual language

Closes `qd-gs5.14`, `qd-gs5.15`, `qd-gs5.16`, `qd-gs5.17`.

**Files:**
- Create: `skills/qa-desk/public/chips.js`, `skills/qa-desk/public/icons.js`
- Modify: `index.html`, `style.css`, `views/cases.js`, `views/runs.js`
- Modify: `skills/qa-desk/test/ui.test.mjs` (add both new files to `FILES`)

**Interfaces produced:**

```js
// chips.js
export function chipsFor(c)   // [{ text, className }] for priority, severity, type, automation and each tag
// icons.js
export function icon(name)    // 'search' | 'chevron' | 'external' -> an <svg><use href="#i-<name>"></svg> node
```

- [ ] **Step 1: Write the failing tests**

```js
test('chipsFor labels a case with one chip per fact and a class per value', async () => {
  const { chipsFor } = await import('../public/chips.js');
  const chips = chipsFor({ priority: 'P0', severity: 'critical', type: 'security', automation: 'manual', tags: ['smoke'] });
  assert.deepEqual(chips.map((x) => x.text), ['P0', 'critical', 'security', 'smoke']);
  assert.equal(chips[0].className, 'chip p0');
  assert.equal(chips[1].className, 'chip sev-critical');
  assert.equal(chips[2].className, 'chip kind');
  assert.equal(chips[3].className, 'chip tag');
  // automation shows only when it is not the default
  assert.equal(chipsFor({ priority: 'P2', severity: 'minor', type: 'functional', automation: 'automated', tags: [] }).some((x) => x.text === 'automated'), true);
  assert.deepEqual(chipsFor({}).map((x) => x.text), []);
});

test('the stylesheet defines a colour for every priority and severity chip', async () => {
  const css = await read('style.css');
  for (const cls of ['.chip.p0', '.chip.p1', '.chip.p2', '.chip.p3', '.chip.sev-critical', '.chip.sev-major', '.chip.sev-minor']) {
    assert.ok(css.includes(cls), `style.css has no rule for ${cls}`);
  }
});

test('index.html carries an inline favicon and an svg sprite, and loads nothing from a network', async () => {
  const html = await read('index.html');
  assert.match(html, /<link rel="icon"[^>]+data:image\/svg\+xml/);
  for (const id of ['i-search', 'i-chevron', 'i-external']) assert.ok(html.includes(`id="${id}"`), `sprite is missing ${id}`);
  assert.doesNotMatch(html, /https?:\/\//);
});
```

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Chips.** Replace the single grey meta line in `renderList` with the chip row from `chipsFor(c)`, keeping the component name as plain muted text. Add to `:root`: `--p0: #b42318; --p1: #b54708; --p2: #175cd3; --p3: #667085; --sev-critical: #b42318; --sev-major: #b54708; --sev-minor: #667085;` Each chip is a pill with a tinted background and its colour as text, never a full block.

- [ ] **Step 4: The verdict dot.** In the list only, replace the wide uppercase `status` badge with a 9px round dot carrying the same colour, plus a `title` naming the status. Keep the full badge in the detail pane and in the status strip, where there is one of them, not 600.

- [ ] **Step 5: Icons.** Define three `<symbol>` elements in `index.html`, put the magnifier inside the search box, the chevron on the selects through a CSS `background-image` data URI, and the external arrow on the pull request link. Add the favicon as a `data:image/svg+xml` link: a rounded square in `--accent` with a white tick.

- [ ] **Step 6: Layout.** Make the detail pane header sticky. Change the breakpoints to two columns under 1100px and one under 760px, hiding the filters pane first behind a `Filters` toggle button. Set ids and counts in `font-variant-numeric: tabular-nums` with a monospace stack. Add `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; } }`.

- [ ] **Step 7: Right to left text.** Add `dir: 'auto'` to the case title node, to each precondition and postcondition item, to each step cell, and to the `Actual result` and `Evidence` boxes. Add `unicode-bidi: plaintext` to the list title cell.

- [ ] **Step 8: Run the suite and commit.**

---

## Review gates

- **Gate A** after Tasks 1 and 2. The three P0 defects and the filter work are the half the owner can use at once.
- **Gate B** after Tasks 3, 4 and 5.

Each gate is one reviewer on the most capable model, reading a review package for the whole range, then one fix wave, then one scoped re-review. Residual minors are fixed inline by the controller and recorded in the ledger.

## Out of scope

`qd-gs5.18` (coverage report) stays open for phase 3, which builds the reports module. Nothing in this plan adds a dependency, a build step or a framework.
