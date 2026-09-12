#!/usr/bin/env node
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeStarterConfig } from './init.mjs';
import { mergeOutputs, formatMergeReport } from './merge.mjs';
import { loadConfig, ConfigError, AGENT_DEFAULTS } from './lib/config.mjs';
import { startServer } from './server.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS = ['init', 'merge', 'serve', 'help'];

export const USAGE = `qa-desk: local manual test management driven by your coding agent.

Usage:
  qa-desk init [--repo <path>] [--agent claude|codex]   write .qa-desk/config.json
  qa-desk merge [--repo <path>]                          fold .qa-desk/generate/out/*.json into cases.json
  qa-desk serve [--repo <path>]                          start the portal on 127.0.0.1
  qa-desk help

Run as: node <skill>/scripts/qa-desk.mjs <command>
`;

export function parseArgs(argv) {
  const out = { command: 'help', repo: null, agent: 'claude' };
  const rest = [...argv];
  if (rest.length && !rest[0].startsWith('--')) out.command = rest.shift();
  while (rest.length) {
    const flag = rest.shift();
    if (flag === '--repo') out.repo = rest.shift() ?? null;
    else if (flag === '--agent') out.agent = rest.shift() ?? 'claude';
    else throw new Error(`unknown option ${flag}`);
  }
  if (!Object.hasOwn(AGENT_DEFAULTS, out.agent)) throw new Error(`--agent must be one of ${Object.keys(AGENT_DEFAULTS).join(', ')}`);
  return out;
}

async function run(args, repoRoot, { stdout }) {
  if (args.command === 'init') {
    const { path } = await writeStarterConfig({ repoRoot, agent: args.agent });
    stdout.write(`wrote ${path}\nNext: fill each component's sources, set roles if the product has distinct user roles, then generate cases.\n`);
    return 0;
  }
  const config = await loadConfig(repoRoot);
  if (args.command === 'merge') {
    stdout.write(formatMergeReport(await mergeOutputs({ repoRoot, config })) + '\n');
    return 0;
  }
  await startServer({ repoRoot, skillRoot: SKILL_ROOT });
  return null; // keep the process alive
}

export async function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  let args;
  try { args = parseArgs(argv); } catch (err) { stderr.write(`${err.message}\n${USAGE}`); return 2; }
  if (args.command === 'help') { stdout.write(USAGE); return 0; }
  if (!COMMANDS.includes(args.command)) { stderr.write(`unknown command ${args.command}\n${USAGE}`); return 2; }
  const repoRoot = resolve(cwd, args.repo ?? '.');
  try {
    return await run(args, repoRoot, { stdout });
  } catch (err) {
    stderr.write(err instanceof ConfigError ? `${err.message}\n` : `qa-desk: ${err.message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const code = await main(process.argv.slice(2));
  if (code !== null) process.exit(code);
}
