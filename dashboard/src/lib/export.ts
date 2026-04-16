import type { Scorecard, RunMetrics, StepEvent, CategoryScore } from './agentSession';

// ── File download helpers ──────────────────────────────────────

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  downloadBlobObj(blob, filename);
}

function downloadBlobObj(blob: Blob, filename: string) {
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

function goalTitle(goalType: string): string {
  switch (goalType) {
    case 'onboarding': return 'Onboarding Brief';
    case 'audit': return 'Architecture Audit';
    case 'migration': return 'Migration Scout Report';
    case 'component-map': return 'Component Map';
    case 'ci-check': return 'CI Health Check';
    case 'security-review': return 'Security Review';
    case 'nextjs': return 'Next.js Health Check';
    case 'accessibility': return 'Accessibility Audit';
    default: return 'Analysis Report';
  }
}

/**
 * Compact header for the exported report. The full scorecard table, top risks,
 * and investigation log are already rendered inside the brief markdown by
 * renderBrief(), so we only emit a one-line title + overall score here to
 * avoid duplication.
 */
function scorecardHeader(scorecard: Scorecard): string {
  const title = goalTitle(scorecard.goalType);
  const date = new Date(scorecard.generatedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  return `# ${scorecard.repoName} — ${title}\n\n**Overall: ${scorecard.overallScore.toUpperCase()}** · ${date}\n\n`;
}

export function buildReportMarkdown(briefMarkdown: string, scorecard: Scorecard): string {
  return scorecardHeader(scorecard) + '---\n\n' + briefMarkdown;
}

export function exportReportMarkdown(briefMarkdown: string, scorecard: Scorecard) {
  const md = buildReportMarkdown(briefMarkdown, scorecard);
  const slug = scorecard.repoName.replace(/[^a-zA-Z0-9-]/g, '-');
  downloadBlob(md, `${slug}-report.md`, 'text/markdown');
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

// ── Multi-Goal Report (Markdown) ──────────────────────────────

export function buildMultiGoalMarkdown(
  goals: Array<{ goal: string; scorecard: Scorecard; briefMarkdown: string }>,
  repoName: string,
): string {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const lines: string[] = [];
  lines.push(`# ${repoName} — Full Analysis Report`);
  lines.push('');
  lines.push(`**${goals.length} goals analyzed** · ${date}`);
  lines.push('');

  // Summary table
  lines.push('| Goal | Score |');
  lines.push('|------|-------|');
  for (const g of goals) {
    lines.push(`| ${goalTitle(g.goal)} | **${g.scorecard.overallScore.toUpperCase()}** |`);
  }
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const g of goals) {
    lines.push(`## ${goalTitle(g.goal)}`);
    lines.push('');
    lines.push(`**Overall: ${g.scorecard.overallScore.toUpperCase()}**`);
    lines.push('');
    if (g.briefMarkdown) {
      lines.push(g.briefMarkdown);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export function exportMultiGoalMarkdown(
  goals: Array<{ goal: string; scorecard: Scorecard; briefMarkdown: string }>,
  repoName: string,
) {
  const md = buildMultiGoalMarkdown(goals, repoName);
  const slug = repoName.replace(/[^a-zA-Z0-9-]/g, '-');
  downloadBlob(md, `${slug}-full-report.md`, 'text/markdown');
}

// ── Report (PDF) ──────────────────────────────────────────────

export async function exportReportPDF(
  scorecard: Scorecard,
  findings: unknown[],
  metrics: RunMetrics,
): Promise<void> {
  const res = await fetch('/api/export-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scorecard, findings, metrics }),
  });

  if (!res.ok) {
    throw new Error(`PDF export failed: ${res.status}`);
  }

  const blob = await res.blob();
  const slug = scorecard.repoName.replace(/[^a-zA-Z0-9-]/g, '-');
  downloadBlobObj(blob, `${slug}-report.pdf`);
}
