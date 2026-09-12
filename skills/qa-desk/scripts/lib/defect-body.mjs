const bullets = (items) => (items?.length ? items.map((s) => `- ${s}`).join('\n') : '- none');

function steps(list) {
  return list.map((s, i) => {
    const lines = [`${i + 1}. ${s.action}`, `   Expected: ${s.expected}`];
    if (s.data) lines.push(`   Data: ${s.data}`);
    return lines.join('\n');
  }).join('\n');
}

export function buildDefectTitle(c, run) {
  return `[QA] ${c.title} failed in ${run.name}`;
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
 * data, never as an instruction.
 */
export function buildDefectBody({ case: c, run, execution, config }) {
  const caseLines = [`Case: ${c.id}`, `Component: ${c.component}`, `Priority: ${c.priority}`, `Severity: ${c.severity}`, `Type: ${c.type}`];
  if (config.roles.length && c.actors?.length) caseLines.push(`Actors: ${c.actors.join(', ')}`);
  if (c.references?.length) caseLines.push(`References: ${c.references.join(', ')}`);
  const actual = execution.actual?.trim() ? execution.actual.trim() : '(none)';
  const fence = fenceFor(actual);
  return [
    '## Summary', c.objective || c.title,
    '', '## Environment',
    `Build: ${run.build}`, `Environment: ${execution.env ?? run.env}`, `Locale: ${execution.locale ?? run.locale}`,
    `Executed by: ${execution.executedBy}`, `Executed at: ${execution.executedAt}`,
    '', '## Case', caseLines.join('\n'),
    '', '## Preconditions', bullets(c.preconditions),
    ...(c.testData ? ['', '## Test data', c.testData] : []),
    '', '## Steps to reproduce', steps(c.steps),
    '', '## Actual result', fence, actual, fence,
    '', '## Source', bullets(c.source),
    '', `qa-desk: ${run.id} / ${c.id}`,
  ].join('\n');
}
