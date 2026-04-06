import type { Scorecard, RunMetrics } from '../types/output.js';
import type { Severity } from '../types/findings.js';

function scoreEmoji(score: string): string {
  switch (score) {
    case 'red': return '🔴';
    case 'yellow': return '🟡';
    case 'green': return '🟢';
    default: return '⚪';
  }
}

export function renderCiComment(scorecard: Scorecard, metrics: RunMetrics): string {
  const pass = scorecard.overallScore !== 'red';
  const status = pass ? 'PASS' : 'FAIL';
  const statusEmoji = pass ? '🟢' : '🔴';

  const lines: string[] = [];

  lines.push(`## ${statusEmoji} CI Health Check: ${status}`);
  lines.push('');
  lines.push('| Category | Score | Issues |');
  lines.push('|----------|-------|--------|');
  for (const cat of scorecard.categories) {
    lines.push(`| ${cat.category} | ${scoreEmoji(cat.score)} ${cat.score} | ${cat.findings.length} |`);
  }
  lines.push('');

  // Blocking issues: critical or high severity AND high confidence (>= 7)
  const blockingSeverities: Set<Severity> = new Set(['critical', 'high']);
  const blocking = scorecard.topRisks.filter((r) =>
    blockingSeverities.has(r.severity) && (r.confidence ?? 7) >= 7
  );

  if (blocking.length > 0) {
    lines.push('### Blocking Issues');
    for (const risk of blocking) {
      const tag = risk.severity.toUpperCase();
      const filePath = risk.evidence[0]?.filePath
        ? ` — \`${risk.evidence[0].filePath}${risk.evidence[0].lineNumber ? ':' + risk.evidence[0].lineNumber : ''}\``
        : '';
      lines.push(`1. **[${tag}] ${risk.title}**${filePath}`);
    }
    lines.push('');
  }

  // Footer
  const findingsCount = scorecard.categories.reduce((sum, c) => sum + c.findings.length, 0);
  const durationSec = Math.round(metrics.durationMs / 1000);
  const cost = metrics.totalEstimatedCostUsd.toFixed(2);
  lines.push(`*${findingsCount} findings | ${metrics.toolCalls} tool calls | $${cost} | ${durationSec}s*`);

  return lines.join('\n');
}
