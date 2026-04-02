// NOTE: Dashboard types are intentionally inlined (not imported from @agent/)
// to avoid webpack resolving the entire agent dependency tree for every route.
// Keep in sync with the corresponding types in src/.

// --- From src/types/findings.ts ---

export type FindingCategory =
  | 'stack' | 'cms-integration' | 'preview-editing' | 'configuration'
  | 'security' | 'architecture' | 'dependencies' | 'deployment'
  | 'routing' | 'data-fetching' | 'nextjs';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ScoreLevel = 'red' | 'yellow' | 'green';

// --- From src/types/output.ts ---

export interface CategoryScore {
  category: FindingCategory;
  score: ScoreLevel;
  findings: unknown[];
  summary: string;
}

export interface Scorecard {
  repoName: string;
  goalType: string;
  generatedAt: string;
  overallScore: ScoreLevel;
  categories: CategoryScore[];
  topRisks: Array<{ id: string; severity: Severity; title: string }>;
}

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
}

// --- From src/agent/runner.ts ---

export interface StepEvent {
  step: number;
  type?: string;
  action: string;
  args?: string;
  result?: string;
  fullResult?: string;
  reasoning?: string;
  fullReasoning?: string;
  batchId?: string;
}

export interface RunResult {
  scorecard: Scorecard;
  metrics: RunMetrics;
  terminationReason: string;
  briefMarkdown: string;
  outputPaths: string[];
  state: { findings: unknown[] };
  errorDetail?: string;
}

export type SessionStatus = 'idle' | 'running' | 'budget_paused' | 'complete' | 'error';

export interface RunRecord {
  id: string;
  goal: string;
  repoName: string;
  startedAt: Date;
  completedAt?: Date;
  result?: RunResult;
  events: StepEvent[];
}

export interface AgentSession {
  status: SessionStatus;
  currentRun: {
    goal: string;
    repoPath: string;
    repoName: string;
    startedAt: Date;
    events: StepEvent[];
    streamController: ReadableStreamDefaultController<Uint8Array> | null;
    budgetResolve: ((extend: boolean) => void) | null;
    abortController: AbortController | null;
  } | null;
  history: RunRecord[];
  result: RunResult | null;
}

declare global {
  var __agentSession: AgentSession | undefined;
}

function createSession(): AgentSession {
  return {
    status: 'idle',
    currentRun: null,
    history: [],
    result: null,
  };
}

export function getSession(): AgentSession {
  if (!globalThis.__agentSession) {
    globalThis.__agentSession = createSession();
  }
  return globalThis.__agentSession;
}

export function resetSession(): void {
  globalThis.__agentSession = createSession();
}
