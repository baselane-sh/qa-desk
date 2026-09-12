export function computeCoverage(config, cases) {
  const live = cases.filter((c) => !c.supersededBy);
  const counts = {};
  for (const comp of config.components) for (const s of comp.sources) counts[s] = 0;
  for (const c of live) for (const s of c.source ?? []) if (Object.hasOwn(counts, s)) counts[s] += 1;
  const uncovered = Object.keys(counts).filter((s) => counts[s] === 0);
  const byComponent = Object.fromEntries(config.components.map((comp) => [comp.name, {
    sources: comp.sources.length,
    uncovered: comp.sources.filter((s) => counts[s] === 0).length,
    cases: live.filter((c) => c.component === comp.name).length,
  }]));
  return { uncovered, counts, byComponent };
}
