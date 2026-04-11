/**
 * Shared run persistence for tiered storage (output/runs/{id}/).
 *
 * Used by both the CLI (analyzeAll) and dashboard (agentSession) to write
 * run data in the same format the dashboard reads.
 *
 * Schema:
 *   Tier 1: output/runs/index.json (run index)
 *   Tier 2: output/runs/{id}/envelope.json (scorecard, metrics, brief)
 *   Tier 3: output/runs/{id}/events.jsonl + findings.json
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Scorecard, RunMetrics } from '../types/output.js';
import type { Finding } from '../types/findings.js';

// ── Types ────────────────────────────────────────────────────

export type ScoreLevel = 'red' | 'yellow' | 'green';

export interface RunIndexEntry {
  id: string;
  goal: string;
  repoName: string;
  overallScore?: ScoreLevel;
  startedAt: string;
  completedAt?: string;
  findingsCount?: number;
  status?: 'in_progress' | 'completed';
  repoPath?: string;
  repoSource?: 'github' | 'local';
  repoUrl?: string;
  parentRunId?: string;
}

export interface RunEnvelopeData {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  briefMarkdown: string;
  terminationReason: string;
  findings: Finding[];
  parentRunId?: string;
}

// ── Internals ────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readIndex(indexFile: string): RunIndexEntry[] {
  try {
    if (!fs.existsSync(indexFile)) return [];
    return JSON.parse(fs.readFileSync(indexFile, 'utf-8'));
  } catch {
    return [];
  }
}

function writeIndex(indexFile: string, entries: RunIndexEntry[]): void {
  const tmp = indexFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, indexFile);
}

function appendToIndex(indexFile: string, entry: RunIndexEntry): void {
  const entries = readIndex(indexFile);
  const idx = entries.findIndex(e => e.id === entry.id);
  if (idx >= 0) entries[idx] = entry;
  else entries.unshift(entry);
  writeIndex(indexFile, entries);
}

// ── Public API ───────────────────────────────────────────────

/**
 * Persist a completed run to tiered storage.
 *
 * Writes:
 *   output/runs/{id}/envelope.json   (Tier 2: scorecard, metrics, brief, finding summaries)
 *   output/runs/{id}/events.jsonl    (Tier 3: investigation events)
 *   output/runs/{id}/findings.json   (Tier 3: full findings)
 *   output/runs/index.json           (Tier 1: updated index entry)
 */
export function persistRunToTieredStorage(
  runsDir: string,
  data: RunEnvelopeData,
  events?: Array<Record<string, unknown>>,
): void {
  try {
    ensureDir(runsDir);
    const dirPath = path.join(runsDir, data.id);
    ensureDir(dirPath);

    // Tier 2: envelope
    const envelope = {
      id: data.id,
      goal: data.goal,
      repoName: data.repoName,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      scorecard: data.scorecard,
      metrics: data.metrics,
      briefMarkdown: data.briefMarkdown,
      terminationReason: data.terminationReason,
      findingsSummary: data.findings.map(f => ({
        id: f.id,
        severity: f.severity,
        category: f.category,
        title: f.title,
        evidenceFiles: (f.evidence ?? []).map(e => e.filePath ?? ''),
        tags: f.tags ?? [],
      })),
      ...(data.parentRunId ? { parentRunId: data.parentRunId } : {}),
    };
    fs.writeFileSync(path.join(dirPath, 'envelope.json'), JSON.stringify(envelope, null, 2));

    // Tier 3: events
    if (events && events.length > 0) {
      const lines = events.map(e => JSON.stringify(e)).join('\n');
      fs.writeFileSync(path.join(dirPath, 'events.jsonl'), lines + '\n');
    }

    // Tier 3: findings
    fs.writeFileSync(path.join(dirPath, 'findings.json'), JSON.stringify(data.findings, null, 2));

    // Tier 1: index
    const indexFile = path.join(runsDir, 'index.json');
    appendToIndex(indexFile, {
      id: data.id,
      goal: data.goal,
      repoName: data.repoName,
      overallScore: data.scorecard.overallScore as ScoreLevel,
      startedAt: data.startedAt,
      completedAt: data.completedAt,
      findingsCount: data.findings.length,
      status: 'completed',
      ...(data.parentRunId ? { parentRunId: data.parentRunId } : {}),
    });
  } catch (err) {
    console.error(`[persistRunToTieredStorage] Failed for run ${data.id}:`, (err as Error).message);
  }
}
