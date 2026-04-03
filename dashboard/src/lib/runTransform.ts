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
}

export interface Finding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  category: string;
  title: string;
  evidenceFiles: string[];
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
  // 1. Group events into analysis turns (pre-switch) by reasoning changes
  const turns: AnalysisTurn[] = [];
  let currentReasoning = '';
  let currentActivities: Activity[] = [];
  let currentCategories = new Set<string>();
  let switchSeen = false;
  let turnStartTime: number | null = null;
  let lastTimestamp: number | null = null;

  for (const ev of events) {
    const ts = ev.timestamp ? new Date(ev.timestamp).getTime() : null;

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
      switchSeen = true;
      currentReasoning = '';
      currentActivities = [];
      currentCategories = new Set();
      continue;
    }

    // Skip post-switch events (findings, assembly) — handled separately
    if (switchSeen) continue;

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
      let files: string[] = [];
      let detail = '';
      try {
        const args = ev.args ? JSON.parse(ev.args) : {};
        if (args.path) files = [args.path];
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

  // Flush last pre-switch turn if any
  if (currentReasoning && currentActivities.length > 0 && !switchSeen) {
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
    description?: string; evidence?: Array<{ filePath: string }>;
    investigationNote?: string; tags?: string[];
  }>;

  const findings: Finding[] = rawFindings.map(f => ({
    id: f.id,
    severity: f.severity as Finding['severity'],
    category: f.category,
    title: f.title,
    evidenceFiles: (f.evidence ?? []).map(e => e.filePath),
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
