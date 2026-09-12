import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), 'utf8');

test('SKILL.md has frontmatter and names every command', async () => {
  const text = await read('SKILL.md');
  assert.match(text, /^---\nname: qa-desk\ndescription: .+\n---/);
  for (const re of [/qa-desk\.mjs init/, /qa-desk\.mjs merge/, /qa-desk\.mjs serve/, /generate-cases\.md/, /generate\/out\//, /coverage\.json/, /roles/]) assert.match(text, re);
});

test('generate-cases.md names every case field and the output path', async () => {
  const text = await read('prompts/generate-cases.md');
  for (const field of ['title', 'objective', 'component', 'actors', 'type', 'priority', 'severity', 'env', 'locale', 'preconditions', 'testData', 'steps', 'action', 'expected', 'postconditions', 'references', 'tags', 'automation', 'estimateMinutes', 'source']) {
    assert.match(text, new RegExp(`\`${field}\``), `${field} missing`);
  }
  assert.match(text, /\.qa-desk\/generate\/out\/<component>\.json/);
  assert.match(text, /Do not include `id`/);
});
