import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJsonAtomic(path, value) {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(tmp, path);
}

const queues = new Map();

/**
 * Serialise read-modify-write cycles on one JSON file across every caller in
 * the process. `fn` receives the current value and returns the next one; it
 * must not mutate what it is given. Resolves with the value that was written.
 */
export function mutateJson(path, fn, fallback = {}) {
  const previous = queues.get(path) ?? Promise.resolve();
  const run = previous.then(async () => {
    const next = await fn(await readJson(path, fallback));
    await writeJsonAtomic(path, next);
    return next;
  });
  const settled = run.then(() => {}, () => {});
  queues.set(path, settled);
  settled.then(() => { if (queues.get(path) === settled) queues.delete(path); });
  return run;
}
