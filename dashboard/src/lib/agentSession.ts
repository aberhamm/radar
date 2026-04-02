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
  timestamp?: string;
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
  lastError?: string;
}

declare global {
  var __agentSession: AgentSession | undefined;
}

// --- Disk persistence (output/ directory) ---

import fs from 'node:fs';
import path from 'node:path';

const OUTPUT_DIR = path.resolve(process.cwd(), '..', 'output', 'runs');

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

/** Save a completed run to disk as JSON. */
export function persistRun(record: RunRecord): void {
  try {
    ensureOutputDir();
    const ts = record.startedAt instanceof Date
      ? record.startedAt.toISOString().replace(/[:.]/g, '-')
      : String(record.startedAt).replace(/[:.]/g, '-');
    const filename = `${record.repoName}-${record.goal}-${ts}.json`;
    const data = {
      id: record.id,
      goal: record.goal,
      repoName: record.repoName,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      result: record.result,
      events: record.events,
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[persist] Failed to save run:', (err as Error).message);
  }
}

/** Load all saved runs from disk, newest first. */
export function loadPersistedRuns(): RunRecord[] {
  try {
    ensureOutputDir();
    const files = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();

    return files.map(f => {
      const raw = JSON.parse(fs.readFileSync(path.join(OUTPUT_DIR, f), 'utf-8'));
      return {
        id: raw.id,
        goal: raw.goal,
        repoName: raw.repoName,
        startedAt: new Date(raw.startedAt),
        completedAt: raw.completedAt ? new Date(raw.completedAt) : undefined,
        result: raw.result,
        events: raw.events ?? [],
      } as RunRecord;
    });
  } catch {
    return [];
  }
}

// --- Session management ---

function createSession(): AgentSession {
  return {
    status: 'idle',
    currentRun: null,
    history: loadPersistedRuns(),
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
  const history = globalThis.__agentSession?.history ?? loadPersistedRuns();
  globalThis.__agentSession = {
    status: 'idle',
    currentRun: null,
    history,
    result: null,
  };
}
