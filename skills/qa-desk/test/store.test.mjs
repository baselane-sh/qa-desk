import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, writeJsonAtomic, mutateJson } from '../scripts/lib/store.mjs';

test('readJson returns the fallback for a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  assert.deepEqual(await readJson(join(dir, 'none.json'), []), []);
});

test('writeJsonAtomic leaves no temp file behind', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  const p = join(dir, 'x.json');
  await writeJsonAtomic(p, { a: 1 });
  assert.deepEqual(await readJson(p, null), { a: 1 });
  assert.deepEqual(await readdir(dir), ['x.json']);
});

test('writeJsonAtomic removes the temp file when rename fails', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  const targetDir = join(dir, 'is-a-dir');
  await mkdir(targetDir); // renaming a file onto an existing directory fails
  await assert.rejects(writeJsonAtomic(targetDir, { a: 1 }));
  assert.deepEqual(await readdir(dir), ['is-a-dir']);
});

test('mutateJson serialises concurrent read-modify-write on one path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'store-'));
  const p = join(dir, 'c.json');
  await writeJsonAtomic(p, { n: 0 });
  await Promise.all(Array.from({ length: 10 }, () => mutateJson(p, (v) => ({ ...v, n: v.n + 1 }))));
  assert.equal((await readJson(p, null)).n, 10);
});
