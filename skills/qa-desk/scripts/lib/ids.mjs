const PAD = 4;

export function normalizeTitle(s) {
  return String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

const keyOf = (c) => `${c.component}|${normalizeTitle(c.title)}`;

function maxSeq(cases, project) {
  const prefix = `${project}-`;
  return cases
    .filter((c) => typeof c.id === 'string' && c.id.startsWith(prefix))
    .reduce((m, c) => Math.max(m, Number(c.id.slice(prefix.length)) || 0), 0);
}

export function allocateIds(existingCases, incoming, project) {
  const byKey = new Map(existingCases.map((c) => [keyOf(c), c]));
  const added = [];
  const updated = [];
  const duplicates = [];
  const touched = new Map();
  const seen = new Set();
  let seq = maxSeq(existingCases, project);

  for (const item of incoming) {
    const key = keyOf(item);
    if (seen.has(key)) { duplicates.push({ component: item.component, title: item.title }); continue; }
    seen.add(key);
    const match = byKey.get(key);
    if (match) {
      touched.set(match.id, { ...match, ...item, id: match.id });
      updated.push(match.id);
      continue;
    }
    seq += 1;
    const id = `${project}-${String(seq).padStart(PAD, '0')}`;
    touched.set(id, { ...item, id });
    added.push(id);
  }

  const kept = existingCases.filter((c) => !touched.has(c.id));
  const bySeq = (a, b) => Number(a.id.split('-').pop()) - Number(b.id.split('-').pop());
  const cases = [...kept, ...touched.values()].sort(bySeq);
  return { cases, added, updated, duplicates };
}
