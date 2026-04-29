// NOTE: Dashboard types are intentionally inlined (not imported from @agent/)
// to avoid webpack resolving the entire agent dependency tree for every route.
// Keep in sync with the corresponding types in src/.

// --- From src/types/findings.ts ---

export type FindingCategory =
  | 'stack' | 'cms-integration' | 'preview-editing' | 'configuration'
  | 'security' | 'architecture' | 'dependencies' | 'deployment'
  | 'routing' | 'data-fetching' | 'nextjs'
  | 'performance' | 'accessibility' | 'forms' | 'aria';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ScoreLevel = 'red' | 'yellow' | 'green';

// --- From src/types/output.ts ---

export interface CategoryScore {
  category: string;
  score: ScoreLevel;
  findings: unknown[];
  summary: string;
}

export interface RankedRisk {
  rank: number;
  findingId: string;
  title: string;
  severity: string;
  businessContext: string;
}

export interface Scorecard {
  repoName: string;
  goalType: string;
  generatedAt: string;
  overallScore: ScoreLevel;
  categories: CategoryScore[];
  topRisks: RankedRisk[];
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
  /** Structured metadata from the tool result (e.g. findingId, severity, matchCount) */
  details?: Record<string, unknown>;
}

export interface SourceFile {
  content: string;
  lineCount: number;
  language: string;
}

export interface RunResult {
  scorecard: Scorecard;
  metrics: RunMetrics;
  terminationReason: string;
  briefMarkdown: string;
  outputPaths: string[];
  state: { findings: unknown[] };
  errorDetail?: string;
  sources?: Record<string, SourceFile>;
}

export type SessionStatus = 'idle' | 'running' | 'budget_paused' | 'complete' | 'error';

export interface RunIndexEntry {
  id: string;
  goal: string;
  repoName: string;
  overallScore?: ScoreLevel;
  startedAt: string;       // ISO string
  completedAt?: string;
  findingsCount?: number;
  status?: 'in_progress' | 'completed';
  repoPath?: string;
  repoSource?: 'github' | 'local';
  repoUrl?: string;
  /** Shared ID linking child entries of a multi-goal (--goal all) run */
  parentRunId?: string;
}

/** Unified history item for sidebar display. Derived from RunIndexEntry. */
export interface HistoryItem {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  hasResult: boolean;
  findingsCount?: number;
  score?: ScoreLevel | null;
  repoPath?: string;
  repoSource?: 'github' | 'local';
  repoUrl?: string;
  parentRunId?: string;
}

export interface RunEnvelope {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  briefMarkdown: string;
  terminationReason: string;
  findingsSummary: Array<{
    id: string;
    severity: string;
    category: string;
    title: string;
    evidenceFiles: string[];
    tags: string[];
  }>;
  /** Shared ID linking child envelopes of a multi-goal run */
  parentRunId?: string;
}

