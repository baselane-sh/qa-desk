import { readJsonl, appendJsonl, latestBy, withJsonlQueue, writeJsonlLine } from './jsonl.mjs';

const PAD = 4;
const RUN_PREFIX = 'R-';
const defaultNow = () => new Date().toISOString();

function nextRunId(runs) {
  const max = runs.reduce((m, r) => Math.max(m, Number(String(r.id).slice(RUN_PREFIX.length)) || 0), 0);
  return `${RUN_PREFIX}${String(max + 1).padStart(PAD, '0')}`;
}

export async function listRuns(paths) {
  return [...latestBy(await readJsonl(paths.runs), (r) => r.id).values()];
}

export async function getRun(paths, id) {
  return (await listRuns(paths)).find((r) => r.id === id) ?? null;
}

export async function createRun(paths, input, { now = defaultNow } = {}) {
  const runs = await listRuns(paths);
  const run = { id: nextRunId(runs), name: input.name, build: input.build, env: input.env, locale: input.locale, caseIds: [...input.caseIds], createdAt: now(), closedAt: null };
  await appendJsonl(paths.runs, run);
  return run;
}

const execKey = (e) => `${e.runId}|${e.caseId}`;

export async function listExecutions(paths, runId) {
  const all = (await readJsonl(paths.executions)).filter((e) => e.runId === runId);
  const latest = latestBy(all, execKey);
  return new Map([...latest.values()].map((e) => [e.caseId, e]));
}

export async function caseHistory(paths, caseId) {
  return (await readJsonl(paths.executions)).filter((e) => e.caseId === caseId);
}

export async function recordExecution(paths, { runId, caseId, ...patch }, { now = defaultNow, executedBy = 'unknown' } = {}) {
  const run = await getRun(paths, runId);
  if (!run) throw new Error(`unknown run ${runId}`);
  if (!run.caseIds.includes(caseId)) throw new Error(`case ${caseId} is not in run ${runId}`);
  return withJsonlQueue(paths.executions, async () => {
    const previous = (await listExecutions(paths, runId)).get(caseId) ?? {};
    const execution = { ...previous, runId, caseId, env: previous.env ?? run.env, locale: previous.locale ?? run.locale, ...patch, executedBy, executedAt: now() };
    await writeJsonlLine(paths.executions, execution);
    return execution;
  });
}
