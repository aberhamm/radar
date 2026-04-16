import type { HistoryItem } from '@/lib/agentSession';

// ─── Types for grouped history ──────────────────────────────────

export type ScoreLevel = 'red' | 'yellow' | 'green';

export interface MultiGoalGroup {
  type: 'multigoal';
  parentId: string;
  item: HistoryItem;
  children: HistoryItem[];
  worstScore?: ScoreLevel | null;
}

export interface SingleRun {
  type: 'single';
  item: HistoryItem;
}

export type RunEntry = MultiGoalGroup | SingleRun;

export interface RepoGroup {
  repoName: string;
  latestStartedAt: string;
  runs: RunEntry[];
  worstScore?: ScoreLevel | null;
}

const SCORE_ORDER: Record<string, number> = { red: 3, yellow: 2, green: 1 };

export function worstOf(a: ScoreLevel | null | undefined, b: ScoreLevel | null | undefined): ScoreLevel | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return (SCORE_ORDER[b] ?? 0) > (SCORE_ORDER[a] ?? 0) ? b : a;
}

/** Group history items by repo, then by parentRunId within each repo. */
export function groupByRepo(items: HistoryItem[]): RepoGroup[] {
  // Separate sample runs (not grouped by repo)
  const sampleItems: HistoryItem[] = [];
  const realItems: HistoryItem[] = [];
  for (const item of items) {
    if (item.id === '__sample__') sampleItems.push(item);
    else realItems.push(item);
  }

  // Step 1: group by parentRunId (multi-goal groups)
  const multiGoalGroups = new Map<string, HistoryItem[]>();
  const ungrouped: HistoryItem[] = [];

  for (const item of realItems) {
    if (item.parentRunId) {
      const existing = multiGoalGroups.get(item.parentRunId) ?? [];
      existing.push(item);
      multiGoalGroups.set(item.parentRunId, existing);
    } else {
      ungrouped.push(item);
    }
  }

  // Step 2: build RunEntry list
  const entries: RunEntry[] = [];

  for (const item of ungrouped) {
    // Check if this item IS a multi-goal parent (other items reference its id)
    const isGroupParent = realItems.some(h => h.parentRunId === item.id);
    if (isGroupParent) continue; // children will form the group
    // Skip stale 'all' checkpoint entries — the real data lives in the multi-goal group
    if (item.goal === 'all') continue;
    entries.push({ type: 'single', item });
  }

  for (const [parentId, children] of multiGoalGroups) {
    const ws = children.reduce<ScoreLevel | null>((worst, c) => worstOf(worst, c.score as ScoreLevel | null), null);
    const rep = children[0];
    entries.push({
      type: 'multigoal',
      parentId,
      item: { ...rep, id: parentId, goal: 'all' },
      children,
      worstScore: ws,
    });
  }

  // Step 3: group by repoName
  const repoMap = new Map<string, RunEntry[]>();
  for (const entry of entries) {
    const name = entry.item.repoName;
    const existing = repoMap.get(name) ?? [];
    existing.push(entry);
    repoMap.set(name, existing);
  }

  // Step 4: build RepoGroup array, sorted by most recent first
  const repoGroups: RepoGroup[] = [];
  for (const [repoName, runs] of repoMap) {
    // Sort runs within each repo by most recent first
    runs.sort((a, b) => b.item.startedAt.localeCompare(a.item.startedAt));

    const latest = runs.reduce((max, r) => {
      const t = r.item.startedAt;
      return t > max ? t : max;
    }, '');
    const ws = runs.reduce<ScoreLevel | null>((worst, r) => {
      if (r.type === 'multigoal') return worstOf(worst, r.worstScore);
      return worstOf(worst, r.item.score as ScoreLevel | null);
    }, null);
    repoGroups.push({ repoName, latestStartedAt: latest, runs, worstScore: ws });
  }

  repoGroups.sort((a, b) => b.latestStartedAt.localeCompare(a.latestStartedAt));

  // Add sample runs as a special "group" at the end
  if (sampleItems.length > 0) {
    repoGroups.push({
      repoName: sampleItems[0].repoName,
      latestStartedAt: sampleItems[0].startedAt,
      runs: sampleItems.map(item => ({ type: 'single' as const, item })),
      worstScore: null,
    });
  }

  return repoGroups;
}
