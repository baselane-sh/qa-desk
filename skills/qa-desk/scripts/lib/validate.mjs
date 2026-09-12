export const EXECUTION_STATUSES = Object.freeze(['passed', 'failed', 'blocked', 'skipped', 'retest']);
export const DISPATCH_STATES = Object.freeze(['queued', 'running', 'pr-open', 'failed']);
export const AUTOMATION = Object.freeze(['manual', 'candidate', 'automated']);
const MAX_TEXT = 20_000;
const MAX_LINE = 200;
const ANY = 'any';

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isStrArray = (v) => Array.isArray(v) && v.every((s) => typeof s === 'string');
const oneOf = (list) => `must be one of ${list.join(', ')}`;
// A run's name and build are free text a person types and land directly in the defect body as
// plain lines. Without this, a newline lets one of them forge a Markdown heading or fence
// there, the same escape closed for the actual result field.
const CONTROL_OR_NEWLINE = /[\r\n\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const isSingleLine = (v) => isStr(v) && v.length <= MAX_LINE && !CONTROL_OR_NEWLINE.test(v);

function checkEnum(problems, field, value, list) {
  if (!list.includes(value)) problems.push(`${field} ${oneOf(list)}`);
}

function checkSteps(problems, steps) {
  if (!Array.isArray(steps) || steps.length === 0) { problems.push('steps must be a non-empty array'); return; }
  steps.forEach((s, i) => {
    if (!s || typeof s !== 'object') { problems.push(`steps[${i}] must be an object`); return; }
    if (!isStr(s.action)) problems.push(`steps[${i}].action must be a non-empty string`);
    if (!isStr(s.expected)) problems.push(`steps[${i}].expected must be a non-empty string`);
    if (s.data !== undefined && typeof s.data !== 'string') problems.push(`steps[${i}].data must be a string`);
  });
}

function checkActors(problems, actors, roles) {
  if (roles.length === 0) {
    if (actors !== undefined) problems.push('actors must be absent because config has no roles');
    return;
  }
  if (!Array.isArray(actors) || actors.length === 0) { problems.push('actors is required because config has roles'); return; }
  actors.forEach((a, i) => { if (!roles.includes(a)) problems.push(`actors[${i}] ${oneOf(roles)}`); });
}

export function validateCase(c, config) {
  const problems = [];
  if (!c || typeof c !== 'object') return ['case must be an object'];
  const idRe = new RegExp(`^${config.project}-\\d+$`);
  if (typeof c.id !== 'string' || !idRe.test(c.id)) problems.push(`id must match ${config.project}-<digits>`);
  if (!isStr(c.title)) problems.push('title must be a non-empty string');
  if (!isStr(c.objective)) problems.push('objective must be a non-empty string');
  checkEnum(problems, 'component', c.component, config.components.map((x) => x.name));
  checkActors(problems, c.actors, config.roles);
  checkEnum(problems, 'type', c.type, config.types);
  checkEnum(problems, 'priority', c.priority, config.priorities);
  checkEnum(problems, 'severity', c.severity, config.severities);
  checkEnum(problems, 'env', c.env, [...config.environments, ANY]);
  checkEnum(problems, 'locale', c.locale, [...config.locales, ANY]);
  for (const k of ['preconditions', 'postconditions', 'references', 'tags', 'source']) {
    if (c[k] !== undefined && !isStrArray(c[k])) problems.push(`${k} must be an array of strings`);
  }
  if (!Array.isArray(c.preconditions)) problems.push('preconditions must be an array of strings');
  if (!Array.isArray(c.source) || c.source.length === 0) problems.push('source must not be empty');
  if (c.testData !== undefined && typeof c.testData !== 'string') problems.push('testData must be a string');
  checkSteps(problems, c.steps);
  if (c.automation !== undefined) checkEnum(problems, 'automation', c.automation, AUTOMATION);
  if (c.estimateMinutes !== undefined && (!Number.isInteger(c.estimateMinutes) || c.estimateMinutes < 0)) problems.push('estimateMinutes must be a non-negative integer');
  if (c.supersededBy !== undefined && (typeof c.supersededBy !== 'string' || !idRe.test(c.supersededBy))) problems.push(`supersededBy must match ${config.project}-<digits>`);
  return problems;
}

export function validateExecutionPatch(body, config) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const value = {};
  if (body.status !== undefined) {
    if (!EXECUTION_STATUSES.includes(body.status)) return { ok: false, error: `status ${oneOf(EXECUTION_STATUSES)}` };
    value.status = body.status;
  }
  if (body.actual !== undefined) {
    if (typeof body.actual !== 'string' || body.actual.length > MAX_TEXT) return { ok: false, error: `actual must be a string up to ${MAX_TEXT} chars` };
    value.actual = body.actual;
  }
  if (body.env !== undefined) {
    if (!config.environments.includes(body.env)) return { ok: false, error: `env ${oneOf(config.environments)}` };
    value.env = body.env;
  }
  if (body.locale !== undefined) {
    if (!config.locales.includes(body.locale)) return { ok: false, error: `locale ${oneOf(config.locales)}` };
    value.locale = body.locale;
  }
  if (body.durationSec !== undefined) {
    if (!Number.isInteger(body.durationSec) || body.durationSec < 0) return { ok: false, error: 'durationSec must be a non-negative integer' };
    value.durationSec = body.durationSec;
  }
  return { ok: true, value };
}

export function validateRunInput(body, config) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  if (!isSingleLine(body.name)) return { ok: false, error: `name must be a single line of up to ${MAX_LINE} characters` };
  if (!isSingleLine(body.build)) return { ok: false, error: `build must be a single line of up to ${MAX_LINE} characters` };
  if (!config.environments.includes(body.env)) return { ok: false, error: `env ${oneOf(config.environments)}` };
  const locale = body.locale ?? config.locales[0];
  if (!config.locales.includes(locale)) return { ok: false, error: `locale ${oneOf(config.locales)}` };
  if (!isStrArray(body.caseIds) || body.caseIds.length === 0) return { ok: false, error: 'caseIds must be a non-empty array of case ids' };
  return { ok: true, value: { name: body.name, build: body.build, env: body.env, locale, caseIds: [...body.caseIds] } };
}
