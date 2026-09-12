const LOCK_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_PRIORITY = 2;
const EXPORT_PATH = '.beads/issues.jsonl';
const MAX_BUFFER = 8 * 1024 * 1024;

export function priorityToNumber(priority, config) {
  const i = config.priorities.indexOf(priority);
  return i === -1 ? DEFAULT_PRIORITY : i;
}

const isLockError = (err) => `${err?.stderr ?? ''} ${err?.message ?? ''}`.toLowerCase().includes('lock');

function describe(err) {
  const detail = err?.stderr?.trim() || err?.message || String(err);
  return new Error(`bd failed: ${detail}`, { cause: err });
}

export function createBeadsTracker({ execFile, repoRoot, backoffMs = DEFAULT_BACKOFF_MS }) {
  let chain = Promise.resolve();
  const runOnce = (args) => execFile('bd', args, { cwd: repoRoot, maxBuffer: MAX_BUFFER });

  async function runWithRetry(args) {
    let lastErr;
    for (let attempt = 1; attempt <= LOCK_RETRIES; attempt += 1) {
      try { return await runOnce(args); } catch (err) {
        lastErr = err;
        if (!isLockError(err)) throw describe(err);
        await new Promise((r) => setTimeout(r, backoffMs * attempt));
      }
    }
    throw describe(lastErr);
  }

  function bd(args) {
    const next = chain.then(() => runWithRetry(args));
    chain = next.catch(() => {});
    return next;
  }

  const exportJsonl = () => bd(['export', '-o', EXPORT_PATH]);

  async function create({ title, body, labels, priority }) {
    const args = ['create', '--json', '--title', title, '--description', body, '--type', 'bug', '--priority', String(priority ?? DEFAULT_PRIORITY)];
    if (labels.length) args.push('--labels', labels.join(','));
    const { stdout } = await bd(args);
    const parsed = JSON.parse(stdout);
    const id = Array.isArray(parsed) ? parsed[0]?.id : parsed?.id;
    if (!id) throw new Error(`bd create returned no id: ${String(stdout).slice(0, 200)}`);
    await exportJsonl();
    return { id, url: null };
  }

  async function show(id) {
    const { stdout } = await bd(['show', id, '--json']);
    const parsed = JSON.parse(stdout);
    const j = Array.isArray(parsed) ? parsed[0] : parsed;
    return { id: j.id, url: null, state: String(j.status ?? '').toLowerCase(), notes: j.notes ?? '' };
  }

  async function check() {
    await bd(['list', '--limit', '1', '--json']);
  }

  return {
    name: 'beads',
    create, show, check, exportJsonl,
    readCommand: (id) => ['bd', 'show', id],
    noteCommand: (id) => ['bd', 'update', id, '--append-notes'],
  };
}
