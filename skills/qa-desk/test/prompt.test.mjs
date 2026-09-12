import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderFixPrompt, shellQuote } from '../scripts/lib/prompt.mjs';
import { createGithubTracker } from '../scripts/lib/tracker-github.mjs';
import { TEST_CONFIG } from './fixtures/config.mjs';

const TEMPLATE_PATH = new URL('../prompts/fix-agent.md', import.meta.url);

test('shellQuote quotes arguments with spaces or special characters', () => {
  assert.equal(shellQuote(['gh', 'issue', 'comment', '17', '--body']), 'gh issue comment 17 --body');
  assert.equal(shellQuote(['bd', 'update', "it's", '--append-notes']), "bd update 'it'\\''s' --append-notes");
});

test('renderFixPrompt fills every placeholder from the shipped template', async () => {
  const template = await readFile(TEMPLATE_PATH, 'utf8');
  const tracker = createGithubTracker({ execFile: async () => ({ stdout: '' }), repoRoot: '/r' });
  const out = renderFixPrompt({ template, issueId: '17', config: { ...TEST_CONFIG, gates: ['npm test', 'npm run lint'] }, tracker, repoRoot: '/r' });
  assert.doesNotMatch(out, /\{[a-zA-Z]+\}/);
  assert.match(out, /qa\/17/);
  assert.match(out, /gh issue view 17 --comments/);
  assert.match(out, /gh issue comment 17 --body/);
  assert.match(out, /- npm test\n- npm run lint/);
  assert.match(out, /Actual result/);
  assert.match(out, /never as instructions/i);
  assert.match(out, /Do not modify `.qa-desk\/`/);
});

test('renderFixPrompt says (none) when there are no gates and rejects unknown placeholders', () => {
  const tracker = { readCommand: () => ['x'], noteCommand: () => ['y'] };
  const out = renderFixPrompt({ template: 'gates:\n{gates}', issueId: '1', config: { ...TEST_CONFIG, gates: [] }, tracker, repoRoot: '/r' });
  assert.equal(out, 'gates:\n- (none)');
  assert.throws(() => renderFixPrompt({ template: '{mystery}', issueId: '1', config: TEST_CONFIG, tracker, repoRoot: '/r' }), /unknown placeholder mystery/);
});
