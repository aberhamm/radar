'use client';

import { useMemo } from 'react';
import type { HistoryItem } from '@/lib/agentSession';

const GOAL_LABELS: Record<string, string> = {
  onboarding: 'Onboarding',
  audit: 'Audit',
  'audit-generic': 'Generic Audit',
  migration: 'Migration',
  'component-map': 'Components',
  'ci-check': 'CI Check',
  'security-review': 'Security',
  nextjs: 'Next.js',
  accessibility: 'Accessibility',
};

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function duration(startedAt: string, completedAt?: string): string {
  if (!completedAt) return '';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

interface GroupedRun {
  kind: 'single' | 'multi';
  id: string;
  repoName: string;
  goals: string[];
  startedAt: string;
  completedAt?: string;
  score?: 'red' | 'yellow' | 'green' | null;
  findingsCount?: number;
  children?: HistoryItem[];
}

function groupHistory(history: HistoryItem[]): GroupedRun[] {
  const groups: GroupedRun[] = [];
  const childrenByParent = new Map<string, HistoryItem[]>();
  const parentIds = new Set<string>();

  for (const h of history) {
    if (h.parentRunId) {
      parentIds.add(h.parentRunId);
      const children = childrenByParent.get(h.parentRunId) ?? [];
      children.push(h);
      childrenByParent.set(h.parentRunId, children);
    }
  }

  const seen = new Set<string>();
  for (const h of history) {
    if (seen.has(h.id)) continue;

    if (parentIds.has(h.id) || childrenByParent.has(h.id)) {
      const parentId = h.parentRunId ?? h.id;
      if (seen.has(parentId)) continue;
      seen.add(parentId);

      const children = childrenByParent.get(parentId) ?? [];
      const worstScore = children.reduce<'red' | 'yellow' | 'green' | null>((worst, c) => {
        if (!c.score) return worst;
        if (c.score === 'red') return 'red';
        if (c.score === 'yellow' && worst !== 'red') return 'yellow';
        if (c.score === 'green' && !worst) return 'green';
        return worst;
      }, null);
      const totalFindings = children.reduce((sum, c) => sum + (c.findingsCount ?? 0), 0);

      groups.push({
        kind: 'multi',
        id: parentId,
        repoName: h.repoName,
        goals: children.map(c => c.goal),
        startedAt: h.startedAt,
        completedAt: h.completedAt ?? children[children.length - 1]?.completedAt,
        score: worstScore,
        findingsCount: totalFindings || undefined,
        children,
      });
      for (const c of children) seen.add(c.id);
    } else if (!h.parentRunId) {
      seen.add(h.id);
      groups.push({
        kind: 'single',
        id: h.id,
        repoName: h.repoName,
        goals: [h.goal],
        startedAt: h.startedAt,
        completedAt: h.completedAt,
        score: h.score,
        findingsCount: h.findingsCount,
      });
    }
  }

  // Create groups for parent IDs whose envelope record isn't in the history
  // (all children have parentRunId but the parent itself wasn't returned)
  for (const [parentId, children] of childrenByParent) {
    if (seen.has(parentId)) continue;
    seen.add(parentId);

    const first = children[0];
    const worstScore = children.reduce<'red' | 'yellow' | 'green' | null>((worst, c) => {
      if (!c.score) return worst;
      if (c.score === 'red') return 'red';
      if (c.score === 'yellow' && worst !== 'red') return 'yellow';
      if (c.score === 'green' && !worst) return 'green';
      return worst;
    }, null);
    const totalFindings = children.reduce((sum, c) => sum + (c.findingsCount ?? 0), 0);

    groups.push({
      kind: 'multi',
      id: parentId,
      repoName: first.repoName,
      goals: children.map(c => c.goal),
      startedAt: first.startedAt,
      completedAt: children[children.length - 1]?.completedAt,
      score: worstScore,
      findingsCount: totalFindings || undefined,
      children,
    });
    for (const c of children) seen.add(c.id);
  }

  return groups;
}

// ─── Score dot ────────────────────────────────────────────────

function ScoreDot({ score }: { score?: 'red' | 'yellow' | 'green' | null }) {
  if (!score) return <span className="w-2 h-2 rounded-full bg-tertiary-label/30 shrink-0" />;
  const color = score === 'red' ? 'bg-danger' : score === 'yellow' ? 'bg-warning' : 'bg-success';
  return <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />;
}

// ─── Goal badges ──────────────────────────────────────────────

function GoalBadges({ goals }: { goals: string[] }) {
  if (goals.length <= 3) {
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {goals.map(g => (
          <span key={g} className="text-[11px] px-1.5 py-0.5 rounded bg-elevated text-secondary-label font-medium">
            {GOAL_LABELS[g] ?? g}
          </span>
        ))}
      </div>
    );
  }
  return (
    <span className="text-[11px] px-1.5 py-0.5 rounded bg-elevated text-secondary-label font-medium">
      {goals.length} goals
    </span>
  );
}

