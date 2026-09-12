import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const defaultWarn = (line, index) => console.warn(`qa-desk: skipped malformed JSONL line ${index}: ${line.slice(0, 80)}`);

export async function readJsonl(path, { warn = defaultWarn } = {}) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let parsed;
    try { parsed = JSON.parse(line); } catch { warn(line, i + 1); return; }
    // Valid JSON that is not a plain record (null, a number, an array) would otherwise reach
    // latestBy and throw reading .id off it. Treat it the same as a malformed line.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { warn(line, i + 1); return; }
    out.push(parsed);
  });
  return out;
}

const queues = new Map();

/**
 * Serialise an arbitrary read-modify-write cycle on one JSONL path across
 * every caller in the process, the same guarantee store.mjs's mutateJson
 * gives JSON files. Without this, two overlapping "read the latest record,
 * merge a patch, append" calls can both read the same base record and the
 * second append silently discards fields the first one wrote (latest wins
 * on read). `fn` runs only once the previous queued operation on this path
 * has settled, so append order matches call order, not read timing.
 */
export function withJsonlQueue(path, fn) {
  const previous = queues.get(path) ?? Promise.resolve();
  const run = previous.then(fn);
  const settled = run.then(() => {}, () => {});
  queues.set(path, settled);
  settled.then(() => { if (queues.get(path) === settled) queues.delete(path); });
  return run;
}

async function writeLine(path, record) {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(record) + '\n', 'utf8');
}

/**
 * A single queued append. Call this from outside an existing withJsonlQueue
 * callback; calling it from inside one for the same path would deadlock,
 * since it would wait for that very callback to finish. A caller doing its
 * own read-modify-write should call writeJsonlLine directly instead.
 */
export function appendJsonl(path, record) {
  return withJsonlQueue(path, () => writeLine(path, record));
}

/** The unqueued write, for use inside a withJsonlQueue(path, ...) callback. */
export function writeJsonlLine(path, record) {
  return writeLine(path, record);
}

export function latestBy(records, keyFn) {
  const map = new Map();
  for (const r of records) map.set(keyFn(r), r);
  return map;
}
