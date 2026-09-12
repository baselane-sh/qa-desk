# qa-desk

Local manual test management for any repository, driven by your own coding
agent. Zero dependencies. No build step. Ships as a skill for Claude Code and
Codex.

Your agent reads the code and writes the test cases. You run them in a
browser inside a Test Run, record an Execution per case, open a failed case
as a Defect in GitHub Issues (or beads) with one click, and dispatch the agent
to fix it with a second click. Idle cost is zero tokens.

## Install

Claude Code:

    npx skills add baselane-sh/qa-desk

Codex: copy `skills/qa-desk/` into `.agents/skills/qa-desk/` in your repo.

Requirements: Node 22 or later, `gh` logged in (pull request detection), and
for the `beads` tracker a usable `bd`.

## Quick start

Ask your agent: "Set up qa-desk for this repo and generate test cases."
It will run, in your repository:

    node <skill>/scripts/qa-desk.mjs init        # writes .qa-desk/config.json
    # ... fills sources, asks about roles and gates, generates cases ...
    node <skill>/scripts/qa-desk.mjs merge       # cases.json + coverage.json
    node <skill>/scripts/qa-desk.mjs serve       # http://127.0.0.1:4173

## What lives where

Code stays in the skill. Data stays in your repo under `.qa-desk/`:

| File | Content |
|---|---|
| `config.json` | components, roles, enums, tracker, agent command, gates |
| `cases.json` | test cases, committed |
| `runs.jsonl`, `executions.jsonl`, `defects.jsonl` | append-only QA record, committed |
| `coverage.json` | sources with zero cases |
| `logs/` | agent logs, gitignored |

Regenerating cases for a component updates an existing case when its title
matches within that component; a case whose title changed is not detected as
the same case. `supersededBy` is honoured wherever cases are read (coverage
excludes a case that carries it) but nothing writes it automatically, so mark
a case superseded by hand when a rewritten case should replace an old one.

## Config reference

| Field | Default | Meaning |
|---|---|---|
| `project` | from the directory name | id prefix: cases are `QA-0001` |
| `components[]` | top-level directories | `{name, sources[], notes}` |
| `roles[]` | `[]` | optional user roles; cases carry `actors` only when set |
| `types[]` | functional, regression, smoke, security, usability, accessibility, localization | |
| `priorities[]` | P0 to P3 | first is highest |
| `severities[]` | critical, major, minor, trivial | first is worst |
| `environments[]` | local, staging, prod | |
| `locales[]` | en | |
| `tracker` | github | or `beads` |
| `agent[]` | claude argv | argv template with `{issueId}`, `{promptFile}`, `{repoRoot}` |
| `agentEnvStrip[]` | CLAUDECODE, CLAUDE_PID, CLAUDE_CODE_* | env removed before spawn |
| `gates[]` | `[]` | commands the fix agent must run green |
| `branchPrefix` | `qa/` | fix branch is `qa/<issueId>` |
| `port` | 4173 | |

The `codex` argv default (`--agent codex`) has not been verified against a
real `codex --help`. Check it yourself before the first dispatch.

## Security model

The server binds 127.0.0.1 and refuses any other Host or Origin. Every child
process runs with an argv array and no shell. The fix agent runs with broad
permissions; nothing merges without you. The tester's "Actual result" and
"Evidence" are quoted to the agent as data, never as instructions.

The fix agent's prompt (`prompts/fix-agent.md`) tells it to work in its own
git worktree on its own branch. That is an instruction to the agent, not a
boundary the code enforces: qa-desk spawns it with the repository root as its
working directory and never creates or checks the worktree itself.

## Development

    npm test

Spec: `docs/superpowers/specs/2026-09-12-qa-desk-design.md`. Plans: `docs/superpowers/plans/`.

MIT.
