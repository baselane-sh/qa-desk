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

const bullets = (items) => (items?.length ? items.map((s) => `- ${line(s)}`).join('\n') : '- none');

function steps(list) {
  return list.map((s, i) => {
    const lines = [`${i + 1}. ${line(s.action)}`, `   Expected: ${line(s.expected)}`];
    if (s.data) lines.push(`   Data: ${line(s.data)}`);
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
 * The tester's actual result and evidence are quoted inside a fenced block on
 * purpose: they are observations, and the fix-agent prompt tells the agent to
 * read them as data, never as instructions. Every other free-text field (run
 * build and name, case title, objective, test data, component, priority,
 * severity, references, preconditions, steps, sources) goes through `line`
 * for the same reason: none of them are validated against newlines upstream,
 * and a newline is what a forged heading or fence needs. CommonMark still
 * reads a heading inside an indented list continuation, so indenting is not
 * enough; only a fenced block may hold more than one line.
 */
export function buildDefectBody({ case: c, run, execution, config }) {
  const caseLines = [`Case: ${c.id}`, `Component: ${line(c.component)}`, `Priority: ${line(c.priority)}`, `Severity: ${line(c.severity)}`, `Type: ${line(c.type)}`];
  if (config.roles.length && c.actors?.length) caseLines.push(`Actors: ${c.actors.map(line).join(', ')}`);
  if (c.references?.length) caseLines.push(`References: ${c.references.map(line).join(', ')}`);
  const actual = execution.actual?.trim() ? execution.actual.trim() : '(none)';
  const fence = fenceFor(actual);
  const evidence = execution.evidence?.trim() ?? '';
  const evidenceFence = fenceFor(evidence);
  return [
    '## Summary', line(c.objective || c.title),
    '', '## Environment',
    `Build: ${line(run.build)}`, `Environment: ${line(execution.env ?? run.env)}`, `Locale: ${line(execution.locale ?? run.locale)}`,
    `Executed by: ${line(execution.executedBy)}`, `Executed at: ${execution.executedAt}`,
    '', '## Case', caseLines.join('\n'),
    '', '## Preconditions', bullets(c.preconditions),
    ...(c.testData ? ['', '## Test data', line(c.testData)] : []),
    '', '## Steps to reproduce', steps(c.steps),
    '', '## Actual result', fence, actual, fence,
    ...(evidence ? ['', '## Evidence', evidenceFence, evidence, evidenceFence] : []),
    '', '## Source', bullets(c.source),
    '', `qa-desk: ${run.id} / ${c.id}`,
  ].join('\n');
}
