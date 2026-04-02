import type { Scorecard, RunMetrics, StepEvent, CategoryScore } from './agentSession';

// ── File download helpers ──────────────────────────────────────

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Clipboard ──────────────────────────────────────────────────

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── Report (Markdown) ──────────────────────────────────────────

function scorecardToMarkdown(scorecard: Scorecard): string {
  const lines: string[] = [];
  lines.push(`# ${scorecard.repoName} — ${scorecard.goalType} Audit`);
  lines.push('');
  lines.push(`**Overall: ${scorecard.overallScore.toUpperCase()}** · Generated ${scorecard.generatedAt}`);
  lines.push('');

  lines.push('## Categories');
  lines.push('');
  lines.push('| Category | Score | Findings |');
  lines.push('|----------|-------|----------|');
  for (const cat of scorecard.categories) {
    lines.push(`| ${cat.category} | ${cat.score.toUpperCase()} | ${cat.findings.length} |`);
  }
  lines.push('');

  if (scorecard.topRisks.length > 0) {
    lines.push('## Top Risks');
    lines.push('');
    for (const risk of scorecard.topRisks) {
      lines.push(`- **[${risk.severity.toUpperCase()}]** ${risk.title}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildReportMarkdown(briefMarkdown: string, scorecard: Scorecard): string {
  return scorecardToMarkdown(scorecard) + '---\n\n' + briefMarkdown;
}

export function exportReportMarkdown(briefMarkdown: string, scorecard: Scorecard) {
  const md = buildReportMarkdown(briefMarkdown, scorecard);
  downloadBlob(md, `${scorecard.repoName}-report.md`, 'text/markdown');
}

// ── Events (CSV) ───────────────────────────────────────────────

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function eventsToCSV(events: StepEvent[]): string {
  const headers = ['Step', 'Type', 'Timestamp', 'Action', 'Args', 'Result', 'Reasoning'];
  const rows = events.map(e => [
    String(e.step),
    e.type ?? '',
    e.timestamp ?? '',
    e.action,
    e.args ?? '',
    (e.fullResult ?? e.result ?? '').slice(0, 2000),
    (e.fullReasoning ?? e.reasoning ?? '').slice(0, 1000),
  ]);

  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

export function exportEventsCSV(events: StepEvent[], repoName: string) {
  downloadBlob(eventsToCSV(events), `${repoName}-events.csv`, 'text/csv');
}

// ── Cost (CSV + Markdown) ──────────────────────────────────────

export function costToCSV(metrics: RunMetrics): string {
  const headers = ['Model', 'Calls', 'Input Tokens', 'Output Tokens', 'Cached Tokens', 'Cost (USD)'];
  const rows = Object.entries(metrics.models).map(([modelId, info]) => [
    modelId,
    String(info.calls),
    String(info.inputTokens),
    String(info.outputTokens),
    String(info.cachedTokens),
    info.estimatedCostUsd.toFixed(4),
  ]);

  // Add totals row
  rows.push([
    'TOTAL',
    String(metrics.toolCalls),
    String(Object.values(metrics.models).reduce((s, m) => s + m.inputTokens, 0)),
    String(Object.values(metrics.models).reduce((s, m) => s + m.outputTokens, 0)),
    String(Object.values(metrics.models).reduce((s, m) => s + m.cachedTokens, 0)),
    metrics.totalEstimatedCostUsd.toFixed(4),
  ]);

  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(','));
  }
  return lines.join('\n');
}

export function costToMarkdown(metrics: RunMetrics): string {
  const durationS = (metrics.durationMs / 1000).toFixed(1);
  const lines: string[] = [];

  lines.push('## Cost Summary');
  lines.push('');
  lines.push(`- **Total Cost:** $${metrics.totalEstimatedCostUsd.toFixed(4)}`);
  lines.push(`- **Duration:** ${durationS}s`);
  lines.push(`- **Tool Calls:** ${metrics.toolCalls}`);
  lines.push('');
  lines.push('| Model | Calls | Input | Output | Cached | Cost |');
  lines.push('|-------|-------|-------|--------|--------|------|');
  for (const [modelId, info] of Object.entries(metrics.models)) {
    lines.push(`| ${modelId.replace('us.anthropic.', '')} | ${info.calls} | ${info.inputTokens.toLocaleString()} | ${info.outputTokens.toLocaleString()} | ${info.cachedTokens.toLocaleString()} | $${info.estimatedCostUsd.toFixed(4)} |`);
  }
  lines.push('');

  return lines.join('\n');
}

export function exportCostCSV(metrics: RunMetrics, repoName: string) {
  downloadBlob(costToCSV(metrics), `${repoName}-cost.csv`, 'text/csv');
}