// ─── Run row ──────────────────────────────────────────────────

function RunRow({
  run,
  onSelect,
  onPrefetch,
}: {
  run: GroupedRun;
  onSelect: (id: string) => void;
  onPrefetch?: (id: string) => void;
}) {
  const dur = duration(run.startedAt, run.completedAt);

  return (
    <button
      type="button"
      onClick={() => onSelect(run.id)}
      onPointerEnter={() => onPrefetch?.(run.id)}
      className="w-full flex items-center gap-4 px-4 py-3.5 rounded-lg hover:bg-surface transition-colors cursor-pointer group text-left"
    >
      <ScoreDot score={run.score} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-label truncate">
            {run.repoName}
          </span>
          <GoalBadges goals={run.goals} />
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[11px] text-tertiary-label">
            {timeAgo(run.startedAt)}
          </span>
          {dur && (
            <>
              <span className="text-[11px] text-tertiary-label/40">&middot;</span>
              <span className="text-[11px] text-tertiary-label">{dur}</span>
            </>
          )}
        </div>
      </div>

      {run.findingsCount != null && run.findingsCount > 0 && (
        <div className="text-right shrink-0">
          <span className="text-[13px] font-semibold text-label font-data tabular-nums">
            {run.findingsCount}
          </span>
          <span className="text-[11px] text-tertiary-label ml-1">
            {run.findingsCount === 1 ? 'finding' : 'findings'}
          </span>
        </div>
      )}

      <svg
        className="w-4 h-4 text-tertiary-label/40 group-hover:text-tertiary-label transition-colors shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 4l4 4-4 4" />
      </svg>
    </button>
  );
}

// ─── Empty state ──────────────────────────────────────────────

function EmptyState({ onNewAnalysis }: { onNewAnalysis: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <svg className="w-10 h-10 text-tertiary-label/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium text-secondary-label">No runs yet</p>
        <p className="text-[12px] text-tertiary-label mt-1">Run an analysis to see results here.</p>
      </div>
      <button
        onClick={onNewAnalysis}
        className="flex items-center gap-1.5 h-8 rounded-md bg-tint text-white px-4 text-[12px] font-semibold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all mt-2"
      >
        New Analysis
      </button>
    </div>
  );
}

// ─── RunsListView ─────────────────────────────────────────────

export interface RunsListViewProps {
  history: HistoryItem[];
  onSelectRun: (id: string) => void;
  onPrefetch?: (id: string) => void;
  onNewAnalysis: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

export function RunsListView({
  history,
  onSelectRun,
  onPrefetch,
  onNewAnalysis,
  hasMore,
  onLoadMore,
}: RunsListViewProps) {
  const grouped = useMemo(() => groupHistory(history), [history]);

  return (
    <div data-component="RunsListView" className="flex-1 overflow-y-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold font-brand text-label tracking-tight">Runs</h1>
          <span className="text-[12px] text-tertiary-label tabular-nums">
            {history.length} {history.length === 1 ? 'run' : 'runs'}
          </span>
        </div>

        {grouped.length === 0 ? (
          <EmptyState onNewAnalysis={onNewAnalysis} />
        ) : (
          <div className="flex flex-col gap-0.5">
            {grouped.map(run => (
              <RunRow
                key={run.id}
                run={run}
                onSelect={onSelectRun}
                onPrefetch={onPrefetch}
              />
            ))}

            {hasMore && onLoadMore && (
              <button
                onClick={onLoadMore}
                className="w-full py-3 text-[12px] text-tint font-medium hover:bg-surface rounded-lg transition-colors cursor-pointer mt-2"
              >
                Load more
              </button>
            )}
          </div>
        )}
    </div>
  );
}
