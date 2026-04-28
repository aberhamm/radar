/**
 * Output file writer — persists all run artifacts to disk.
 *
 * After the agent loop completes, the runner calls writeOutputFiles() to write
 * six artifacts per run:
 *   1. {slug}-scorecard.json   — Scored categories (red/yellow/green) + top risks
 *   2. {slug}-brief.md         — Human-readable markdown brief with all sections
 *   3. {slug}-findings.json    — Raw findings array for downstream tooling
 *   4. {slug}-export.json      — Full export (findings + investigation log + metrics)
 *   5. {slug}-investigation.md — Step-by-step investigation log (markdown)
 *   6. {slug}-investigation.html — Interactive investigation log (static HTML)
 *
 * All files go into the configured outputDir. The slug is derived from repoName
 * with non-alphanumeric characters replaced by hyphens.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Scorecard } from '../types/output.js';
import type { AgentState } from '../types/state.js';
import { renderInvestigationHtml } from '../output/investigationHtml.js';

/** Write all output artifacts to outputDir. Returns the list of written file paths. */
export function writeOutputFiles(
  outputDir: string,
  repoName: string,
  scorecard: Scorecard,
  briefMarkdown: string,
  exportJson: string,
  state: AgentState,
): string[] {
  fs.mkdirSync(outputDir, { recursive: true });

  const paths: string[] = [];
  const slug = repoName.replace(/[^a-zA-Z0-9-]/g, '-');

  const scorecardPath = path.join(outputDir, `${slug}-scorecard.json`);
  fs.writeFileSync(scorecardPath, JSON.stringify(scorecard, null, 2), 'utf-8');
  paths.push(scorecardPath);

  const briefPath = path.join(outputDir, `${slug}-brief.md`);
  fs.writeFileSync(briefPath, briefMarkdown, 'utf-8');
  paths.push(briefPath);

  const findingsPath = path.join(outputDir, `${slug}-findings.json`);
  fs.writeFileSync(findingsPath, JSON.stringify(state.findings, null, 2), 'utf-8');
  paths.push(findingsPath);

  const exportPath = path.join(outputDir, `${slug}-export.json`);
  fs.writeFileSync(exportPath, exportJson, 'utf-8');
  paths.push(exportPath);

  const logPath = path.join(outputDir, `${slug}-investigation.md`);
  const logContent = renderInvestigationLog(state);
  fs.writeFileSync(logPath, logContent, 'utf-8');
  paths.push(logPath);

  const htmlLogPath = path.join(outputDir, `${slug}-investigation.html`);
  const htmlContent = renderInvestigationHtml({
    repoName: state.repo.name,
    entries: state.investigationLog,
    scorecard,
    toolCallCount: state.toolCallCount,
    findingCount: state.findings.length,
  });
  fs.writeFileSync(htmlLogPath, htmlContent, 'utf-8');
  paths.push(htmlLogPath);

  return paths;
}

/** Render the investigation log as a markdown document. */
export function renderInvestigationLog(state: AgentState): string {
  const lines: string[] = [];
  lines.push(`# Investigation Log: ${state.repo.name}`);
  lines.push('');
  lines.push(`**Goal:** ${state.goal}`);
  lines.push(`**Tool calls:** ${state.toolCallCount} / ${state.toolCallBudget}`);
  lines.push(`**Findings:** ${state.findings.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const entry of state.investigationLog) {
    lines.push(`## Step ${entry.step}: ${entry.action}`);
    lines.push('');
    lines.push(`**Reasoning:** ${entry.reasoning}`);
    lines.push('');
    lines.push(`**Result:** ${entry.result}`);
    lines.push('');
  }

  return lines.join('\n');
}
