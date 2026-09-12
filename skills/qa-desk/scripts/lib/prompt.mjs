export function shellQuote(argv) {
  return argv.map((a) => (/^[\w./:@=-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(' ');
}

export function renderFixPrompt({ template, issueId, config, tracker, repoRoot }) {
  const vars = {
    issueId,
    branch: `${config.branchPrefix}${issueId}`,
    repoRoot,
    trackerRead: shellQuote(tracker.readCommand(issueId)),
    trackerNote: shellQuote(tracker.noteCommand(issueId)),
    gates: (config.gates.length ? config.gates : ['(none)']).map((g) => `- ${g}`).join('\n'),
  };
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    if (!Object.hasOwn(vars, name)) throw new Error(`unknown placeholder ${name} in fix-agent template`);
    return vars[name];
  });
}
