const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * A plain line: control characters stripped and any newline collapsed to a
 * space, so the value can never open a Markdown heading or fence on a line
 * of its own. Used for every field that is rendered as, or joined into, a
 * single "Key: value" row or the title.
 */
function line(text) {
  return String(text).replace(CONTROL_CHARS, '').replace(/\r\n|\r|\n/g, ' ');
}

/**
 * Free text that is allowed to span multiple lines, such as a step or a
 * precondition. Control characters are stripped, but a genuine newline is
 * kept; every line after the first is indented by `pad` so it stays a
 * continuation of the current list item instead of opening a new block at
 * column 0, where a forged heading or fence would be recognised.
 */
function indented(text, pad) {
  return String(text).replace(CONTROL_CHARS, '').split(/\r\n|\r|\n/).map((l, i) => (i === 0 ? l : pad + l)).join('\n');
}

const bullets = (items, transform = (s) => s) => (items?.length ? items.map((s) => `- ${transform(s)}`).join('\n') : '- none');

function steps(list) {
  return list.map((s, i) => {
    const lines = [`${i + 1}. ${indented(s.action, '   ')}`, `   Expected: ${indented(s.expected, '   ')}`];
    if (s.data) lines.push(`   Data: ${indented(s.data, '   ')}`);
    return lines.join('\n');
  }).join('\n');
}

export function buildDefectTitle(c, run) {
  return `[QA] ${line(c.title)} failed in ${line(run.name)}`;
}

/**
 * A fenced code block only contains its content if the fence is longer than
 * any run of backticks already inside that content. Choosing the fence
 * length from the text, rather than always using three backticks, is what
 * makes the containment real instead of assumed.
 */
function fenceFor(text) {
  const runs = [...text.matchAll(/`+/g)].map((m) => m[0].length);
  return '`'.repeat(Math.max(3, Math.max(0, ...runs) + 1));
}

/**
 * The tester's actual result is quoted inside a fenced block on purpose: it
 * is an observation, and the fix-agent prompt tells the agent to read it as
 * data, never as an instruction. The run's build and name, and the case's
 * title, component, priority, severity, references, preconditions and steps
 * go through `line` or `indented` for the same reason: none of them are
 * validated against newlines upstream (or, for case fields written by the
 * generation subagent from repository source, validated at all), so without
 * this a forged heading in any of them would sit outside the fence, at top
 * level, ahead of the real sections.
 */
export function buildDefectBody({ case: c, run, execution, config }) {
  const caseLines = [`Case: ${c.id}`, `Component: ${line(c.component)}`, `Priority: ${line(c.priority)}`, `Severity: ${line(c.severity)}`, `Type: ${c.type}`];
  if (config.roles.length && c.actors?.length) caseLines.push(`Actors: ${c.actors.join(', ')}`);
  if (c.references?.length) caseLines.push(`References: ${c.references.map(line).join(', ')}`);
  const actual = execution.actual?.trim() ? execution.actual.trim() : '(none)';
  const fence = fenceFor(actual);
  return [
    '## Summary', c.objective || c.title,
    '', '## Environment',
    `Build: ${line(run.build)}`, `Environment: ${execution.env ?? run.env}`, `Locale: ${execution.locale ?? run.locale}`,
    `Executed by: ${execution.executedBy}`, `Executed at: ${execution.executedAt}`,
    '', '## Case', caseLines.join('\n'),
    '', '## Preconditions', bullets(c.preconditions, (s) => indented(s, '  ')),
    ...(c.testData ? ['', '## Test data', c.testData] : []),
    '', '## Steps to reproduce', steps(c.steps),
    '', '## Actual result', fence, actual, fence,
    '', '## Source', bullets(c.source),
    '', `qa-desk: ${run.id} / ${c.id}`,
  ].join('\n');
}
