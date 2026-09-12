import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonl, appendJsonl, latestBy } from '../scripts/lib/jsonl.mjs';

test('readJsonl returns [] for a missing file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jsonl-'));
  assert.deepEqual(await readJsonl(join(dir, 'none.jsonl')), []);
});

test('readJsonl skips malformed lines and reports them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jsonl-'));
  const p = join(dir, 'a.jsonl');
  await writeFile(p, '{"id":1}\nnot json\n\n{"id":2}\n');
  const warned = [];
  const rows = await readJsonl(p, { warn: (line, i) => warned.push(i) });
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(warned, [2]);
});

test('readJsonl skips a line that parses but is not a plain record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jsonl-'));
  const p = join(dir, 'a.jsonl');
  await writeFile(p, '{"id":1}\nnull\n42\n["x"]\n{"id":2}\n');
  const warned = [];
  const rows = await readJsonl(p, { warn: (line, i) => warned.push(i) });
  assert.deepEqual(rows, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(warned, [2, 3, 4]);
});

test('appendJsonl creates the directory and appends one line per record', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jsonl-'));
  const p = join(dir, 'nested', 'b.jsonl');
  await Promise.all([appendJsonl(p, { id: 'x', v: 1 }), appendJsonl(p, { id: 'x', v: 2 })]);
  const text = await readFile(p, 'utf8');
  assert.equal(text.split('\n').filter(Boolean).length, 2);
  assert.ok(text.endsWith('\n'));
});

test('latestBy keeps the last record per key in first-seen order', () => {
  const m = latestBy([{ id: 'a', v: 1 }, { id: 'b', v: 1 }, { id: 'a', v: 2 }], (r) => r.id);
  assert.deepEqual([...m.keys()], ['a', 'b']);
  assert.equal(m.get('a').v, 2);
});
