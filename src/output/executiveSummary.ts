import type { Scorecard, CategoryScore, ScoreLevel, RunMetrics } from '../types/output.js';
import type { Severity } from '../types/findings.js';

/**
 * Render a deterministic executive summary from scorecard + metrics.
 * Designed as the first thing a practice lead reads — no jargon,
 * no LLM-written prose, purely derived from computed data.
 */
export function renderExecutiveSummary(
  scorecard: Scorecard,
  metrics: RunMetrics,
): string {
  const lines: string[] = [];

  lines.push('## Executive Summary');
  lines.push('');

  // Overall verdict
  lines.push(overallVerdict(scorecard));
  lines.push('');

  // Severity breakdown
  const counts = severityCounts(scorecard);
  const total = counts.critical + counts.high + counts.medium + counts.low + counts.info;
  if (total > 0) {
    const parts: string[] = [];
    if (counts.critical > 0) parts.push(`**${counts.critical} critical**`);
    if (counts.high > 0) parts.push(`**${counts.high} high**`);
    if (counts.medium > 0) parts.push(`${counts.medium} medium`);
    if (counts.low > 0) parts.push(`${counts.low} low`);
    if (counts.info > 0) parts.push(`${counts.info} informational`);
    lines.push(`**${total} findings:** ${parts.join(', ')}`);
  } else {
    lines.push('**0 findings** recorded.');
  }
  lines.push('');

  // Top risks
  const risks = scorecard.topRisks.slice(0, 3);
  if (risks.length > 0) {
    lines.push('**Top risks:**');
    for (let i = 0; i < risks.length; i++) {
      const r = risks[i];
      lines.push(`${i + 1}. **${r.title}** (${r.severity}) — ${truncate(r.description, 120)}`);
    }
    lines.push('');
  }

  // Strengths — green categories
  const strengths = scorecard.categories.filter(c => c.score === 'green');
  if (strengths.length > 0) {
    lines.push('**Strengths:**');
    for (const s of strengths.slice(0, 3)) {
      const label = s.findings.length === 0
        ? 'no issues found'
        : `${s.findings.length} minor finding${s.findings.length === 1 ? '' : 's'}`;
      lines.push(`- ${categoryLabel(s)} — ${label}`);
    }
    lines.push('');
  }

  // Investigation scope
  const duration = metrics.durationMs > 0
    ? formatDuration(metrics.durationMs)
    : undefined;
  const scopeParts = [`${metrics.toolCalls} tool calls`];
  if (duration) scopeParts.push(duration);
  if (metrics.totalEstimatedCostUsd > 0) {
    scopeParts.push(`~$${metrics.totalEstimatedCostUsd.toFixed(2)}`);
  }
  lines.push(`*Investigation scope: ${scopeParts.join(' | ')}*`);
  lines.push('');

  return lines.join('\n');
}

function overallVerdict(scorecard: Scorecard): string {
  const emoji = scoreEmoji(scorecard.overallScore);
  const redCount = scorecard.categories.filter(c => c.score === 'red').length;
  const yellowCount = scorecard.categories.filter(c => c.score === 'yellow').length;
  const greenCount = scorecard.categories.filter(c => c.score === 'green').length;
  const totalCats = scorecard.categories.length;

  switch (scorecard.overallScore) {
    case 'red':
      return `${emoji} **Overall: RED** — ${redCount} of ${totalCats} categories have critical issues requiring immediate attention.`;
    case 'yellow':
      return `${emoji} **Overall: YELLOW** — ${yellowCount} of ${totalCats} categories have issues worth addressing. No critical blockers found.`;
    case 'green':
      return `${emoji} **Overall: GREEN** — All ${greenCount} categories are healthy. ${totalCats === greenCount ? 'No significant issues found.' : ''}`;
  }
}

function severityCounts(scorecard: Scorecard): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const cat of scorecard.categories) {
    for (const f of cat.findings) {
      counts[f.severity]++;
    }
  }
  return counts;
}

function categoryLabel(cat: CategoryScore): string {
  const DISPLAY_NAMES: Record<string, string> = {
    stack: 'Stack & Framework',
    nextjs: 'Stack & Framework',
    'cms-integration': 'CMS Integration',
    'preview-editing': 'Preview & Editing',
    security: 'Security & Configuration',
    configuration: 'Security & Configuration',
    architecture: 'Architecture',
    routing: 'Architecture',
    'data-fetching': 'Architecture',
    dependencies: 'Dependencies',
    deployment: 'Deployment',
    performance: 'Performance',
    accessibility: 'Accessibility',
    forms: 'Forms & Inputs',
    aria: 'Dynamic Content',
  };
  return DISPLAY_NAMES[cat.category] ?? cat.category;
}

function scoreEmoji(score: ScoreLevel): string {
  switch (score) {
    case 'red': return '\u{1F534}';
    case 'yellow': return '\u{1F7E1}';
    case 'green': return '\u{1F7E2}';
  }
}

function truncate(text: string, maxLen: number): string {
  const oneLine = text.replace(/\n/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 3) + '...';
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
