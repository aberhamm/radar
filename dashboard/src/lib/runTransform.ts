import type { StepEvent, RunResult } from '@/lib/agentSession';

// ─── Constants ──────────────────────────────────────────────────

export const CATEGORIES = [
  { id: 'stack', label: 'Stack' },
  { id: 'dependencies', label: 'Dependencies' },
  { id: 'cms-integration', label: 'CMS Integration' },
  { id: 'preview-editing', label: 'Preview & Editing' },
  { id: 'security', label: 'Security' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'routing', label: 'Routing' },
  { id: 'data-fetching', label: 'Data Fetching' },
  { id: 'deployment', label: 'Deployment' },
  { id: 'nextjs', label: 'Next.js' },
] as const;

// ─── Types ──────────────────────────────────────────────────────

export interface Activity {
  label: string;
  files: string[];
  detail?: string;
  /** True while tool is executing (tool_start received, tool_call not yet) */
  pending?: boolean;
}

export interface EvidenceItem {
  filePath: string;
  lineNumber?: number;
  snippet: string;
  description: string;
  verificationStatus?: 'verified' | 'corrected' | 'unverifiable';
  sourceContext?: string;
  originalSnippet?: string;
}

export interface Finding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  evidenceFiles: string[];
  evidence: EvidenceItem[];
  note: string;
  tags: string[];
  /** SHA-256 fingerprint for cross-run tracking and GitHub issue dedup. */
  fingerprint?: string;
  /** Confidence 1-10 from agent investigation. */
  confidence?: number;
}

export interface StreamTurn {
  reasoning: string;
  activities: Activity[];
  phase: 'analyze' | 'write';
  isSwitch?: boolean;
  isPassBoundary?: boolean;
  passName?: string;
}

export interface AnalysisTurn {
  reasoning: string;
  activities: Activity[];
  categoriesCovered: string[];
  duration: number;
  isSwitch?: boolean;
  isPassBoundary?: boolean;
  passName?: string;
}

export interface TransformedRunData {
  analysisTurns: AnalysisTurn[];
  findings: Finding[];
  /** Finding batch sizes for replay timing, e.g. [4, 5, 4] */
  findingBatches: number[];
}

// ─── Constants ──────────────────────────────────────────────────

/** Map tool actions to the categories they likely cover */
export const ACTION_CATEGORY_HINTS: Record<string, string[]> = {
  parse_package_json: ['stack', 'dependencies'],
  query_npm_versions: ['dependencies'],
  compare_versions: ['dependencies'],
  analyze_middleware: ['security', 'routing'],
  analyze_env_usage: ['configuration', 'security'],
  parse_env_file: ['configuration'],
  analyze_route_structure: ['routing'],
  analyze_component_directives: ['architecture'],
  check_gitignore: ['security'],
  parse_next_config: ['configuration', 'nextjs'],
  parse_tsconfig: ['configuration'],
  fetch_url: ['dependencies'],
};

// ─── Helpers ────────────────────────────────────────────────────

export function sevColor(sev: string): string {
  switch (sev) {
    case 'critical': return 'var(--color-danger)';
    case 'high': return 'var(--color-danger)';
    case 'medium': return 'var(--color-warning)';
    case 'low': return 'var(--color-success)';
    default: return 'var(--color-tertiary-label)';
  }
}

export function sevBg(sev: string): string {
  switch (sev) {
    case 'critical': return 'rgba(255,59,48,0.08)';
    case 'high': return 'rgba(255,59,48,0.06)';
    case 'medium': return 'rgba(255,149,0,0.06)';
    case 'low': return 'rgba(52,199,89,0.06)';
    default: return 'rgba(142,142,147,0.06)';
  }
}

// ─── Finding Normalizer ─────────────────────────────────────────

