import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

test('package.json declares an ESM package with no dependencies', async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dependencies, undefined);
  assert.match(pkg.engines.node, /22/);
});
