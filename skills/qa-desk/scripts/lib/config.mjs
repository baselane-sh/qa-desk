import { readFile } from 'node:fs/promises';
import { dataPaths } from './paths.mjs';

export const DEFAULTS = Object.freeze({
  roles: [],
  types: ['functional', 'regression', 'smoke', 'security', 'usability', 'accessibility', 'localization'],
  priorities: ['P0', 'P1', 'P2', 'P3'],
  severities: ['critical', 'major', 'minor', 'trivial'],
  environments: ['local', 'staging', 'prod'],
  locales: ['en'],
  tracker: 'github',
  agentEnvStrip: ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_*'],
  gates: [],
  branchPrefix: 'qa/',
  port: 4173,
});

export const AGENT_DEFAULTS = Object.freeze({
  claude: ['claude', '-p', '--permission-mode', 'bypassPermissions', '--permission-prompts', 'none', '--append-system-prompt-file', '{promptFile}', 'Fix issue {issueId}'],
  // Not verified against `codex --help` yet (codex is not installed on the build machine). Verify before relying on it.
  codex: ['codex', 'exec', '--full-auto', '--cd', '{repoRoot}', 'Read {promptFile} and follow it. Fix issue {issueId}'],
});

export const TRACKERS = Object.freeze(['github', 'beads']);
export const PLACEHOLDERS = Object.freeze(['issueId', 'promptFile', 'repoRoot']);
const PROJECT_RE = /^[A-Z][A-Z0-9]{0,11}$/;
const LIST_FIELDS = ['types', 'priorities', 'severities', 'environments', 'locales'];

export class ConfigError extends Error {
  constructor(message, problems = []) { super(message); this.problems = problems; }
}

const isStringArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string' && s.length > 0);

function validateAgentPlaceholders(agent, problems) {
  const unknown = new Set();
  for (const element of agent) for (const m of element.matchAll(/\{(\w+)\}/g)) if (!PLACEHOLDERS.includes(m[1])) unknown.add(m[1]);
  // Catching this here, instead of only at dispatch time, means a bad template fails init
  // or a config edit immediately rather than after a whole QA pass has already run.
  if (unknown.size) problems.push(`agent uses unknown placeholder(s): ${[...unknown].join(', ')} (must be one of ${PLACEHOLDERS.join(', ')})`);
}

/** Deep enough that config.types.push(...) or config.components[0].sources.push(...) throws, not just reassigning config.types itself. */
function freezeConfig(config) {
  for (const key of [...LIST_FIELDS, 'roles', 'gates', 'agent', 'agentEnvStrip']) Object.freeze(config[key]);
  for (const component of config.components) { Object.freeze(component.sources); Object.freeze(component); }
  Object.freeze(config.components);
  return Object.freeze(config);
}

function validateComponents(raw, problems) {
  if (!Array.isArray(raw) || raw.length === 0) { problems.push('components must have at least one entry'); return []; }
  const out = raw.map((c, i) => {
    if (!c || typeof c !== 'object') { problems.push(`components[${i}] must be an object`); return null; }
    if (typeof c.name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(c.name)) problems.push(`components[${i}].name must be lowercase letters, digits and dashes`);
    if (!Array.isArray(c.sources) || c.sources.some((s) => typeof s !== 'string')) problems.push(`components[${i}].sources must be an array of strings`);
    if (c.notes !== undefined && typeof c.notes !== 'string') problems.push(`components[${i}].notes must be a string`);
    return { name: c.name, sources: Array.isArray(c.sources) ? [...c.sources] : [], notes: c.notes ?? '' };
  }).filter(Boolean);
  const names = out.map((c) => c.name);
  if (new Set(names).size !== names.length) problems.push('component names must be unique');
  return out;
}

export function validateConfig(raw) {
  const problems = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, problems: ['config must be a JSON object'] };
  const config = {};
  if (typeof raw.project !== 'string' || !PROJECT_RE.test(raw.project)) problems.push('project must match ^[A-Z][A-Z0-9]{0,11}$ (an id prefix such as QA)');
  config.project = raw.project;
  config.components = validateComponents(raw.components, problems);
  const roles = raw.roles ?? DEFAULTS.roles;
  if (!isStringArray(roles)) problems.push('roles must be an array of strings');
  config.roles = isStringArray(roles) ? [...roles] : [];
  for (const key of LIST_FIELDS) {
    const value = raw[key] ?? DEFAULTS[key];
    if (!isStringArray(value) || value.length === 0) problems.push(`${key} must have at least one string`);
    config[key] = isStringArray(value) ? [...value] : [...DEFAULTS[key]];
  }
  config.tracker = raw.tracker ?? DEFAULTS.tracker;
  if (!TRACKERS.includes(config.tracker)) problems.push(`tracker must be one of ${TRACKERS.join(', ')}`);
  const agent = raw.agent ?? AGENT_DEFAULTS.claude;
  if (!isStringArray(agent) || agent.length === 0) problems.push('agent must be an array of strings (argv), never a shell string');
  config.agent = isStringArray(agent) ? [...agent] : [...AGENT_DEFAULTS.claude];
  if (isStringArray(agent)) validateAgentPlaceholders(config.agent, problems);
  const strip = raw.agentEnvStrip ?? DEFAULTS.agentEnvStrip;
  if (!isStringArray(strip)) problems.push('agentEnvStrip must be an array of strings');
  config.agentEnvStrip = isStringArray(strip) ? [...strip] : [...DEFAULTS.agentEnvStrip];
  const gates = raw.gates ?? DEFAULTS.gates;
  if (!isStringArray(gates)) problems.push('gates must be an array of strings');
  config.gates = isStringArray(gates) ? [...gates] : [];
  config.branchPrefix = raw.branchPrefix ?? DEFAULTS.branchPrefix;
  if (typeof config.branchPrefix !== 'string' || !/^[\w./-]*$/.test(config.branchPrefix)) problems.push('branchPrefix must be a plain branch prefix such as qa/');
  config.port = raw.port ?? DEFAULTS.port;
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) problems.push('port must be an integer between 1 and 65535');
  if (problems.length) return { ok: false, problems };
  return { ok: true, config: freezeConfig(config) };
}

export async function loadConfig(repoRoot) {
  const path = dataPaths(repoRoot).config;
  let text;
  try { text = await readFile(path, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') throw new ConfigError(`no config at ${path}. Run: qa-desk init`);
    throw err;
  }
  let raw;
  try { raw = JSON.parse(text); } catch { throw new ConfigError(`${path} is not valid JSON`); }
  const result = validateConfig(raw);
  if (!result.ok) throw new ConfigError(`${path} has ${result.problems.length} problem(s):\n${result.problems.map((p) => `  - ${p}`).join('\n')}`, result.problems);
  return result.config;
}

export function substituteArgv(template, vars) {
  return template.map((element) => element.replace(/\{(\w+)\}/g, (_, name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`unknown placeholder ${name} in agent command`);
    return vars[name];
  }));
}
