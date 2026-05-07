/**
 * Session checkpointing — save and resume agent investigation state.
 *
 * Checkpoints are JSONL files (one JSON object per line, append-friendly).
 * Each line is a full snapshot of AgentState at that point in time.
 * On resume, the last valid checkpoint is loaded and hydrated back into
 * a live AgentState with Set/Map fields restored.
 *
 * Follows the same JSONL pattern as sessionCosts.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AgentState } from '../types/state.js';
import type { CheckpointEntry, SerializedAgentState, CheckpointTrigger } from '../types/checkpoint.js';

const CHECKPOINT_SUFFIX = '-checkpoint.jsonl';

/* ---------- serialize / hydrate ---------- */

/** Convert AgentState → JSON-safe SerializedAgentState. */
export function serializeState(state: AgentState): SerializedAgentState {
  return {
    goal: state.goal,
    repo: state.repo,
    resolvedVersions: state.resolvedVersions,
    stackProfile: state.stackProfile,
    findings: state.findings,
    filesRead: [...state.filesRead],
    fileReadCache: Object.fromEntries(state.fileReadCache),
    toolCallCount: state.toolCallCount,
    totalToolCallsExecuted: state.totalToolCallsExecuted,
    toolCallBudget: state.toolCallBudget,
    webSearchCount: state.webSearchCount,
    webSearchBudget: state.webSearchBudget,
    urlFetchCount: state.urlFetchCount,
    urlFetchBudget: state.urlFetchBudget,
    docTokensUsed: state.docTokensUsed,
    docTokenBudget: state.docTokenBudget,
    fetchedDocs: state.fetchedDocs,
    investigationLog: state.investigationLog,
    modelUsage: Object.fromEntries(state.modelUsage),
  };
}

/** Restore SerializedAgentState → live AgentState with Set/Map fields. */
export function hydrateState(s: SerializedAgentState): AgentState {
  return {
    goal: s.goal,
    repo: s.repo,
    resolvedVersions: s.resolvedVersions,
    stackProfile: s.stackProfile,
    findings: s.findings,
    filesRead: new Set(s.filesRead),
    fileReadCache: new Map(Object.entries(s.fileReadCache)),
    toolCallCount: s.toolCallCount,
    totalToolCallsExecuted: s.totalToolCallsExecuted ?? s.toolCallCount,
    toolCallBudget: s.toolCallBudget,
    webSearchCount: s.webSearchCount,
    webSearchBudget: s.webSearchBudget,
    urlFetchCount: s.urlFetchCount,
    urlFetchBudget: s.urlFetchBudget,
    docTokensUsed: s.docTokensUsed,
    docTokenBudget: s.docTokenBudget,
    fetchedDocs: s.fetchedDocs,
    investigationLog: s.investigationLog,
    modelUsage: new Map(Object.entries(s.modelUsage)),
  };
}

/* ---------- persistence ---------- */

/** Build the checkpoint file path for a given repo slug. */
export function checkpointPath(outputDir: string, repoSlug: string): string {
  return path.join(outputDir, `${repoSlug}${CHECKPOINT_SUFFIX}`);
}

/** Build a unique session ID from repo name, goal, and current time. */
export function buildSessionId(repoName: string, goal: string): string {
  return `${repoName}-${goal}-${Date.now()}`;
}

/**
 * Append a checkpoint entry to the JSONL file.
 * Creates the file and directory if they don't exist.
 */
export function saveCheckpoint(
  outputDir: string,
  repoSlug: string,
  entry: CheckpointEntry,
): string {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = checkpointPath(outputDir, repoSlug);
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(filePath, line, 'utf-8');
  return filePath;
}

/**
 * Build a CheckpointEntry from current state.
 */
export function buildCheckpointEntry(
  sessionId: string,
  seq: number,
  trigger: CheckpointTrigger,
  state: AgentState,
): CheckpointEntry {
  return {
    seq,
    sessionId,
    savedAt: new Date().toISOString(),
    trigger,
    state: serializeState(state),
  };
}

/**
 * Load the latest checkpoint from a JSONL file.
 * Returns null if the file doesn't exist or contains no valid entries.
 * Skips malformed lines with a warning.
 */
export function loadLatestCheckpoint(filePath: string): CheckpointEntry | null {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  let latest: CheckpointEntry | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as CheckpointEntry;
      // Keep the latest by seq number
      if (!latest || entry.seq > latest.seq) {
        latest = entry;
      }
    } catch {
      console.warn(`[checkpoint] Skipping malformed line: ${trimmed.slice(0, 80)}`);
    }
  }

  return latest;
}

/* ---------- resume summary ---------- */

/**
 * Build a natural-language summary of prior investigation state.
 * This is injected into the resumed agent prompt so the LLM knows
 * what was already found and can continue from there.
 */
export function buildResumeSummary(state: AgentState): string {
  const lines: string[] = [];

  lines.push('## Prior Investigation State');
  lines.push(`- Tool calls used: ${state.toolCallCount} / ${state.toolCallBudget}`);
  lines.push(`- Files read: ${state.filesRead.size}`);
  lines.push(`- Findings recorded: ${state.findings.length}`);

  // Findings by category
  const byCategory = new Map<string, number>();
  for (const f of state.findings) {
    byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
  }
  if (byCategory.size > 0) {
    lines.push('');
    lines.push('### Findings by category:');
    for (const [cat, count] of byCategory) {
      lines.push(`- ${cat}: ${count}`);
    }
  }

  // Stack profile if detected
  if (state.stackProfile) {
    const sp = state.stackProfile;
    lines.push('');
    lines.push(`### Detected stack: ${sp.framework.name} ${sp.framework.version} (${sp.framework.routerType} router) + ${sp.cms.platform}`);
  }

  // Key findings
  if (state.findings.length > 0) {
    lines.push('');
    lines.push('### Key findings so far:');
    for (const f of state.findings.slice(0, 15)) {
      const conf = f.confidence ? ` (confidence ${f.confidence}/10)` : '';
      lines.push(`- [${f.severity}] ${f.title} (${f.category})${conf}`);
    }
    if (state.findings.length > 15) {
      lines.push(`- ... and ${state.findings.length - 15} more`);
    }
  }

  // Files already read (so agent doesn't re-read them)
  if (state.filesRead.size > 0) {
    lines.push('');
    lines.push('### Files already read (do not re-read these):');
    const readList = [...state.filesRead].slice(0, 30);
    for (const f of readList) {
      lines.push(`- ${f}`);
    }
    if (state.filesRead.size > 30) {
      lines.push(`- ... and ${state.filesRead.size - 30} more`);
    }
  }

  return lines.join('\n');
}
