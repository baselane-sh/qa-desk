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
    try { out.push(JSON.parse(line)); } catch { warn(line, i + 1); }
  });
  return out;
}

const queues = new Map();

export function appendJsonl(path, record) {
  const previous = queues.get(path) ?? Promise.resolve();
  const run = previous.then(async () => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(record) + '\n', 'utf8');
  });
  const settled = run.then(() => {}, () => {});
  queues.set(path, settled);
  settled.then(() => { if (queues.get(path) === settled) queues.delete(path); });
  return run;
}

export function latestBy(records, keyFn) {
  const map = new Map();
  for (const r of records) map.set(keyFn(r), r);
  return map;
}
