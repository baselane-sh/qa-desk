import { readdir, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJsonAtomic } from './lib/store.mjs';
import { allocateIds } from './lib/ids.mjs';
import { validateCase } from './lib/validate.mjs';
import { computeCoverage } from './lib/coverage.mjs';
import { dataPaths } from './lib/paths.mjs';

async function listOutFiles(outDir) {
  try { return (await readdir(outDir)).filter((f) => f.endsWith('.json')).sort(); } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function collect(file, items, config, incoming, invalid) {
  if (!Array.isArray(items)) { invalid.push({ file, index: null, title: null, problems: ['file must contain an array'] }); return false; }
  let anyValid = false;
  items.forEach((item, index) => {
    const problems = validateCase({ ...item, id: `${config.project}-0` }, config);
    if (problems.length) invalid.push({ file, index, title: item?.title ?? null, problems });
    else { incoming.push(item); anyValid = true; }
  });
  return anyValid;
}

export async function mergeOutputs({ repoRoot, config }) {
  const p = dataPaths(repoRoot);
  const files = await listOutFiles(p.generateOut);
  const incoming = [];
  const invalid = [];
  const consumed = [];
  for (const f of files) {
    let items;
    try { items = await readJson(join(p.generateOut, f), null); } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      invalid.push({ file: f, index: null, title: null, problems: ['file is not valid JSON'] });
      continue;
    }
    if (collect(f, items, config, incoming, invalid)) consumed.push(f);
  }
  const existing = await readJson(p.cases, []);
  const { cases, added, updated, duplicates } = allocateIds(existing, incoming, config.project);
  await mkdir(p.dir, { recursive: true });
  await writeJsonAtomic(p.cases, cases);
  const { uncovered, counts, byComponent } = computeCoverage(config, cases);
  await writeJsonAtomic(p.coverage, { generatedAt: new Date().toISOString(), uncovered, counts, byComponent });
  // A file is removed only once its valid cases are in cases.json, so a crash never loses agent output.
  for (const f of consumed) await unlink(join(p.generateOut, f));
  return { added, updated, invalid, duplicates, uncovered };
}

export function formatMergeReport(r) {
  const lines = [`added ${r.added.length}, updated ${r.updated.length}, invalid ${r.invalid.length}, duplicates ${r.duplicates.length}, uncovered ${r.uncovered.length}`];
  for (const bad of r.invalid) lines.push(`INVALID ${bad.file}[${bad.index ?? '-'}] ${bad.title ?? ''}: ${bad.problems.join('; ')}`);
  for (const dup of r.duplicates) lines.push(`DUPLICATE ${dup.component}: ${dup.title}`);
  for (const u of r.uncovered) lines.push(`UNCOVERED ${u}`);
  return lines.join('\n');
}
