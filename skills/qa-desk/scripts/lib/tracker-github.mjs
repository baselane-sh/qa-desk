const MAX_BUFFER = 8 * 1024 * 1024;
const ISSUE_URL_RE = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/(\d+)/;

function describe(err) {
  const detail = err?.stderr?.trim() || err?.message || String(err);
  return new Error(`gh failed: ${detail}`, { cause: err });
}

export function createGithubTracker({ execFile, repoRoot }) {
  let chain = Promise.resolve();
  const ensured = new Set();

  function gh(args, input) {
    const opts = { cwd: repoRoot, maxBuffer: MAX_BUFFER };
    if (input !== undefined) opts.input = input;
    const next = chain.then(() => execFile('gh', args, opts).catch((err) => { throw describe(err); }));
    chain = next.catch(() => {});
    return next;
  }

  async function ensureLabels(labels) {
    for (const label of labels) {
      if (ensured.has(label)) continue;
      await gh(['label', 'create', label, '--force']);
      ensured.add(label);
    }
  }

  async function create({ title, body, labels }) {
    await ensureLabels(labels);
    const args = ['issue', 'create', '--title', title, '--body-file', '-'];
    if (labels.length) args.push('--label', labels.join(','));
    const { stdout } = await gh(args, body);
    const m = String(stdout).match(ISSUE_URL_RE);
    if (!m) throw new Error(`gh issue create returned no issue url: ${String(stdout).slice(0, 200)}`);
    return { id: m[1], url: m[0] };
  }

  async function show(id) {
    const { stdout } = await gh(['issue', 'view', id, '--json', 'number,url,state,comments']);
    const j = JSON.parse(stdout);
    return { id: String(j.number), url: j.url, state: String(j.state ?? '').toLowerCase(), notes: (j.comments ?? []).map((c) => c.body).join('\n') };
  }

  async function check() {
    await gh(['auth', 'status']);
  }

  return {
    name: 'github',
    ensureLabels, create, show, check,
    readCommand: (id) => ['gh', 'issue', 'view', id, '--comments'],
    noteCommand: (id) => ['gh', 'issue', 'comment', id, '--body'],
  };
}
