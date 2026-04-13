'use client';

import { useState, useMemo } from 'react';
import type { HistoryItem } from '@/lib/agentSession';
import type { Tab } from '@/lib/useUrlState';

interface SidebarProps {
  open: boolean;
  history: HistoryItem[];
  activeRunId?: string | null;
  currentRepoName?: string;
  currentGoal?: string;
  isRunning: boolean;
  onSelectHistory: (id: string) => void;
  /** Prefetch run data on hover so clicks are instant */
  onPrefetch?: (id: string) => void;
  onNewRun: () => void;
  onClose: () => void;
  compareMode?: boolean;
  compareSelections?: string[];
  onToggleCompare?: () => void;
  onCompareSelect?: (id: string) => void;
  onCompare?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Active tab in CompleteView, for section nav highlighting */
  activeTab?: Tab;
  /** Callback when section nav item is clicked */
  onSectionClick?: (tab: Tab) => void;
  /** Whether a completed run is being viewed (shows section nav) */
  showSections?: boolean;
  /** Compare mode: IDs of the two runs being compared, for dual highlight */
  compareHighlight?: [string, string] | null;
}

// ─── Types for grouped history ──────────────────────────────────

type ScoreLevel = 'red' | 'yellow' | 'green';

interface MultiGoalGroup {
  type: 'multigoal';
  parentId: string;
  item: HistoryItem;
  children: HistoryItem[];
  worstScore?: ScoreLevel | null;
}

interface SingleRun {
  type: 'single';
  item: HistoryItem;
}

type RunEntry = MultiGoalGroup | SingleRun;

export interface RepoGroup {
  repoName: string;
  latestStartedAt: string;
  runs: RunEntry[];
  worstScore?: ScoreLevel | null;
}

const SCORE_ORDER: Record<string, number> = { red: 3, yellow: 2, green: 1 };

