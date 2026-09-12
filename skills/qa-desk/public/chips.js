// Pure mapping from a case's facts to the tinted pill chips the list and detail panes render.
// No DOM here: renderList/renderCaseDetail turn each entry into a real element with `el`.

const DEFAULT_AUTOMATION = 'manual';

export function chipsFor(c = {}) {
  const chips = [];
  if (c.priority) chips.push({ text: c.priority, className: `chip ${c.priority.toLowerCase()}` });
  if (c.severity) chips.push({ text: c.severity, className: `chip sev-${c.severity}` });
  if (c.type) chips.push({ text: c.type, className: 'chip kind' });
  if (c.automation && c.automation !== DEFAULT_AUTOMATION) chips.push({ text: c.automation, className: 'chip automation' });
  for (const tag of c.tags ?? []) chips.push({ text: tag, className: 'chip tag' });
  return chips;
}
