/**
 * Fallback output assembly when the LLM doesn't call assemble_output.
 *
 * This happens in three scenarios:
 *   1. Budget exhaustion — the agent ran out of tool calls before assembling.
 *   2. Stuck loop — the agent repeated the same action without progressing.
 *   3. Nudge failure — post-loop retry nudges didn't trigger assembly.
 *
 * Rather than returning empty output, this module groups recorded findings
 * by category and builds minimal but usable brief sections with severity,
 * descriptions, and evidence references. An auto-generated executive summary
 * lists the severity breakdown and categories covered.
 */

import type { AgentState } from '../types/state.js';
export function autoAssembleFromFindings(state: AgentState): Record<string, string> {
  const sections: Record<string, string> = {};

  const byCategory = new Map<string, typeof state.findings>();
  for (const f of state.findings) {
    const cat = f.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(f);
  }

  for (const [category, findings] of byCategory) {
    const lines: string[] = [];
    for (const f of findings) {
      lines.push(`### ${f.title}`);
      lines.push('');
      lines.push(`**Severity:** ${f.severity}`);
      lines.push('');
      lines.push(f.description);
      if (f.evidence.length > 0) {
        lines.push('');
        lines.push('**Evidence:**');
        for (const e of f.evidence) {
          const loc = e.lineNumber ? `${e.filePath}:${e.lineNumber}` : e.filePath;
          lines.push(`- \`${loc}\` — ${e.description}`);
        }
      }
      lines.push('');
    }
    sections[category] = lines.join('\n');
  }

  const severityCounts: Record<string, number> = {};
  for (const f of state.findings) {
    severityCounts[f.severity] = (severityCounts[f.severity] ?? 0) + 1;
  }
  const severityLine = Object.entries(severityCounts)
    .map(([sev, count]) => `${count} ${sev}`)
    .join(', ');
  sections['executive-summary'] =
    `This brief was auto-assembled from ${state.findings.length} findings (${severityLine}). ` +
    `Categories covered: ${[...byCategory.keys()].join(', ')}.`;

  return sections;
}
