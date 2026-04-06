/**
 * Session checkpoint types — for resuming interrupted agent runs.
 */

import type { GoalType, AgentState, ModelUsageEntry } from './state.js';
import type { Finding } from './findings.js';

export type CheckpointTrigger = 'periodic' | 'error' | 'budget_exhausted' | 'completed';

/** A single checkpoint entry in the JSONL file. */
export interface CheckpointEntry {
  /** Monotonic sequence number within this session. */
  seq: number;
  /** Session identifier: {repoName}-{goal}-{timestamp}. */
  sessionId: string;
  /** ISO timestamp when this checkpoint was saved. */
  savedAt: string;
  /** What triggered this checkpoint. */
  trigger: CheckpointTrigger;
  /** Serializable snapshot of AgentState. */
  state: SerializedAgentState;
}

/**
 * AgentState with Set/Map fields converted to JSON-safe types.
 * Mirrors AgentState exactly, but with:
 *   Set<string>      → string[]
 *   Map<K, V>        → Record<string, V>
 */
export interface SerializedAgentState {
  goal: GoalType;
  repo: AgentState['repo'];
  resolvedVersions: AgentState['resolvedVersions'];
  stackProfile?: AgentState['stackProfile'];
  findings: Finding[];
  filesRead: string[];
  fileReadCache: Record<string, { mtime: number; contentHash: string }>;
  toolCallCount: number;
  toolCallBudget: number;
  webSearchCount: number;
  webSearchBudget: number;
  urlFetchCount: number;
  urlFetchBudget: number;
  docTokensUsed: number;
  docTokenBudget: number;
  fetchedDocs: AgentState['fetchedDocs'];
  investigationLog: AgentState['investigationLog'];
  modelUsage: Record<string, ModelUsageEntry>;
}