/** Normalize raw finding objects (from API/storage) into typed Finding[] */
export function normalizeFindings(raw: unknown[]): Finding[] {
  const arr = raw as Array<{
    id: string; severity: string; category: string; title: string;
    description?: string; evidence?: Array<{
      filePath: string; lineNumber?: number; snippet?: string;
      description?: string; verificationStatus?: string;
      sourceContext?: string; originalSnippet?: string;
    }>;
    investigationNote?: string; tags?: string[];
    fingerprint?: string; confidence?: number;
  }>;
  return arr.map(f => ({
    id: f.id,
    severity: f.severity as Finding['severity'],
    category: f.category,
    title: f.title,
    evidenceFiles: (f.evidence ?? []).map(e => e.filePath),
    evidence: (f.evidence ?? []).map(e => ({
      filePath: e.filePath,
      lineNumber: e.lineNumber,
      snippet: e.snippet ?? '',
      description: e.description ?? '',
      verificationStatus: e.verificationStatus as EvidenceItem['verificationStatus'],
      sourceContext: e.sourceContext,
      originalSnippet: e.originalSnippet,
    })),
    note: f.investigationNote ?? f.description ?? '',
    tags: f.tags ?? [],
    fingerprint: f.fingerprint,
    confidence: f.confidence,
  }));
}

// ─── Transformer ────────────────────────────────────────────────

/** Auto-flush investigation turns after this many tool calls. */
const TOOL_CALLS_PER_TURN = 8;

const DIR_TOOLS = new Set([
  'list_directory', 'grep_pattern', 'find_files',
  'analyze_route_structure', 'analyze_component_directives',
  'analyze_middleware', 'analyze_env_usage',
]);

/** Infrastructure tools that don't produce visible investigation turns. */
const INFRA_TOOLS = new Set([
  'detect_app_roots', 'detect_scope_drift', 'get_specialist_prompts',
]);

/** Patterns that look like bare file paths (no surrounding sentence). */
const FILE_PATH_RE = /^[a-zA-Z0-9_./@-]+\/[a-zA-Z0-9_./@[\]()-]+$/;

/** Hollow narration sentences to strip — applied per-sentence via split. */
const HOLLOW_TESTS: RegExp[] = [
  /^(?:now )?(?:let me|let's) (?:now )?(?:examine|check|look|explore|investigate|continue|also|try|move|conduct)\b/i,
  /^I'll (?:now )?(?:check|examine|look|explore|investigate|continue|also|conduct)\b/i,
  /^(?:the file|it) (?:appears|seems)\b.*(?:empty|unchanged|not returning)/i,
  /^(?:let me try|trying) a different approach/i,
  // "This is a critical finding." without explaining WHAT — no "because/since/:" clause
  /^this is (?:a )?(?:critical|important|significant|notable|interesting|key)\b[^.]*(?:finding|issue|observation|discovery)\s*\.?$/i,
];

/**
 * Clean agent reasoning: strip file-path dumps and hollow narration.
 * Returns empty string if nothing substantive remains.
 */
function cleanReasoning(raw: string): string {
  const lines = raw.split('\n');
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Drop bare file paths (agent dumping tool args into reasoning)
    if (FILE_PATH_RE.test(trimmed)) continue;
    // Drop concatenated path blobs (no spaces, over 40 chars)
    if (/^[a-zA-Z0-9_./@[\]()-]+$/.test(trimmed) && trimmed.length > 40) continue;
    // Drop raw grep patterns (pipe-separated identifiers, no spaces)
    if (/^[a-zA-Z0-9_.*@"[\]()-]+(\|[a-zA-Z0-9_.*@"[\]()-]+){2,}$/.test(trimmed)) continue;
    kept.push(line);
  }

  // Split into sentences, drop hollow ones
  const text = kept.join('\n').trim();
  const sentences = text.split(/(?<=[.!?:])\s+/);
  const substantive = sentences.filter(s => {
    const t = s.trim();
    if (!t) return false;
    return !HOLLOW_TESTS.some(re => re.test(t));
  });

  return substantive.join(' ').trim();
}

/** Parse a tool_call event into an Activity. Does NOT merge with previous. */
function parseToolActivity(ev: StepEvent): { activity: Activity; categories: string[] } {
  let files: string[] = [];
  let detail = '';
  try {
    const args = ev.args ? JSON.parse(ev.args) : {};
    if (args.path && !DIR_TOOLS.has(ev.action)) files = [args.path];
    else if (args.path) detail = args.path;
    if (args.paths) files = args.paths;
    if (args.filePath) files = [args.filePath];
    if (args.pattern) detail = args.pattern;
    if (args.packages) detail = Object.keys(args.packages).join(', ');
  } catch { /* args not JSON */ }

  const categories = ACTION_CATEGORY_HINTS[ev.action] ?? [];
  return {
    activity: { label: ev.action, files, detail },
    categories,
  };
}

