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
 * The tester's actual result is quoted inside a fenced block on purpose: it
 * is an observation, and the fix-agent prompt tells the agent to read it as
 * data, never as an instruction.
 */
export function buildDefectBody({ case: c, run, execution, config, defectId = 'D-pending' }) {
  const caseLines = [`Case: ${c.id}`, `Component: ${c.component}`, `Priority: ${c.priority}`, `Severity: ${c.severity}`, `Type: ${c.type}`];
  if (config.roles.length && c.actors?.length) caseLines.push(`Actors: ${c.actors.join(', ')}`);
  if (c.references?.length) caseLines.push(`References: ${c.references.join(', ')}`);
  const actual = execution.actual?.trim() ? execution.actual.trim() : '(none)';
  return [
    '## Summary', c.objective || c.title,
    '', '## Environment',
    `Build: ${run.build}`, `Environment: ${execution.env ?? run.env}`, `Locale: ${execution.locale ?? run.locale}`,
    `Executed by: ${execution.executedBy}`, `Executed at: ${execution.executedAt}`,
    '', '## Case', caseLines.join('\n'),
    '', '## Preconditions', bullets(c.preconditions),
    ...(c.testData ? ['', '## Test data', c.testData] : []),
    '', '## Steps to reproduce', steps(c.steps),
    '', '## Actual result', '```', actual, '```',
    '', '## Source', bullets(c.source),
    '', `qa-desk: ${defectId} / ${run.id} / ${c.id}`,
  ].join('\n');
}
