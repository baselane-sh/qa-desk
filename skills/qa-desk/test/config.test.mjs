import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, AGENT_DEFAULTS, PLACEHOLDERS, validateConfig, loadConfig, substituteArgv, agentHasModelToken, ConfigError } from '../scripts/lib/config.mjs';
import { dataPaths } from '../scripts/lib/paths.mjs';

const minimal = () => ({ project: 'QA', components: [{ name: 'auth', sources: ['a.ts'] }] });

test('validateConfig fills defaults', () => {
  const r = validateConfig(minimal());
  assert.equal(r.ok, true);
  assert.deepEqual(r.config.types, DEFAULTS.types);
  assert.deepEqual(r.config.roles, []);
  assert.equal(r.config.tracker, 'github');
  assert.equal(r.config.port, 4173);
  assert.equal(r.config.branchPrefix, 'qa/');
  assert.deepEqual(r.config.agent, AGENT_DEFAULTS.claude);
  assert.deepEqual(r.config.agentEnvStrip, ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_*']);
  assert.deepEqual(r.config.components[0], { name: 'auth', sources: ['a.ts'], notes: '' });
  assert.deepEqual(r.config.agentModels, []);
});

test('agentModels is an allowlist and {model} is a known placeholder', async () => {
  const base = { project: 'QA', components: [{ name: 'auth', sources: ['a.ts'] }] };
  assert.deepEqual(PLACEHOLDERS, ['issueId', 'promptFile', 'repoRoot', 'model']);
  const ok = validateConfig({ ...base, agent: ['claude', '--model', '{model}', 'go'], agentModels: ['sonnet', 'opus'] });
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
  assert.deepEqual(ok.config.agentModels, ['sonnet', 'opus']);
  const bad = validateConfig({ ...base, agentModels: 'sonnet' });
  assert.equal(bad.ok, false);
  const unknown = validateConfig({ ...base, agent: ['claude', '{nonsense}'] });
  assert.equal(unknown.ok, false, 'an unknown placeholder must be refused at config time');
});

test('agentHasModelToken reports whether an argv carries the {model} placeholder', () => {
  assert.equal(agentHasModelToken(['claude', '--model', '{model}']), true);
  assert.equal(agentHasModelToken(AGENT_DEFAULTS.claude), false);
});

test('validateConfig reports every problem at once', () => {
  const r = validateConfig({ project: 'qa desk', components: [], tracker: 'jira', port: 'x', agent: 'claude -p', roles: [1] });
  assert.equal(r.ok, false);
  const text = r.problems.join('\n');
  assert.match(text, /project must match/);
  assert.match(text, /components must have at least one/);
  assert.match(text, /tracker must be one of github, beads/);
  assert.match(text, /port must be an integer/);
  assert.match(text, /agent must be an array of strings/);
  assert.match(text, /roles must be an array of strings/);
});

test('validateConfig rejects duplicate component names and empty enum lists', () => {
  const r = validateConfig({ ...minimal(), components: [{ name: 'a', sources: [] }, { name: 'a', sources: [] }], types: [] });
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /component names must be unique/);
  assert.match(r.problems.join('\n'), /types must have at least one/);
});

test('validateConfig rejects a non-object', () => {
  assert.equal(validateConfig(null).ok, false);
  assert.equal(validateConfig([]).ok, false);
});

test('validateConfig rejects an agent template with an unknown placeholder', () => {
  const r = validateConfig({ ...minimal(), agent: ['echo', '{repo}', '{issueId}'] });
  assert.equal(r.ok, false);
  assert.match(r.problems.join('\n'), /agent uses unknown placeholder\(s\): repo/);
  assert.equal(validateConfig({ ...minimal(), agent: AGENT_DEFAULTS.claude }).ok, true);
  assert.equal(validateConfig({ ...minimal(), agent: AGENT_DEFAULTS.codex }).ok, true);
});

test('validateConfig deep freezes config so its arrays cannot be mutated after the fact', () => {
  const r = validateConfig(minimal());
  assert.equal(r.ok, true);
  assert.throws(() => r.config.types.push('x'));
  assert.throws(() => r.config.agent.push('x'));
  assert.throws(() => r.config.components[0].sources.push('x'));
  assert.throws(() => { r.config.components[0].name = 'y'; });
  assert.throws(() => r.config.agentModels.push('x'));
});

test('substituteArgv replaces placeholders inside each element and never joins', () => {
  const out = substituteArgv(['claude', '--file', '{promptFile}', 'Fix {issueId} in {repoRoot}'], { promptFile: '/tmp/p.md', issueId: '42', repoRoot: '/r' });
  assert.deepEqual(out, ['claude', '--file', '/tmp/p.md', 'Fix 42 in /r']);
});

test('substituteArgv throws on an unknown placeholder', () => {
  assert.throws(() => substituteArgv(['{nope}'], {}), /unknown placeholder nope/);
});

test('loadConfig reads .qa-desk/config.json and throws ConfigError with problems', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cfg-'));
  await assert.rejects(loadConfig(dir), (e) => e instanceof ConfigError && /no config/.test(e.message));
  await mkdir(join(dir, '.qa-desk'));
  await writeFile(join(dir, '.qa-desk/config.json'), '{ not json');
  await assert.rejects(loadConfig(dir), (e) => e instanceof ConfigError && /not valid JSON/.test(e.message));
  await writeFile(join(dir, '.qa-desk/config.json'), JSON.stringify({ project: 'x' }));
  await assert.rejects(loadConfig(dir), (e) => e instanceof ConfigError && e.problems.length >= 2);
  await writeFile(join(dir, '.qa-desk/config.json'), JSON.stringify(minimal()));
  const cfg = await loadConfig(dir);
  assert.equal(cfg.project, 'QA');
});

test('dataPaths names every store under .qa-desk', () => {
  const p = dataPaths('/r');
  assert.equal(p.dir, '/r/.qa-desk');
  assert.equal(p.cases, '/r/.qa-desk/cases.json');
  assert.equal(p.runs, '/r/.qa-desk/runs.jsonl');
  assert.equal(p.executions, '/r/.qa-desk/executions.jsonl');
  assert.equal(p.defects, '/r/.qa-desk/defects.jsonl');
  assert.equal(p.generateOut, '/r/.qa-desk/generate/out');
  assert.equal(p.logs, '/r/.qa-desk/logs');
});