export function transformRunData(
  events: StepEvent[],
  result: RunResult,
): TransformedRunData {
  // Group events into analysis turns. Multi-goal runs have multiple passes
  // separated by switch_to_fast_model and pass_boundary events.
  //
  // Key design: tool calls auto-flush every TOOL_CALLS_PER_TURN calls so that
  // even passes with no intermediate reasoning (agent gives 1 sentence then
  // runs 50 tools) produce granular, visible turns.
  const turns: AnalysisTurn[] = [];
  let currentReasoning = '';
  let currentActivities: Activity[] = [];
  let currentCategories = new Set<string>();
  let inWritingPhase = false;
  let turnStartTime: number | null = null;
  let lastTimestamp: number | null = null;
  let currentPassName = 'Core Investigation';
  let toolCallCount = 0; // tool calls in current sub-turn

  const WRITING_ACTIONS = new Set(['record_finding', 'assemble_output']);

  /** Flush accumulated activities into a turn.
   *  Reasoning is cleaned to strip file-path dumps and hollow narration.
   *  If nothing substantive remains, the turn gets empty reasoning —
   *  the activity chips already show what tools ran. */
  function flush(reasoning: string, duration?: number) {
    const cleaned = cleanReasoning(reasoning);
    if (currentActivities.length === 0 && !cleaned) return;
    turns.push({
      reasoning: cleaned,
      activities: currentActivities,
      categoriesCovered: [...currentCategories],
      duration: duration ?? (turnStartTime && lastTimestamp ? lastTimestamp - turnStartTime : 1000),
      passName: currentPassName,
    });
    currentActivities = [];
    currentCategories = new Set();
    toolCallCount = 0;
    turnStartTime = lastTimestamp;
  }

  for (const ev of events) {
    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null;

    // Budget plan / rebalance: skip — infrastructure, not investigation
    if (ev.action === 'budget_plan' || ev.action === 'budget_rebalance') continue;

    // Pass boundary: synthetic event injected between multi-goal passes
    if (ev.action === 'pass_boundary') {
      if (currentActivities.length > 0) flush(currentReasoning);
      currentReasoning = '';
      const passName = (ev.result as string) ?? 'Next pass';
      currentPassName = passName;
      turns.push({
        reasoning: `Starting ${passName} investigation pass.`,
        activities: [{ label: 'pass_boundary', files: [], detail: passName }],
        categoriesCovered: [],
        duration: 500,
        isPassBoundary: true,
        passName,
      });
      inWritingPhase = false;
      continue;
    }

    // Deduplicate: only process the tool_call event, not tool_start
    if (ev.action === 'switch_to_fast_model' && ev.type !== 'tool_call') continue;

    if (ev.action === 'switch_to_fast_model') {
      if (currentActivities.length > 0) flush(currentReasoning);
      currentReasoning = '';
      turns.push({
        reasoning: 'Analysis complete. Switching to fast model for writing.',
        activities: [{ label: 'switch_to_fast_model', files: [], detail: `${ev.step} tool calls used` }],
        categoriesCovered: [],
        duration: 1200,
        isSwitch: true,
        passName: currentPassName,
      });
      inWritingPhase = true;
      continue;
    }

    // Skip writing-phase tool calls (record_finding, assemble_output) — the
    // animation hook provides its own recording/assembling narrative.
    // text_response events are NOT skipped: in multi-pass runs without
    // pass_boundary events, the second pass's investigation reasoning arrives
    // while inWritingPhase is still true and must be preserved.
    if (inWritingPhase && WRITING_ACTIONS.has(ev.action)) continue;

    if (ev.type === 'text_response') {
      const reasoning = ev.fullReasoning || ev.reasoning;
      if (reasoning && reasoning !== currentReasoning) {
        // New reasoning = new turn. Flush accumulated tool calls.
        if (currentActivities.length > 0) flush(currentReasoning);
        currentReasoning = reasoning;
        turnStartTime = ts;
      }
    }

    if (ev.type === 'tool_call' && ev.action !== 'reasoning') {
      // Skip infrastructure tools — pre-compute setup, not real investigation
      if (INFRA_TOOLS.has(ev.action)) continue;

      const { activity, categories } = parseToolActivity(ev);
      // Merge same-action activities within a turn (e.g. 3x read_file → 1 chip with all files)
      const existing = currentActivities.find(a => a.label === activity.label);
      if (existing) {
        existing.files = [...existing.files, ...activity.files];
        if (activity.detail && !existing.detail) existing.detail = activity.detail;
      } else {
        currentActivities.push(activity);
      }
      categories.forEach(c => currentCategories.add(c));
      toolCallCount++;

      // Auto-flush: create a turn every N tool calls so the replay is granular.
      // The first flush in a pass uses the agent's reasoning text; subsequent
      // flushes get a description built from the tool calls.
      if (toolCallCount >= TOOL_CALLS_PER_TURN) {
        flush(currentReasoning);
        currentReasoning = ''; // subsequent sub-turns use auto-generated description
      }
    }

    if (ts) lastTimestamp = ts;
  }

  // Flush remaining
  if (currentActivities.length > 0) {
    flush(currentReasoning);
  }

  // 2. Transform findings
  const findings = normalizeFindings((result.state?.findings ?? []) as unknown[]);

  // 3. Compute finding batches from batchId groupings in events
  const findingEvents = events.filter(e => e.action === 'record_finding');
  const batchGroups: string[] = [];
  const batchSizes: number[] = [];
  for (const fe of findingEvents) {
    const bid = fe.batchId ?? 'unknown';
    if (batchGroups[batchGroups.length - 1] !== bid) {
      batchGroups.push(bid);
      batchSizes.push(1);
    } else {
      batchSizes[batchSizes.length - 1]++;
    }
  }

  // 4. Ensure categories are distributed across turns
  const allCoveredByTurns = new Set(turns.flatMap(t => t.categoriesCovered));
  const findingCategories = [...new Set(findings.map(f => f.category))];
  const uncovered = findingCategories.filter(c => !allCoveredByTurns.has(c));
  const regularTurns = turns.filter(t => !t.isSwitch && !t.isPassBoundary);
  uncovered.forEach((cat, i) => {
    const turn = regularTurns[i % regularTurns.length];
    if (turn) turn.categoriesCovered.push(cat);
  });

  return {
    analysisTurns: turns,
    findings,
    findingBatches: batchSizes.length > 0 ? batchSizes : [findings.length],
  };
}

