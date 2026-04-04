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
  newBudget?: number;
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
  /** Path to the persisted JSON file (for lazy-loading events from disk) */
  _filePath?: string;
}

export interface AgentSession {
  status: SessionStatus;
  currentRun: {
    id: string;
    goal: string;
    repoPath: string;
    repoName: string;
    startedAt: Date;
    events: StepEvent[];
    streamController: ReadableStreamDefaultController<Uint8Array> | null;
    budgetResolve: ((extend: boolean) => void) | null;
    budgetPausedData: { findings: number; toolCalls: number; budget: number } | null;
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

function runFilename(record: { repoName: string; goal: string; startedAt: Date | string }): string {
  const ts = record.startedAt instanceof Date
    ? record.startedAt.toISOString().replace(/[:.]/g, '-')
    : String(record.startedAt).replace(/[:.]/g, '-');
  return `${record.repoName}-${record.goal}-${ts}.json`;
}

/**
 * Checkpoint an in-progress run to disk. Called periodically during a run
 * so that events survive crashes. Overwrites the same file each time.
 */
export function checkpointRun(run: {
  id: string; goal: string; repoName: string; startedAt: Date; events: StepEvent[];
}): void {
  try {
    ensureOutputDir();
    const data = {
      id: run.id,
      goal: run.goal,
      repoName: run.repoName,
      startedAt: run.startedAt,
      status: 'in_progress',
      events: run.events,
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, runFilename(run)), JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[checkpoint] Failed to save run:', (err as Error).message);
  }
}

/** Save a completed run to disk as JSON. Overwrites any in-progress checkpoint. */
export function persistRun(record: RunRecord): void {
  try {
    ensureOutputDir();
    const data = {
      id: record.id,
      goal: record.goal,
      repoName: record.repoName,
      startedAt: record.startedAt,
      completedAt: record.completedAt,
      result: record.result,
      events: record.events,
    };
    fs.writeFileSync(path.join(OUTPUT_DIR, runFilename(record)), JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('[persist] Failed to save run:', (err as Error).message);
  }
}

/** Load all saved runs from disk, newest first. Events are lazy-loaded on demand. */
export function loadPersistedRuns(): RunRecord[] {
  try {
    ensureOutputDir();
  } catch (err) {
    console.warn('[loadPersistedRuns] Cannot create output dir:', (err as Error).message);
    return [];
  }

  let files: string[];
  try {
    files = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse();
  } catch (err) {
    console.warn('[loadPersistedRuns] Cannot read output dir:', (err as Error).message);
    return [];
  }

  const records: RunRecord[] = [];
  for (const f of files) {
    const filePath = path.join(OUTPUT_DIR, f);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      records.push({
        id: raw.id,
        goal: raw.goal,
        repoName: raw.repoName,
        startedAt: new Date(raw.startedAt),
        completedAt: raw.completedAt ? new Date(raw.completedAt) : undefined,
        result: raw.result,
        events: [],       // lazy — use loadRunEvents() when needed
        _filePath: filePath,
      } as RunRecord);
    } catch (err) {
      console.warn(`[loadPersistedRuns] Skipping corrupt file ${f}:`, (err as Error).message);
    }
  }
  return records;
}

/** Load events for a specific run from its persisted JSON file. */
export function loadRunEvents(record: RunRecord): StepEvent[] {
  // If events are already populated (current run, not from disk), return them
  if (record.events.length > 0) return record.events;

  // Lazy-load from disk
  if (!record._filePath) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(record._filePath, 'utf-8'));
    return raw.events ?? [];
  } catch (err) {
    console.warn(`[loadRunEvents] Failed to load events for run ${record.id}:`, (err as Error).message);
    return [];
  }
}

// --- SSE stream helper ---

const encoder = new TextEncoder();

/** Send a JSON-serializable event to the SSE stream. Silently ignores closed streams. */
export function sendStreamEvent(
  controller: ReadableStreamDefaultController<Uint8Array> | null,
  event: unknown,
): void {
  if (!controller) return;
  try {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  } catch { /* stream closed */ }
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
