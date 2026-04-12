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
}

export interface StreamTurn {
  reasoning: string;
  activities: Activity[];
  phase: 'analyze' | 'write';
  isSwitch?: boolean;
}

export interface AnalysisTurn {
  reasoning: string;
  activities: Activity[];
  categoriesCovered: string[];
  duration: number;
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

// ─── Transformer ────────────────────────────────────────────────

export function transformRunData(
  events: StepEvent[],
  result: RunResult,
): TransformedRunData {
  // 1. Group events into analysis turns by reasoning changes.
  //    Multi-goal runs have multiple switch_to_fast_model events (one per pass)
  //    and pass_boundary markers between passes. We treat switch events as
  //    turn delimiters but continue processing (no bail-after-first-switch).
  //    Post-switch "writing" events (record_finding, assemble_output) are
  //    skipped since findings are already in the result object.
  const turns: AnalysisTurn[] = [];
  let currentReasoning = '';
  let currentActivities: Activity[] = [];
  let currentCategories = new Set<string>();
  let inWritingPhase = false;
  let turnStartTime: number | null = null;
  let lastTimestamp: number | null = null;

  const WRITING_ACTIONS = new Set(['record_finding', 'assemble_output']);

  for (const ev of events) {
    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null;

    // Pass boundary: synthetic event injected between multi-goal passes
    if (ev.action === 'pass_boundary') {
      // Flush current turn
      if (currentReasoning && currentActivities.length > 0) {
        turns.push({
          reasoning: currentReasoning,
          activities: currentActivities,
          categoriesCovered: [...currentCategories],
          duration: turnStartTime && lastTimestamp ? lastTimestamp - turnStartTime : 2000,
        });
      }
      // Add a visual pass separator
      const passName = ev.result ?? 'Next pass';
      turns.push({
        reasoning: `Starting ${passName} investigation pass.`,
        activities: [{ label: 'pass_boundary', files: [], detail: passName }],
        categoriesCovered: [],
        duration: 500,
      });
      currentReasoning = '';
      currentActivities = [];
      currentCategories = new Set();
      inWritingPhase = false; // new pass = back to investigation
      continue;
    }

    if (ev.action === 'switch_to_fast_model') {
      // Flush current turn
      if (currentReasoning && currentActivities.length > 0) {
        turns.push({
          reasoning: currentReasoning,
          activities: currentActivities,
          categoriesCovered: [...currentCategories],
          duration: turnStartTime && lastTimestamp ? lastTimestamp - turnStartTime : 2000,
        });
      }
      // Add the switch turn
      turns.push({
        reasoning: 'Analysis complete. Switching to fast model for writing.',
        activities: [{ label: 'switch_to_fast_model', files: [], detail: `${ev.step} tool calls used` }],
        categoriesCovered: [],
        duration: 1200,
      });
      inWritingPhase = true;
      currentReasoning = '';
      currentActivities = [];
      currentCategories = new Set();
      continue;
    }

    // Skip writing-phase events (findings/assembly handled via result object)
    if (inWritingPhase && WRITING_ACTIONS.has(ev.action)) continue;

    if (ev.type === 'text_response' && ev.reasoning && ev.reasoning !== currentReasoning) {
      // New reasoning = new turn. Flush previous.
      if (currentReasoning && currentActivities.length > 0) {
        turns.push({
          reasoning: currentReasoning,
          activities: currentActivities,
          categoriesCovered: [...currentCategories],
          duration: turnStartTime && lastTimestamp ? lastTimestamp - turnStartTime : 2000,
        });
      }
      currentReasoning = ev.reasoning;
      currentActivities = [];
      currentCategories = new Set();
      turnStartTime = ts;
    }

    if (ev.type === 'tool_call' && ev.action !== 'reasoning') {
      // Parse args to extract file paths
      // Only treat args.path as a file for tools that actually read files;
      // tools like list_directory, grep_pattern, find_files use path for directories.
      const DIR_TOOLS = new Set(['list_directory', 'grep_pattern', 'find_files', 'analyze_route_structure', 'analyze_component_directives', 'analyze_middleware', 'analyze_env_usage']);
      let files: string[] = [];
      let detail = '';
      try {
        const args = ev.args ? JSON.parse(ev.args) : {};
        if (args.path && !DIR_TOOLS.has(ev.action)) files = [args.path];
        if (args.paths) files = args.paths;
        if (args.filePath) files = [args.filePath];
        if (args.pattern) detail = args.pattern;
        if (args.packages) detail = Object.keys(args.packages).join(', ');
      } catch { /* args not JSON */ }

      // Deduplicate: if same action already in this turn, merge
      const existing = currentActivities.find(a => a.label === ev.action);
      if (existing) {
        existing.files.push(...files);
      } else {
        currentActivities.push({ label: ev.action, files, detail });
      }

      // Infer categories from action name
      const hints = ACTION_CATEGORY_HINTS[ev.action];
      if (hints) hints.forEach(c => currentCategories.add(c));
    }

    if (ts) lastTimestamp = ts;
  }

  // Flush last turn if any
  if (currentReasoning && currentActivities.length > 0) {
    turns.push({
      reasoning: currentReasoning,
      activities: currentActivities,
      categoriesCovered: [...currentCategories],
      duration: turnStartTime && lastTimestamp ? lastTimestamp - turnStartTime : 2000,
    });
  }

  // 2. Transform findings
  const rawFindings = (result.state?.findings ?? []) as Array<{
    id: string; severity: string; category: string; title: string;
    description?: string; evidence?: Array<{
      filePath: string; lineNumber?: number; snippet?: string;
      description?: string; verificationStatus?: string;
      sourceContext?: string; originalSnippet?: string;
    }>;
    investigationNote?: string; tags?: string[];
  }>;

  const findings: Finding[] = rawFindings.map(f => ({
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
  }));

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

  // Ensure categories are distributed across turns
  // Fill in uncovered categories from findings
  const allCoveredByTurns = new Set(turns.flatMap(t => t.categoriesCovered));
  const findingCategories = [...new Set(findings.map(f => f.category))];
  const uncovered = findingCategories.filter(c => !allCoveredByTurns.has(c));
  // Spread uncovered categories across analysis turns
  const invTurns = turns.filter(t => !t.activities.some(a => a.label === 'switch_to_fast_model'));
  uncovered.forEach((cat, i) => {
    const turn = invTurns[i % invTurns.length];
    if (turn) turn.categoriesCovered.push(cat);
  });

  return {
    analysisTurns: turns,
    findings,
    findingBatches: batchSizes.length > 0 ? batchSizes : [findings.length],
  };
}