function worstOf(a: ScoreLevel | null | undefined, b: ScoreLevel | null | undefined): ScoreLevel | null {
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

export function Sidebar({ open, history, activeRunId, currentRepoName, currentGoal, isRunning, onSelectHistory, onPrefetch, onNewRun, onClose, compareMode, compareSelections = [], onToggleCompare, onCompareSelect, onCompare, hasMore, onLoadMore, activeTab, onSectionClick, showSections, compareHighlight }: SidebarProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const repoGroups = useMemo(() => groupByRepo(history), [history]);

  // Auto-expand the most recent repo
  useMemo(() => {
    if (repoGroups.length > 0 && expandedRepos.size === 0) {
      setExpandedRepos(new Set([repoGroups[0].repoName]));
    }
  }, [repoGroups.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleRepo = (repoName: string) => {
    setExpandedRepos(prev => {
      const next = new Set(prev);
      if (next.has(repoName)) next.delete(repoName);
      else next.add(repoName);
      return next;
    });
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const renderHistoryRow = (
    h: HistoryItem,
    opts: { isChild?: boolean; isGroupHeader?: boolean; expanded?: boolean; groupId?: string; worstScore?: 'red' | 'yellow' | 'green' | null; childCount?: number } = {},
  ) => {
    const d = new Date(h.startedAt);
    const time = d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const isActive = h.id === activeRunId;
    const isSelected = compareSelections.includes(h.id);
    const isSample = h.id === '__sample__';
    const canCompare = compareMode && h.hasResult && !isSample;
    const isDisabledInCompare = compareMode && (!h.hasResult || isSample);
    const displayScore = opts.isGroupHeader ? opts.worstScore : h.score;
    const scoreDot = displayScore === 'red'
      ? 'bg-danger'
      : displayScore === 'yellow'
        ? 'bg-warning'
        : displayScore === 'green'
          ? 'bg-success'
          : null;

    const handleClick = () => {
      if (opts.isGroupHeader && opts.groupId) {
        const wasExpanded = expandedGroups.has(opts.groupId);
        toggleGroup(opts.groupId);
        // Only navigate to multi-goal view when expanding, not collapsing
        if (!wasExpanded && !compareMode) {
          onSelectHistory(opts.groupId);
        }
        return;
      }
      if (canCompare && onCompareSelect) {
        onCompareSelect(h.id);
      } else if (!compareMode) {
        onSelectHistory(h.id);
      }
    };

    return (
      <button
        key={h.id}
        onClick={handleClick}
        onPointerEnter={() => onPrefetch?.(opts.isGroupHeader && opts.groupId ? opts.groupId : h.id)}
        disabled={isDisabledInCompare}
        aria-current={isActive && !compareMode ? 'true' : undefined}
        aria-selected={isSelected || undefined}
        className={`text-left rounded-lg p-2.5 min-h-touch transition-all group w-full ${
          opts.isChild ? 'pl-5' : ''
        } ${
          isDisabledInCompare
            ? 'opacity-40 cursor-not-allowed'
            : isSelected
              ? 'bg-[rgb(0_113_227/0.08)] cursor-pointer'
              : isActive && !compareMode
                ? 'cursor-pointer'
                : 'hover:bg-surface cursor-pointer'
        }`}
      >
        <div className="flex items-center gap-2">
          {compareMode && !opts.isGroupHeader && (
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              isSelected
                ? 'border-tint bg-tint'
                : isDisabledInCompare
                  ? 'border-separator'
                  : 'border-tertiary-label group-hover:border-tint'
            }`}>
              {isSelected && (
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <path d="M2.5 5l2 2 3.5-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
          )}
          {opts.isGroupHeader && (
            <svg
              className={`w-3 h-3 text-tertiary-label shrink-0 transition-transform ${opts.expanded ? 'rotate-90' : ''}`}
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <path d="M4 2l4 4-4 4" />
            </svg>
          )}
          <div className="flex-1 min-w-0">
            {opts.isChild ? (
              <>
                {/* Child row: goal is primary, repo name already shown by parent */}
                <div className="flex items-center gap-2">
                  <span className={`text-[12px] truncate transition-colors ${
                    isSelected ? 'font-bold text-tint' : isActive && !compareMode ? 'font-semibold text-label' : 'font-medium text-label group-hover:text-label'
                  }`}>
                    {h.goal}
                  </span>
                  {opts.isGroupHeader && opts.childCount && (
                    <span className="text-[10px] text-tertiary-label">({opts.childCount} goals)</span>
                  )}
                  {scoreDot && (
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${scoreDot}`} />
                  )}
                </div>
                <div className="text-[10px] text-tertiary-label mt-0.5">{time}</div>
              </>
            ) : (
              <>
                {/* Top-level row: repo name is primary */}
                <div className={`text-[13px] truncate transition-colors ${
                  isSelected ? 'font-bold text-tint' : isActive && !compareMode ? 'font-bold text-label' : 'font-semibold text-label group-hover:text-label'
                }`}>
                  {h.repoName}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-tertiary-label">{time}</span>
                  <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium truncate max-w-[100px] ${
                    isSelected
                      ? 'bg-[rgb(0_113_227/0.12)] text-tint'
                      : 'bg-elevated text-secondary-label'
                  }`}>
                    {h.goal}
                  </span>
                  {scoreDot && (
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${scoreDot}`} />
                  )}
                  {opts.isGroupHeader && opts.childCount && (
                    <span className="text-[10px] text-tertiary-label">{opts.childCount} goals</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </button>
    );
  };

  return (
    <>
      {/* Backdrop for mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        role="navigation"
        aria-label="Run history"
        className={`bg-canvas border-r border-separator flex flex-col shrink-0 overflow-hidden z-30 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? 'w-[240px]' : 'w-0'
        } fixed lg:relative h-full`}
      >
        <div className="w-[240px] flex flex-col h-full overflow-hidden">
          {/* Current run */}
          {isRunning && currentRepoName && (
            <div className="px-4 pt-4 pb-3">
              <div className="text-[10px] uppercase tracking-widest text-tertiary-label font-semibold mb-2">
                Current
              </div>
              <div className="bg-surface rounded-lg shadow-sm border border-separator p-3">
                <div className="text-[13px] font-semibold text-label truncate">
                  {currentRepoName}
                </div>
                {currentGoal && (
                  <div className="text-[11px] text-tint font-medium mt-0.5 truncate">
                    {currentGoal}
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full bg-success shrink-0"
                    style={{ animation: 'pulse-dot 2s ease-in-out infinite' }}
                  />
                  <span className="text-[10px] text-success font-medium">Running</span>
                </div>
              </div>
            </div>
          )}

          {/* New Analysis button */}
          {!isRunning && (
            <div className="px-4 pt-3">
              <button
                onClick={onNewRun}
                className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-tint text-white text-[13px] font-semibold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                New Analysis
              </button>
            </div>
          )}

          {/* Section navigation (visible when viewing a completed run) */}
          {showSections && onSectionClick && (
            <div className="px-4 pt-3 pb-2">
              <div className="text-[10px] uppercase tracking-widest text-tertiary-label font-semibold mb-2">
                Sections
              </div>
              <div className="flex flex-col gap-0.5">
                {([
                  { id: 'report' as Tab, label: 'Report' },
                  { id: 'events' as Tab, label: 'Events' },
                  { id: 'rules' as Tab, label: 'Rules' },
                  { id: 'cost' as Tab, label: 'Cost' },
                ]).map(section => (
                  <button
                    key={section.id}
                    onClick={() => onSectionClick(section.id)}
                    className={`text-left rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                      activeTab === section.id
                        ? 'bg-[rgb(0_113_227/0.08)] text-tint'
                        : 'text-secondary-label hover:text-label hover:bg-surface'
                    }`}
                  >
                    {section.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          <div className="px-4 pt-3 pb-2 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-tertiary-label font-semibold">
              History
            </div>
            {onToggleCompare && !isRunning && (
              <button
                onClick={onToggleCompare}
                className={`text-[10px] font-medium cursor-pointer transition-colors ${
                  compareMode
                    ? 'text-danger hover:text-[#ff2d20]'
                    : 'text-tint hover:brightness-110'
                }`}
              >
                {compareMode ? 'Cancel' : 'Compare'}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {repoGroups.length === 0 && (
              <div className="text-xs text-tertiary-label py-3">
                No previous runs
              </div>
            )}
            <div className="flex flex-col gap-1">
              {repoGroups.map(repoGroup => {
                const isSingleRunRepo = repoGroup.runs.length === 1 && repoGroup.runs[0].type === 'single';
                // When a repo has exactly one multi-goal group, flatten: show goals directly under repo header
                const isSoleMultiGoal = repoGroup.runs.length === 1 && repoGroup.runs[0].type === 'multigoal';
                const repoExpanded = expandedRepos.has(repoGroup.repoName);
                const scoreDot = repoGroup.worstScore === 'red'
                  ? 'bg-danger'
                  : repoGroup.worstScore === 'yellow'
                    ? 'bg-warning'
                    : repoGroup.worstScore === 'green'
                      ? 'bg-success'
                      : null;

                // Single-run repos render directly (no expand/collapse)
                if (isSingleRunRepo) {
                  const entry = repoGroup.runs[0] as SingleRun;
                  const isCompareHighlighted = compareHighlight?.includes(entry.item.id);
                  const badgeIndex = compareHighlight ? compareHighlight.indexOf(entry.item.id) : -1;
                  return (
                    <div key={entry.item.id} className="relative">
                      {renderHistoryRow(entry.item)}
                      {isCompareHighlighted && (
                        <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-tint text-white text-[9px] font-bold flex items-center justify-center">
                          {badgeIndex + 1}
                        </span>
                      )}
                    </div>
                  );
                }

                // Sole multi-goal group: flatten — repo header expands directly to goal children
                if (isSoleMultiGoal) {
                  const entry = repoGroup.runs[0] as MultiGoalGroup;
                  return (
                    <div key={repoGroup.repoName}>
                      <button
                        onClick={() => {
                          const wasExpanded = expandedRepos.has(repoGroup.repoName);
                          toggleRepo(repoGroup.repoName);
                          // Only navigate to multi-goal view when expanding, not collapsing
                          if (!wasExpanded && !compareMode) onSelectHistory(entry.parentId);
                        }}
                        className="w-full text-left rounded-lg p-2.5 min-h-touch transition-all hover:bg-surface cursor-pointer group"
                      >
                        <div className="flex items-center gap-2">
                          <svg
                            className={`w-3 h-3 text-tertiary-label shrink-0 transition-transform ${repoExpanded ? 'rotate-90' : ''}`}
                            viewBox="0 0 12 12"
                            fill="currentColor"
                          >
                            <path d="M4 2l4 4-4 4" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-semibold text-label truncate group-hover:text-label">
                              {repoGroup.repoName}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-tertiary-label">
                                {entry.children.length} goals
                              </span>
                              {scoreDot && (
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${scoreDot}`} />
                              )}
                            </div>
                          </div>
                        </div>
                      </button>

                      {repoExpanded && (
                        <div className="flex flex-col gap-0.5 mt-0.5 ml-2">
                          {entry.children.map(child =>
                            renderHistoryRow(child, { isChild: true }),
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                // Multi-run repos get a collapsible header
                return (
                  <div key={repoGroup.repoName}>
                    <button
                      onClick={() => toggleRepo(repoGroup.repoName)}
                      className="w-full text-left rounded-lg p-2.5 min-h-touch transition-all hover:bg-surface cursor-pointer group"
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          className={`w-3 h-3 text-tertiary-label shrink-0 transition-transform ${repoExpanded ? 'rotate-90' : ''}`}
                          viewBox="0 0 12 12"
                          fill="currentColor"
                        >
                          <path d="M4 2l4 4-4 4" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-label truncate group-hover:text-label">
                            {repoGroup.repoName}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-tertiary-label">
                              {repoGroup.runs.length} run{repoGroup.runs.length !== 1 ? 's' : ''}
                            </span>
                            {scoreDot && (
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${scoreDot}`} />
                            )}
                          </div>
                        </div>
                      </div>
                    </button>

                    {repoExpanded && (
                      <div className="flex flex-col gap-0.5 mt-0.5 ml-2">
                        {repoGroup.runs.map(entry => {
                          if (entry.type === 'single') {
                            const isCompareHighlighted = compareHighlight?.includes(entry.item.id);
                            const badgeIndex = compareHighlight ? compareHighlight.indexOf(entry.item.id) : -1;
                            return (
                              <div key={entry.item.id} className="relative">
                                {renderHistoryRow(entry.item, { isChild: true })}
                                {isCompareHighlighted && (
                                  <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-tint text-white text-[9px] font-bold flex items-center justify-center">
                                    {badgeIndex + 1}
                                  </span>
                                )}
                              </div>
                            );
                          }

                          // Multi-goal group within repo
                          const groupId = entry.parentId;
                          const expanded = expandedGroups.has(groupId);
                          return (
                            <div key={groupId}>
                              {renderHistoryRow(entry.item, {
                                isGroupHeader: true,
                                expanded,
                                groupId,
                                worstScore: entry.worstScore,
                                isChild: true,
                                childCount: entry.children.length,
                              })}
                              {expanded && entry.children && (
                                <div className="flex flex-col gap-0.5 mt-0.5 ml-3">
                                  {entry.children.map(child =>
                                    renderHistoryRow(child, { isChild: true }),
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Load more */}
            {hasMore && onLoadMore && (
              <button
                onClick={onLoadMore}
                className="w-full mt-2 py-2 text-[11px] text-tint font-medium hover:bg-surface rounded-lg transition-colors cursor-pointer"
              >
                Load more...
              </button>
            )}
          </div>
          {/* Compare action footer */}
          {compareMode && compareSelections.length === 2 && onCompare && (
            <div className="px-4 py-3 border-t border-separator shrink-0">
              <button
                onClick={onCompare}
                className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-tint text-white text-[13px] font-semibold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M4 3v10M12 3v10M1 8h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Compare
              </button>
            </div>
          )}

          {compareMode && compareSelections.length < 2 && (
            <div className="px-4 py-3 border-t border-separator shrink-0">
              <div className="text-[11px] text-tertiary-label text-center">
                Select {2 - compareSelections.length} more run{compareSelections.length === 0 ? 's' : ''}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