// ─── Instant State Builder ─────────────────────────────────────

/** Build a fully-populated state from run data — no animation, everything visible at once. */
export function buildInstantState(data: TransformedRunData): {
  phase: 'done';
  turns: StreamTurn[];
  typingText: string;
  activeTurnIndex: null;
  coveredTopics: Set<string>;
  examinedFiles: string[];
  findings: Finding[];
  scoreVisible: boolean;
  progressPercent: number;
  pendingActions: string[];
  statusMessage: string;
} {
  const turns: StreamTurn[] = data.analysisTurns.map(t => ({
    reasoning: t.reasoning,
    activities: t.activities,
    phase: (t.isSwitch || t.isPassBoundary) ? 'analyze' as const : 'analyze' as const,
    isSwitch: t.isSwitch,
    isPassBoundary: t.isPassBoundary,
    passName: t.passName,
  }));

  const coveredTopics = new Set<string>();
  const examinedFiles: string[] = [];
  for (const t of data.analysisTurns) {
    for (const cat of t.categoriesCovered) coveredTopics.add(cat);
    for (const a of t.activities) {
      for (const f of a.files) {
        if (f && f !== '.' && !examinedFiles.includes(f)) examinedFiles.push(f);
      }
    }
  }

  return {
    phase: 'done',
    turns,
    typingText: '',
    activeTurnIndex: null,
    coveredTopics,
    examinedFiles,
    findings: data.findings,
    scoreVisible: true,
    progressPercent: 100,
    pendingActions: [],
    statusMessage: '',
  };
}
