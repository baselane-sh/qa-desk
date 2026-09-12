import { join } from 'node:path';

export function dataPaths(repoRoot) {
  const dir = join(repoRoot, '.qa-desk');
  return Object.freeze({
    dir,
    config: join(dir, 'config.json'),
    cases: join(dir, 'cases.json'),
    suites: join(dir, 'suites.json'),
    runs: join(dir, 'runs.jsonl'),
    executions: join(dir, 'executions.jsonl'),
    defects: join(dir, 'defects.jsonl'),
    coverage: join(dir, 'coverage.json'),
    generateOut: join(dir, 'generate', 'out'),
    logs: join(dir, 'logs'),
  });
}
