/**
 * Render the investigation log as a static HTML file.
 * Collapsible sections per tool call, inline scorecard, syntax-highlighted snippets.
 */

import type { Scorecard } from '../types/output.js';

interface LogEntry {
  step: number;
  action: string;
  reasoning?: string;
  result?: string;
}

interface HtmlLogOptions {
  repoName: string;
  entries: LogEntry[];
  scorecard: Scorecard;
  totalDuration?: string;
  toolCallCount?: number;
  findingCount?: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scorecardHtml(scorecard: Scorecard): string {
  const rows = scorecard.categories.map((cat) => {
    const color = cat.score === 'red' ? '#dc2626' : cat.score === 'yellow' ? '#ca8a04' : '#16a34a';
    const bg = cat.score === 'red' ? '#fef2f2' : cat.score === 'yellow' ? '#fefce8' : '#f0fdf4';
    const displayName = cat.category;
    const findingCount = cat.findings?.length ?? 0;
    return `<tr style="background:${bg}">
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${escapeHtml(displayName)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:${color};font-weight:600">${cat.score.toUpperCase()}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${findingCount} findings</td>
    </tr>`;
  }).join('\n');

  return `<table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin:24px 0">
    <thead><tr style="background:#f9fafb">
      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Category</th>
      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Score</th>
      <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e5e7eb">Findings</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function stepHtml(entry: LogEntry): string {
  const actionColor = entry.action === 'record_finding' ? '#7c3aed'
    : entry.action === 'assemble_output' ? '#059669'
    : entry.action === 'model_switch' ? '#d97706'
    : '#2563eb';

  return `<details style="margin:4px 0;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
    <summary style="padding:8px 12px;cursor:pointer;background:#f9fafb;font-family:monospace;font-size:13px">
      <span style="color:#6b7280;margin-right:8px">#${entry.step}</span>
      <span style="color:${actionColor};font-weight:600">${escapeHtml(entry.action)}</span>
    </summary>
    <div style="padding:12px;font-size:13px">
      ${entry.reasoning ? `<div style="margin-bottom:8px"><strong style="color:#374151">Reasoning:</strong><pre style="background:#f3f4f6;padding:8px;border-radius:4px;overflow-x:auto;margin:4px 0;font-size:12px">${escapeHtml(entry.reasoning)}</pre></div>` : ''}
      ${entry.result ? `<div><strong style="color:#374151">Result:</strong><pre style="background:#f3f4f6;padding:8px;border-radius:4px;overflow-x:auto;margin:4px 0;font-size:12px">${escapeHtml(entry.result)}</pre></div>` : ''}
    </div>
  </details>`;
}

export function renderInvestigationHtml(options: HtmlLogOptions): string {
  const { repoName, entries, scorecard, totalDuration, toolCallCount, findingCount } = options;

  const steps = entries.map(stepHtml).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Investigation Log — ${escapeHtml(repoName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #111827; background: #fff; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .meta { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    .stats { display: flex; gap: 24px; margin-bottom: 24px; }
    .stat { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 16px; }
    .stat-value { font-size: 24px; font-weight: 700; }
    .stat-label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
    h2 { font-size: 18px; margin-top: 32px; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
    details summary:hover { background: #f3f4f6; }
    pre { white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>Investigation Log</h1>
  <div class="meta">${escapeHtml(repoName)} — generated ${new Date().toISOString().slice(0, 10)}</div>

  <div class="stats">
    ${toolCallCount !== undefined ? `<div class="stat"><div class="stat-value">${toolCallCount}</div><div class="stat-label">Tool Calls</div></div>` : ''}
    ${findingCount !== undefined ? `<div class="stat"><div class="stat-value">${findingCount}</div><div class="stat-label">Findings</div></div>` : ''}
    ${totalDuration ? `<div class="stat"><div class="stat-value">${escapeHtml(totalDuration)}</div><div class="stat-label">Duration</div></div>` : ''}
  </div>

  <h2>Scorecard</h2>
  ${scorecardHtml(scorecard)}

  <h2>Investigation Steps (${entries.length})</h2>
  ${steps}
</body>
</html>`;
}
