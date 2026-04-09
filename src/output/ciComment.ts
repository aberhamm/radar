import type { Scorecard, RunMetrics } from '../types/output.js';
import type { Severity } from '../types/findings.js';
import type { DiffResult } from '../commands/diff.js';

function scoreEmoji(score: string): string {
  switch (score) {
    case 'red': return '🔴';
    case 'yellow': return '🟡';
    case 'green': return '🟢';
    default: return '⚪';
  }
}

/**
 * Build a category → trend string map from a DiffResult.
 */
function buildTrendMap(diff: DiffResult): Map<string, string> {
  const trendMap = new Map<string, string>();

  const newByCat = new Map<string, number>();
  for (const f of diff.newFindings) {
    newByCat.set(f.category, (newByCat.get(f.category) ?? 0) + 1);
  }

  const resolvedByCat = new Map<string, number>();
  for (const f of diff.resolvedFindings) {
    resolvedByCat.set(f.category, (resolvedByCat.get(f.category) ?? 0) + 1);
  }

  const allCats = new Set([...newByCat.keys(), ...resolvedByCat.keys()]);
  for (const cat of allCats) {
    const n = newByCat.get(cat) ?? 0;
    const r = resolvedByCat.get(cat) ?? 0;
    const parts: string[] = [];
    if (n > 0) parts.push(`+${n} new`);
    if (r > 0) parts.push(`-${r} resolved`);
    trendMap.set(cat, parts.join(', '));
  }

  return trendMap;
}

const MAX_COMMENT_CHARS = 60_000;

export function renderCiComment(
  scorecard: Scorecard,
  metrics: RunMetrics,
  diff?: DiffResult | null,
): string {
  const pass = scorecard.overallScore !== 'red';
  const status = pass ? 'PASS' : 'FAIL';
  const statusEmoji = pass ? '🟢' : '🔴';

  const lines: string[] = [];
  const hasTrend = diff != null;
  const trendMap = hasTrend ? buildTrendMap(diff) : new Map();

  lines.push(`## ${statusEmoji} Radar CI Check: ${status}`);
  lines.push('');

  // Scorecard table
  if (hasTrend) {
    lines.push('| Category | Score | Issues | Trend |');
    lines.push('|----------|-------|--------|-------|');
  } else {
    lines.push('| Category | Score | Issues |');
    lines.push('|----------|-------|--------|');
  }
  for (const cat of scorecard.categories) {
    const trend = trendMap.get(cat.category) ?? 'unchanged';
    if (hasTrend) {
      lines.push(`| ${cat.category} | ${scoreEmoji(cat.score)} ${cat.score} | ${cat.findings.length} | ${trend} |`);
    } else {
      lines.push(`| ${cat.category} | ${scoreEmoji(cat.score)} ${cat.score} | ${cat.findings.length} |`);
    }
  }
  lines.push('');

  // Trend summary line
  if (diff) {
    const findingsCount = scorecard.categories.reduce((sum, c) => sum + c.findings.length, 0);
    lines.push(`*Overall: ${scorecard.overallScore.toUpperCase()} | ${findingsCount} findings | ${diff.newFindings.length} new, ${diff.resolvedFindings.length} resolved since last run*`);
    lines.push('');
  }

  // Collapsible findings by category
  for (const cat of scorecard.categories) {
    if (cat.findings.length === 0) continue;
    lines.push(`<details><summary>${cat.category} (${cat.findings.length} findings)</summary>`);
    lines.push('');
    for (const f of cat.findings) {
      const tag = f.severity.toUpperCase();
      const filePath = f.evidence[0]?.filePath
        ? ` — \`${f.evidence[0].filePath}${f.evidence[0].lineNumber ? ':' + f.evidence[0].lineNumber : ''}\``
        : '';
      lines.push(`- **[${tag}] ${f.title}**${filePath}`);
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

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

  let result = lines.join('\n');

  // Progressive truncation if exceeding GitHub's comment limit
  if (result.length > MAX_COMMENT_CHARS) {
    result = truncateComment(result, MAX_COMMENT_CHARS);
  }

  return result;
}

/**
 * Progressively truncate: remove <details> sections from bottom up until under limit.
 */
function truncateComment(body: string, limit: number): string {
  const detailsRegex = /<details>[\s\S]*?<\/details>/g;
  const matches = [...body.matchAll(detailsRegex)];

  // Remove details blocks from last to first until under limit
  let result = body;
  for (let i = matches.length - 1; i >= 0 && result.length > limit; i--) {
    const match = matches[i];
    result = result.slice(0, match.index!) +
      `<details><summary>${'(truncated — too many findings)'}</summary></details>` +
      result.slice(match.index! + match[0].length);
  }

  // If still over, hard truncate
  if (result.length > limit) {
    result = result.slice(0, limit - 50) + '\n\n*... truncated (comment too long)*';
  }

  return result;
}