export interface RunRecord {
  id: string;
  goal: string;
  repoName: string;
  startedAt: Date;
  completedAt?: Date;
  overallScore?: ScoreLevel;
  findingsCount?: number;
  result?: RunResult;
  events: StepEvent[];
  repoPath?: string;
  repoSource?: 'github' | 'local';
  repoUrl?: string;
  /** Shared ID linking child records of a multi-goal run */
  parentRunId?: string;
  /** Directory path for tiered storage: output/runs/{id}/ */
  _dirPath?: string;
  /** Legacy: flat file path (for backward compat during migration) */
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
const INDEX_FILE = path.join(OUTPUT_DIR, 'index.json');

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function runDirPath(id: string): string {
  return path.join(OUTPUT_DIR, id);
}

/** Legacy filename for backward-compat migration detection. */
function runFilename(record: { repoName: string; goal: string; startedAt: Date | string }): string {
  const ts = record.startedAt instanceof Date
    ? record.startedAt.toISOString().replace(/[:.]/g, '-')
    : String(record.startedAt).replace(/[:.]/g, '-');
  return `${record.repoName}-${record.goal}-${ts}.json`;
}

// ── Index helpers (Tier 1) ────────────────────────────────────

function readIndex(): RunIndexEntry[] {
  try {
    if (!fs.existsSync(INDEX_FILE)) return [];
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function writeIndex(entries: RunIndexEntry[]): void {
  const tmp = INDEX_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, INDEX_FILE);
}

function appendToIndex(entry: RunIndexEntry): void {
  const entries = readIndex();
  const idx = entries.findIndex(e => e.id === entry.id);
  if (idx >= 0) entries[idx] = entry;
  else entries.unshift(entry);
  writeIndex(entries);
}

// ── Tier 2/3 writers ──────────────────────────────────────────

function writeEnvelope(dirPath: string, record: RunRecord): void {
  const findings = (record.result?.state?.findings ?? []) as Array<Record<string, unknown>>;
  const envelope: RunEnvelope = {
    id: record.id,
    goal: record.goal,
    repoName: record.repoName,
    startedAt: record.startedAt instanceof Date ? record.startedAt.toISOString() : String(record.startedAt),
    completedAt: record.completedAt instanceof Date ? record.completedAt.toISOString() : record.completedAt ? String(record.completedAt) : undefined,
    scorecard: record.result!.scorecard,
    metrics: record.result!.metrics,
    briefMarkdown: record.result!.briefMarkdown,
    terminationReason: record.result!.terminationReason,
    findingsSummary: findings.map(f => ({
      id: String(f.id ?? ''),
      severity: String(f.severity ?? 'info'),
      category: String(f.category ?? ''),
      title: String(f.title ?? ''),
      evidenceFiles: ((f.evidence as Array<{ filePath?: string }>) ?? []).map(e => e.filePath ?? ''),
      tags: (f.tags as string[]) ?? [],
    })),
    ...(record.parentRunId ? { parentRunId: record.parentRunId } : {}),
  };
  fs.writeFileSync(path.join(dirPath, 'envelope.json'), JSON.stringify(envelope, null, 2));
}

function writeEventsJsonl(dirPath: string, events: StepEvent[]): void {
  const lines = events.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(path.join(dirPath, 'events.jsonl'), lines + (lines.length ? '\n' : ''));
}

function writeFindings(dirPath: string, findings: unknown[]): void {
  fs.writeFileSync(path.join(dirPath, 'findings.json'), JSON.stringify(findings, null, 2));
}

function writeSources(dirPath: string, sources: Record<string, SourceFile>): void {
  fs.writeFileSync(path.join(dirPath, 'sources.json'), JSON.stringify(sources, null, 2));
}

// ── Persist & checkpoint ──────────────────────────────────────

/**
 * Checkpoint an in-progress run to disk. Called periodically during a run
 * so that events survive crashes.
 */
export function checkpointRun(run: {
  id: string; goal: string; repoName: string; startedAt: Date; events: StepEvent[];
}): void {
  // Never checkpoint the meta 'all' goal — only individual goal children get indexed
  if (run.goal === 'all') return;

  try {
    ensureOutputDir();
    const dirPath = runDirPath(run.id);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    writeEventsJsonl(dirPath, run.events);

    appendToIndex({
      id: run.id,
      goal: run.goal,
      repoName: run.repoName,
      startedAt: run.startedAt.toISOString(),
      status: 'in_progress',
    });
  } catch (err) {
    console.error('[checkpoint] Failed to save run:', (err as Error).message);
  }
}

/** Save a completed run to disk using tiered directory structure. */
export function persistRun(record: RunRecord): void {
  // Guard: never persist the meta 'all' goal — only individual goal children
  if (record.goal === 'all') return;

  try {
    ensureOutputDir();
    const dirPath = runDirPath(record.id);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    // Tier 2: envelope (scorecard, metrics, brief, finding summaries)
    if (record.result) {
      writeEnvelope(dirPath, record);
    }

    // Tier 3: events + full findings + source files
    writeEventsJsonl(dirPath, record.events);
    writeFindings(dirPath, record.result?.state?.findings ?? []);
    if (record.result?.sources && Object.keys(record.result.sources).length > 0) {
      writeSources(dirPath, record.result.sources);
    }

    // Tier 1: update index
    const findings = (record.result?.state?.findings ?? []) as unknown[];
    appendToIndex({
      id: record.id,
      goal: record.goal,
      repoName: record.repoName,
      overallScore: record.result?.scorecard?.overallScore,
      startedAt: record.startedAt instanceof Date ? record.startedAt.toISOString() : String(record.startedAt),
      completedAt: record.completedAt instanceof Date ? record.completedAt.toISOString() : record.completedAt ? String(record.completedAt) : undefined,
      findingsCount: findings.length,
      status: 'completed',
      repoPath: record.repoPath,
      repoSource: record.repoSource,
      repoUrl: record.repoUrl,
      ...(record.parentRunId ? { parentRunId: record.parentRunId } : {}),
    });

    // Clean up legacy flat file if it exists
    try {
      const legacyPath = path.join(OUTPUT_DIR, runFilename(record));
      if (fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    } catch { /* ignore */ }
  } catch (err) {
    console.error('[persist] Failed to save run:', (err as Error).message);
  }
}

// ── Migration from flat files ─────────────────────────────────

function migrateFromFlatFiles(): void {
  let files: string[];
  try {
    files = fs.readdirSync(OUTPUT_DIR)
      .filter(f => f.endsWith('.json') && f !== 'index.json')
      .sort()
      .reverse();
  } catch { return; }

  if (files.length === 0) return;

  console.log(`[migration] Migrating ${files.length} legacy run file(s) to tiered storage...`);

  const entries: RunIndexEntry[] = [];

  for (const f of files) {
    const filePath = path.join(OUTPUT_DIR, f);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const id = raw.id ?? crypto.randomUUID();
      const dirPath = runDirPath(id);
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

      const events: StepEvent[] = raw.events ?? [];
      writeEventsJsonl(dirPath, events);

      if (raw.result) {
        // Build a temporary RunRecord to reuse writeEnvelope
        const tempRecord: RunRecord = {
          id,
          goal: raw.goal,
          repoName: raw.repoName,
          startedAt: new Date(raw.startedAt),
          completedAt: raw.completedAt ? new Date(raw.completedAt) : undefined,
          result: raw.result,
          events: [],
        };
        writeEnvelope(dirPath, tempRecord);
        writeFindings(dirPath, raw.result.state?.findings ?? []);

        entries.push({
          id,
          goal: raw.goal,
          repoName: raw.repoName,
          overallScore: raw.result.scorecard?.overallScore,
          startedAt: raw.startedAt,
          completedAt: raw.completedAt,
          findingsCount: (raw.result.state?.findings ?? []).length,
          status: 'completed',
        });
      } else {
        entries.push({
          id,
          goal: raw.goal,
          repoName: raw.repoName,
          startedAt: raw.startedAt,
          status: 'in_progress',
        });
      }

      // Move legacy file to _migrated/
      const migratedDir = path.join(OUTPUT_DIR, '_migrated');
      if (!fs.existsSync(migratedDir)) fs.mkdirSync(migratedDir, { recursive: true });
      fs.renameSync(filePath, path.join(migratedDir, f));
    } catch (err) {
      console.warn(`[migration] Skipping corrupt file ${f}:`, (err as Error).message);
    }
  }

  if (entries.length > 0) {
    writeIndex(entries);
    console.log(`[migration] Migrated ${entries.length} run(s). Legacy files moved to _migrated/.`);
  }
}

// ── Load functions (tiered) ───────────────────────────────────

/** Load saved runs from disk, newest first. Reads only the index (Tier 1). */
export function loadPersistedRuns(opts?: { limit?: number; offset?: number }): RunRecord[] {
  try {
    ensureOutputDir();
  } catch (err) {
    console.warn('[loadPersistedRuns] Cannot create output dir:', (err as Error).message);
    return [];
  }

  // If no index exists, migrate from legacy flat files
  if (!fs.existsSync(INDEX_FILE)) {
    migrateFromFlatFiles();
  }

  let entries = readIndex();

  // Pagination
  const offset = opts?.offset ?? 0;
  const limit = opts?.limit ?? entries.length;
  if (offset > 0 || limit < entries.length) {
    entries = entries.slice(offset, offset + limit);
  }

  return entries.map(e => ({
    id: e.id,
    goal: e.goal,
    repoName: e.repoName,
    startedAt: new Date(e.startedAt),
    completedAt: e.completedAt ? new Date(e.completedAt) : undefined,
    overallScore: e.overallScore,
    findingsCount: e.findingsCount,
    events: [],
    repoPath: e.repoPath,
    repoSource: e.repoSource,
    repoUrl: e.repoUrl,
    parentRunId: e.parentRunId,
    _dirPath: runDirPath(e.id),
  }));
}

/** Get total number of runs in the index (for pagination). */
export function getRunCount(): number {
  return readIndex().length;
}

/** Look up a single run by ID from the disk index (bypasses in-memory session). */
export function findRunById(id: string): RunRecord | null {
  const entries = readIndex();
  const entry = entries.find(e => e.id === id);
  if (!entry) return null;
  return {
    id: entry.id,
    goal: entry.goal,
    repoName: entry.repoName,
    startedAt: new Date(entry.startedAt),
    completedAt: entry.completedAt ? new Date(entry.completedAt) : undefined,
    overallScore: entry.overallScore,
    findingsCount: entry.findingsCount,
    events: [],
    repoPath: entry.repoPath,
    repoSource: entry.repoSource,
    repoUrl: entry.repoUrl,
    parentRunId: entry.parentRunId,
    _dirPath: runDirPath(entry.id),
  };
}

/** Load the envelope (Tier 2) for a specific run from disk. */
export function loadRunEnvelope(record: RunRecord): RunEnvelope | null {
  const dirPath = record._dirPath;
  if (!dirPath) return null;
  const envPath = path.join(dirPath, 'envelope.json');
  try {
    if (!fs.existsSync(envPath)) return null;
    return JSON.parse(fs.readFileSync(envPath, 'utf-8'));
  } catch (err) {
    console.warn(`[loadRunEnvelope] Failed for run ${record.id}:`, (err as Error).message);
    return null;
  }
}

/** Load full findings (Tier 3) for a specific run from disk. */
export function loadRunFindings(record: RunRecord): unknown[] {
  const dirPath = record._dirPath;
  if (!dirPath) return [];
  const findingsPath = path.join(dirPath, 'findings.json');
  try {
    if (!fs.existsSync(findingsPath)) return [];
    return JSON.parse(fs.readFileSync(findingsPath, 'utf-8'));
  } catch (err) {
    console.warn(`[loadRunFindings] Failed for run ${record.id}:`, (err as Error).message);
    return [];
  }
}

/** Load source files (Tier 3) for a specific run. Returns null for old runs without sources. */
export function loadRunSources(record: RunRecord): Record<string, SourceFile> | null {
  const dirPath = record._dirPath;
  if (!dirPath) return null;
  const sourcesPath = path.join(dirPath, 'sources.json');
  try {
    if (!fs.existsSync(sourcesPath)) return null;
    return JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
  } catch (err) {
    console.warn(`[loadRunSources] Failed for run ${record.id}:`, (err as Error).message);
    return null;
  }
}

/** Load events (Tier 3) for a specific run. */
export function loadRunEvents(record: RunRecord): StepEvent[] {
  // If events are already populated (current run, not from disk), return them
  if (record.events.length > 0) return record.events;

  // Tier 3: load from events.jsonl in run directory
  if (record._dirPath) {
    const eventsPath = path.join(record._dirPath, 'events.jsonl');
    try {
      if (fs.existsSync(eventsPath)) {
        const content = fs.readFileSync(eventsPath, 'utf-8').trim();
        if (!content) return [];
        return content.split('\n').map(line => JSON.parse(line));
      }
    } catch (err) {
      console.warn(`[loadRunEvents] Failed to load events.jsonl for run ${record.id}:`, (err as Error).message);
    }
  }

  // Legacy fallback: load from flat file
  if (record._filePath) {
    try {
      const raw = JSON.parse(fs.readFileSync(record._filePath, 'utf-8'));
      return raw.events ?? [];
    } catch (err) {
      console.warn(`[loadRunEvents] Failed to load legacy events for run ${record.id}:`, (err as Error).message);
    }
  }

  return [];
}

// ── HistoryItem conversion ───────────────────────────────────

/** Convert a RunRecord to a HistoryItem for sidebar display. */
export function toHistoryItem(r: RunRecord): HistoryItem {
  return {
    id: r.id,
    goal: r.goal,
    repoName: r.repoName,
    startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt),
    completedAt: r.completedAt instanceof Date ? r.completedAt.toISOString() : r.completedAt ? String(r.completedAt) : undefined,
    hasResult: !!r.result,
    findingsCount: r.findingsCount ?? r.result?.state?.findings?.length,
    score: r.overallScore ?? r.result?.scorecard?.overallScore ?? null,
    repoPath: r.repoPath,
    repoSource: r.repoSource,
    repoUrl: r.repoUrl,
    parentRunId: r.parentRunId,
  };
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
  const history = loadPersistedRuns();
  globalThis.__agentSession = {
    status: 'idle',
    currentRun: null,
    history,
    result: null,
  };
}
