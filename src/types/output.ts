/**
 * Output schemas — scorecard, narrative brief, run metrics.
 */

import type { Finding } from './findings.js';
import type { StackProfile } from './state.js';

export type ScoreLevel = 'red' | 'yellow' | 'green';

export interface FindingCount {
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface CategoryScore {
  category: string;
  score: ScoreLevel;
  findings: Finding[];
  findingCount: FindingCount;
  keyFindings: string[];
  summary: string;
}

export interface RankedRisk {
  rank: number;
  findingId: string;
  title: string;
  severity: string;
  businessContext: string;
  recommendation: string;
}

export interface ScorecardMetadata {
  repoName: string;
  repoUrl?: string;
  analysisDate: string;
  agentVersion: string;
  goalType: string;
  detectedPlatform: string;
  toolCallsUsed: number;
  webSearchesUsed: number;
  urlFetchesUsed: number;
  documentationSources: { url: string; title: string }[];
}

export interface Scorecard {
  metadata: ScorecardMetadata;
  /** @deprecated Use metadata.repoName */
  repoName: string;
  /** @deprecated Use metadata.goalType */
  goalType: string;
  /** @deprecated Use metadata.analysisDate */
  generatedAt: string;
  overallScore: ScoreLevel;
  categories: CategoryScore[];
  topRisks: RankedRisk[];
  findings: Finding[];
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
