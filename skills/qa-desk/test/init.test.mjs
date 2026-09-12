import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guessProject, guessComponents, writeStarterConfig } from '../scripts/init.mjs';
import { AGENT_DEFAULTS } from '../scripts/lib/config.mjs';

async function fakeRepo(name = 'my-shop') {
  const base = await mkdtemp(join(tmpdir(), 'init-'));
  const root = join(base, name);
  for (const d of ['src', 'lib', 'node_modules', '.git', 'dist', 'docs', 'test']) await mkdir(join(root, d), { recursive: true });
  await writeFile(join(root, 'README.md'), '');
  return root;
}

test('guessProject makes an uppercase prefix from the directory name', async () => {
  assert.equal(guessProject('/x/my-shop'), 'MYSHOP');
  assert.equal(guessProject('/x/9lives'), 'X9LIVES');
  assert.equal(guessProject('/x/averyveryverylongname'), 'AVERYVERYVER');
});

test('guessComponents lists source directories and skips tooling directories', async () => {
  const root = await fakeRepo();
  const comps = await guessComponents(root);
  assert.deepEqual(comps.map((c) => c.name), ['lib', 'src']);
  assert.deepEqual(comps[0], { name: 'lib', sources: [], notes: '' });
});

test('writeStarterConfig writes a valid config and refuses to overwrite', async () => {
  const root = await fakeRepo();
  const { path, config } = await writeStarterConfig({ repoRoot: root, agent: 'codex' });
  assert.equal(config.project, 'MYSHOP');
  assert.deepEqual(config.agent, AGENT_DEFAULTS.codex);
  const onDisk = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(onDisk.roles, []);
  assert.equal(onDisk.tracker, 'github');
  await assert.rejects(writeStarterConfig({ repoRoot: root, agent: 'claude' }), /already exists/);
});

test('writeStarterConfig falls back to one component when the repo has no source directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'init-empty-'));
  const { config } = await writeStarterConfig({ repoRoot: root, agent: 'claude' });
  assert.deepEqual(config.components.map((c) => c.name), ['app']);
});
