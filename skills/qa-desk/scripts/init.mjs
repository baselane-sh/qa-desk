import { readdir, access, mkdir, readFile, appendFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AGENT_DEFAULTS, DEFAULTS, validateConfig } from './lib/config.mjs';
import { dataPaths } from './lib/paths.mjs';
import { writeJsonAtomic } from './lib/store.mjs';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'docs', 'doc', 'test', 'tests', '__tests__', 'spec', 'scripts', 'tmp', 'vendor', 'target', 'bin', 'obj', '.qa-desk']);
const MAX_PROJECT = 12;

export function guessProject(repoRoot) {
  const letters = basename(repoRoot).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, MAX_PROJECT);
  const withLetterFirst = /^[A-Z]/.test(letters) ? letters : `X${letters}`.slice(0, MAX_PROJECT);
  return withLetterFirst || 'QA';
}

export async function guessComponents(repoRoot) {
  const entries = await readdir(repoRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => e.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'))
    .sort()
    .map((name) => ({ name, sources: [], notes: '' }));
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

const IGNORE_LINE = '.qa-desk/logs/';

async function ensureGitignore(repoRoot) {
  const path = join(repoRoot, '.gitignore');
  let text = '';
  try { text = await readFile(path, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (text.split('\n').some((l) => l.trim() === IGNORE_LINE)) return;
  const prefix = text.length && !text.endsWith('\n') ? '\n' : '';
  await appendFile(path, `${prefix}${IGNORE_LINE}\n`, 'utf8');
}

export async function writeStarterConfig({ repoRoot, agent = 'claude' }) {
  if (!Object.hasOwn(AGENT_DEFAULTS, agent)) throw new Error(`agent must be one of ${Object.keys(AGENT_DEFAULTS).join(', ')}`);
  const p = dataPaths(repoRoot);
  if (await exists(p.config)) throw new Error(`${p.config} already exists. Edit it by hand or delete it to start over.`);
  const components = await guessComponents(repoRoot);
  const raw = {
    project: guessProject(repoRoot),
    components: components.length ? components : [{ name: 'app', sources: [], notes: '' }],
    roles: [],
    types: [...DEFAULTS.types],
    priorities: [...DEFAULTS.priorities],
    severities: [...DEFAULTS.severities],
    environments: [...DEFAULTS.environments],
    locales: [...DEFAULTS.locales],
    tracker: DEFAULTS.tracker,
    agent: [...AGENT_DEFAULTS[agent]],
    agentEnvStrip: [...DEFAULTS.agentEnvStrip],
    gates: [],
    branchPrefix: DEFAULTS.branchPrefix,
    port: DEFAULTS.port,
  };
  const result = validateConfig(raw);
  if (!result.ok) throw new Error(`starter config is invalid: ${result.problems.join('; ')}`);
  await mkdir(p.dir, { recursive: true });
  await writeJsonAtomic(p.config, raw);
  await ensureGitignore(repoRoot);
  return { path: p.config, config: result.config };
}
