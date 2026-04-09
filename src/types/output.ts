/**
 * Output schemas — scorecard, narrative brief, run metrics.
 */

import type { Finding, FindingCategory } from './findings.js';
import type { StackProfile } from './state.js';

export type ScoreLevel = 'red' | 'yellow' | 'green';

export interface CategoryScore {
  category: FindingCategory;
  score: ScoreLevel;
  findings: Finding[];
  summary: string;
}

export interface Scorecard {
  repoName: string;
  goalType: string;
  generatedAt: string;
  overallScore: ScoreLevel;
  categories: CategoryScore[];
  topRisks: Finding[];
}

export interface AssembledOutput {
  goalType: string;
  sections: Record<string, string>;
  findings: Finding[];
  scorecard: Scorecard;
  stackProfile?: StackProfile;
}

/** Run metrics — computed post-run from AgentState.modelUsage. */
export interface RunMetrics {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  toolCalls: number;
  models: {
    [modelAlias: string]: {
      bedrockModelId: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      estimatedCostUsd: number;
    };
  };
  totalEstimatedCostUsd: number;
  /** Per-turn timing: total ms spent waiting for LLM responses */
  llmLatencyMs?: number;
  /** Number of LLM turns (reasoning cycles) */
  llmTurns?: number;
}
