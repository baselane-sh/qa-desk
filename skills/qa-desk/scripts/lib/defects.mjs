import { readJsonl, appendJsonl, latestBy, withJsonlQueue, writeJsonlLine } from './jsonl.mjs';

const PAD = 4;
const PREFIX = 'D-';
const defaultNow = () => new Date().toISOString();

export async function listDefects(paths) {
  return [...latestBy(await readJsonl(paths.defects), (d) => d.id).values()];
}

export async function getDefect(paths, id) {
  return (await listDefects(paths)).find((d) => d.id === id) ?? null;
}

export async function findDefect(paths, runId, caseId) {
  return (await listDefects(paths)).find((d) => d.runId === runId && d.caseId === caseId) ?? null;
}

function nextId(defects) {
  const max = defects.reduce((m, d) => Math.max(m, Number(String(d.id).slice(PREFIX.length)) || 0), 0);
  return `${PREFIX}${String(max + 1).padStart(PAD, '0')}`;
}

export async function createDefect(paths, { runId, caseId, tracker, issueId, url }, { now = defaultNow } = {}) {
  const defect = { id: nextId(await listDefects(paths)), runId, caseId, tracker, issueId, url, createdAt: now(), dispatch: null };
  await appendJsonl(paths.defects, defect);
  return defect;
}

export async function patchDefect(paths, id, patch) {
  return withJsonlQueue(paths.defects, async () => {
    const current = await getDefect(paths, id);
    if (!current) throw new Error(`unknown defect ${id}`);
    const next = { ...current, ...patch };
    await writeJsonlLine(paths.defects, next);
    return next;
  });
}

export async function patchDispatch(paths, id, dispatchPatch) {
  return withJsonlQueue(paths.defects, async () => {
    const current = await getDefect(paths, id);
    if (!current) throw new Error(`unknown defect ${id}`);
    const next = { ...current, dispatch: { ...(current.dispatch ?? {}), ...dispatchPatch } };
    await writeJsonlLine(paths.defects, next);
    return next;
  });
}
