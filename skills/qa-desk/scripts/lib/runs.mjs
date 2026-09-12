import { readJsonl, latestBy, withJsonlQueue, writeJsonlLine } from './jsonl.mjs';

const PAD = 4;
const RUN_PREFIX = 'R-';
export const SUMMARY_STATUSES = Object.freeze(['passed', 'failed', 'blocked', 'skipped', 'retest', 'untested']);
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

export async function closeRun(paths, id, { now = defaultNow } = {}) {
  // Read-then-append must be one atomic step under the runs queue, the same as createRun,
  // or two concurrent closes of the same run could both read closedAt as null and both
  // append a closed record.
  return withJsonlQueue(paths.runs, async () => {
    const run = await getRun(paths, id);
    if (!run) throw new Error(`unknown run ${id}`);
    if (run.closedAt) throw new Error(`run ${id} is already closed`);
    const closed = { ...run, closedAt: now() };
    await writeJsonlLine(paths.runs, closed);
    return closed;
  });
}

export async function createRun(paths, input, { now = defaultNow } = {}) {
  // Computing the next id and appending it must be one atomic step, the same as every other
  // read-modify-write cycle on a JSONL file, or two concurrent creates (a double click on
  // "Create run") both read the same max id and mint the same one, and latest-wins on read
  // silently drops one of them.
  return withJsonlQueue(paths.runs, async () => {
    const runs = await listRuns(paths);
    const run = { id: nextRunId(runs), name: input.name, build: input.build, env: input.env, locale: input.locale, caseIds: [...input.caseIds], createdAt: now(), closedAt: null };
    await writeJsonlLine(paths.runs, run);
    return run;
  });
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
  if (run.closedAt) throw new Error(`run ${runId} is closed`);
  return withJsonlQueue(paths.executions, async () => {
    const previous = (await listExecutions(paths, runId)).get(caseId) ?? {};
    const execution = { ...previous, runId, caseId, env: previous.env ?? run.env, locale: previous.locale ?? run.locale, ...patch, executedBy, executedAt: now() };
    await writeJsonlLine(paths.executions, execution);
    return execution;
  });
}

/** Only the run's frozen caseIds count, so a later regeneration cannot move the numbers. */
export async function runSummary(paths, run) {
  const latest = await listExecutions(paths, run.id);
  const counts = Object.fromEntries(SUMMARY_STATUSES.map((s) => [s, 0]));
  for (const caseId of run.caseIds) {
    const status = latest.get(caseId)?.status;
    counts[SUMMARY_STATUSES.includes(status) ? status : 'untested'] += 1;
  }
  return { total: run.caseIds.length, executed: run.caseIds.length - counts.untested, counts };
}
