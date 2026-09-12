import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, main } from '../scripts/qa-desk.mjs';
import { dataPaths } from '../scripts/lib/paths.mjs';
import { TEST_CONFIG, sampleCase } from './fixtures/config.mjs';

function io() {
  const out = [], err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

test('parseArgs reads command, --repo and --agent', () => {
  assert.deepEqual(parseArgs(['init', '--repo', '/r', '--agent', 'codex']), { command: 'init', repo: '/r', agent: 'codex' });
  assert.deepEqual(parseArgs([]), { command: 'help', repo: null, agent: 'claude' });
  assert.throws(() => parseArgs(['init', '--bogus']), /unknown option --bogus/);
  assert.throws(() => parseArgs(['init', '--repo']), /--repo requires a value/);
});

test('init writes a config and merge reports coverage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cli-'));
  await mkdir(join(root, 'src'));
  const a = io();
  assert.equal(await main(['init', '--repo', root], { cwd: '/', ...a }), 0);
  assert.match(a.out(), /wrote .*config\.json/);
  const paths = dataPaths(root);
  const raw = JSON.parse(await readFile(paths.config, 'utf8'));
  await writeFile(paths.config, JSON.stringify({ ...raw, project: 'QA', components: TEST_CONFIG.components, roles: TEST_CONFIG.roles }));
  await mkdir(paths.generateOut, { recursive: true });
  const { id, ...noId } = sampleCase();
  await writeFile(join(paths.generateOut, 'auth.json'), JSON.stringify([noId]));
  const b = io();
  assert.equal(await main(['merge', '--repo', root], { cwd: '/', ...b }), 0);
  assert.match(b.out(), /added 1, updated 0, invalid 0, duplicates 0, uncovered 2/);
});

test('a bad config prints every problem and exits 1', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cli-'));
  const paths = dataPaths(root);
  await mkdir(paths.dir);
  await writeFile(paths.config, JSON.stringify({ project: 'bad name', components: [] }));
  const a = io();
  assert.equal(await main(['merge', '--repo', root], { cwd: '/', ...a }), 1);
  assert.match(a.err(), /project must match/);
  assert.match(a.err(), /components must have at least one/);
});

test('help prints usage and unknown commands exit 2', async () => {
  const a = io();
  assert.equal(await main(['help'], { cwd: '/', ...a }), 0);
  assert.match(a.out(), /qa-desk init/);
  const b = io();
  assert.equal(await main(['dance'], { cwd: '/', ...b }), 2);
});
