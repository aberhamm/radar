/**
 * Agent state — maintained across tool calls during investigation.
 */

import type { Finding } from './findings.js';

export type GoalType = 'onboarding' | 'audit' | 'audit-generic' | 'migration' | 'component-map' | 'ci-check' | 'security-review' | 'nextjs' | 'accessibility' | 'performance';

export const ALL_GOALS: GoalType[] = [
  'onboarding', 'audit', 'audit-generic', 'migration', 'component-map',
  'ci-check', 'security-review', 'nextjs', 'accessibility', 'performance',
];

export interface InvestigationEntry {
  step: number;
  action: string;
  reasoning: string;
  result: string;
  fullReasoning?: string;
  fullResult?: string;
  args?: string;
  timestamp?: string;
  model?: string;
  batchId?: string;
  durationMs?: number;
  thinking?: string;
}

export interface FetchedDoc {
  url: string;
  title: string;
  fetchedAt: string;
  tokenCount: number;
  usedInFindings: string[];
}

export interface ResolvedVersion {
  package: string;
  latest: string;
  latestMajor: number;
  fetchedAt: string;
}

export type ResolvedVersionMap = Record<string, ResolvedVersion>;

export interface PackageInfo {
  name: string;
  version: string;
  isDev: boolean;
}

export interface StackProfile {
  projectType: 'sitecore' | 'optimizely' | 'unknown';
  projectTypeConfidence: 'high' | 'medium' | 'low';
  framework: {
    name: string;
    version: string;
    routerType: 'pages' | 'app' | 'hybrid' | 'unknown';
  };
  cms: {
    platform: string;
    sdkPackages: PackageInfo[];
    integrationStyle: string;
  };
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'unknown';
  language: 'typescript' | 'javascript' | 'mixed';
  deploymentIndicators: string[];
  monorepo: boolean;
  monorepoTool?: string;
}

/** Per-model usage tracking — accumulated by the runner after each LLM call. */
export interface ModelUsageEntry {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface AgentState {
  goal: GoalType;
  repo: {
    source: 'github' | 'local';
    url?: string;
    localPath: string;
    name: string;
  };
  resolvedVersions: ResolvedVersionMap;
  stackProfile?: StackProfile;
  findings: Finding[];
  filesRead: Set<string>;
  /** Dedup cache: tracks file mtime + size + content summary to avoid re-sending unchanged files. */
  fileReadCache: Map<string, { mtime: number; size: number; summary?: string }>;
  toolCallCount: number;
  /** Total actual tool calls executed (includes budget-free calls like worker record_finding). */
  totalToolCallsExecuted: number;
  toolCallBudget: number;
  webSearchCount: number;
  webSearchBudget: number;
  urlFetchCount: number;
  urlFetchBudget: number;
  docTokensUsed: number;
  docTokenBudget: number;
  fetchedDocs: FetchedDoc[];
  investigationLog: InvestigationEntry[];
  /** Per-model token/call tracking for RunMetrics. Key = model alias (e.g. "sonnet-4.6"). */
  modelUsage: Map<string, ModelUsageEntry>;
}
