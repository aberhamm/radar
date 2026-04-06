/**
 * Session cost persistence — save and aggregate RunMetrics across runs.
 *
 * After each agent run, saveSessionCost() appends the run's metrics to a
 * JSONL file in the output directory. loadSessionCosts() reads all entries
 * back, enabling cost tracking across multiple runs/sessions.
 *
 * Format: one JSON object per line (JSONL), append-friendly.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { RunMetrics } from '../types/output.js';

export interface SessionCostEntry {
  runId: string;
  repoName: string;
  goalType: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  toolCalls: number;
  totalEstimatedCostUsd: number;
  models: RunMetrics['models'];
}

const COSTS_FILENAME = 'session-costs.jsonl';

/**
 * Append a run's cost entry to the session costs file.
 * Creates the file and directory if they don't exist.
 */
export function saveSessionCost(
  outputDir: string,
  entry: SessionCostEntry,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, COSTS_FILENAME);
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(filePath, line, 'utf-8');
  return filePath;
}

/**
 * Build a SessionCostEntry from run results.
 */
export function buildSessionCostEntry(
  repoName: string,
  goalType: string,
  metrics: RunMetrics,
): SessionCostEntry {
  return {
    runId: `${repoName}-${metrics.startedAt}`,
    repoName,
    goalType,
    startedAt: metrics.startedAt,
    completedAt: metrics.completedAt,
    durationMs: metrics.durationMs,
    toolCalls: metrics.toolCalls,
    totalEstimatedCostUsd: metrics.totalEstimatedCostUsd,
    models: metrics.models,
  };
}

/**
 * Load all session cost entries from the JSONL file.
 * Returns an empty array if the file doesn't exist.
 * Skips malformed lines with a warning.
 */
export function loadSessionCosts(outputDir: string): SessionCostEntry[] {
  const filePath = path.join(outputDir, COSTS_FILENAME);
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const entries: SessionCostEntry[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as SessionCostEntry);
    } catch {
      console.warn(`[session-costs] Skipping malformed line: ${trimmed.slice(0, 80)}`);
    }
  }

  return entries;
}

/**
 * Compute aggregate cost summary across all session entries.
 */
export function aggregateSessionCosts(entries: SessionCostEntry[]): {
  totalRuns: number;
  totalCostUsd: number;
  totalDurationMs: number;
  totalToolCalls: number;
  costByRepo: Record<string, number>;
  costByGoal: Record<string, number>;
} {
  const costByRepo: Record<string, number> = {};
  const costByGoal: Record<string, number> = {};
  let totalCostUsd = 0;
  let totalDurationMs = 0;
  let totalToolCalls = 0;

  for (const entry of entries) {
    totalCostUsd += entry.totalEstimatedCostUsd;
    totalDurationMs += entry.durationMs;
    totalToolCalls += entry.toolCalls;
    costByRepo[entry.repoName] = (costByRepo[entry.repoName] ?? 0) + entry.totalEstimatedCostUsd;
    costByGoal[entry.goalType] = (costByGoal[entry.goalType] ?? 0) + entry.totalEstimatedCostUsd;
  }

  return {
    totalRuns: entries.length,
    totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
    totalDurationMs,
    totalToolCalls,
    costByRepo,
    costByGoal,
  };
}
