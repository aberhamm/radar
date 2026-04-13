'use client';

import { useState, useMemo } from 'react';
import type { HistoryItem } from '@/lib/agentSession';

interface SidebarProps {
  open: boolean;
  history: HistoryItem[];
  activeRunId?: string | null;
  currentRepoName?: string;
  currentGoal?: string;
  isRunning: boolean;
  onSelectHistory: (id: string) => void;
  onNewRun: () => void;
  onClose: () => void;
  compareMode?: boolean;
  compareSelections?: string[];
  onToggleCompare?: () => void;
  onCompareSelect?: (id: string) => void;
  onCompare?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
}

/** Group history items: entries with parentRunId collapse under a parent row. */
function groupHistory(items: HistoryItem[]): Array<{
  type: 'single' | 'group';
  item: HistoryItem;
  children?: HistoryItem[];
  worstScore?: 'red' | 'yellow' | 'green' | null;
}> {
  const groups = new Map<string, HistoryItem[]>();
  const singles: HistoryItem[] = [];

  for (const item of items) {
    if (item.parentRunId) {
      const existing = groups.get(item.parentRunId) ?? [];
      existing.push(item);
      groups.set(item.parentRunId, existing);
    } else {
      singles.push(item);
    }
  }

  const result: Array<{
    type: 'single' | 'group';
    item: HistoryItem;
    children?: HistoryItem[];
    worstScore?: 'red' | 'yellow' | 'green' | null;
  }> = [];

  // Interleave groups and singles by startedAt
  const allEntries: Array<{ key: string; startedAt: string; isGroup: boolean }> = [];

  for (const item of singles) {
    allEntries.push({ key: item.id, startedAt: item.startedAt, isGroup: false });
  }
  for (const [parentId, children] of groups) {
    const earliest = children.reduce((min, c) => c.startedAt < min ? c.startedAt : min, children[0].startedAt);
    allEntries.push({ key: parentId, startedAt: earliest, isGroup: true });
  }

  // Sort newest first
  allEntries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  for (const entry of allEntries) {
    if (entry.isGroup) {
      const children = groups.get(entry.key)!;
      const scoreOrder: Record<string, number> = { red: 3, yellow: 2, green: 1 };
      const worstScore = children.reduce<'red' | 'yellow' | 'green' | null>((worst, c) => {
        if (!c.score) return worst;
        if (!worst) return c.score;
        return (scoreOrder[c.score] ?? 0) > (scoreOrder[worst] ?? 0) ? c.score : worst;
      }, null);

      // Use first child as the representative item for the group
      const rep = children[0];
      result.push({
        type: 'group',
        item: {
          ...rep,
          id: entry.key,       // Use parentRunId as the group ID
          goal: 'all',
        },
        children,
        worstScore,
      });
    } else {
      const item = singles.find(s => s.id === entry.key)!;
      result.push({ type: 'single', item });
    }
  }

  return result;
}

export function Sidebar({ open, history, activeRunId, currentRepoName, currentGoal, isRunning, onSelectHistory, onNewRun, onClose, compareMode, compareSelections = [], onToggleCompare, onCompareSelect, onCompare, hasMore, onLoadMore }: SidebarProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const grouped = useMemo(() => groupHistory(history), [history]);

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
    opts: { isChild?: boolean; isGroupHeader?: boolean; expanded?: boolean; groupId?: string; worstScore?: 'red' | 'yellow' | 'green' | null } = {},
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
        toggleGroup(opts.groupId);
        // Also load the multi-goal view in the main area
        if (!compareMode) {
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
        disabled={isDisabledInCompare}
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
            <div className={`text-[13px] truncate transition-colors ${
              isSelected ? 'font-bold text-tint' : isActive && !compareMode ? 'font-bold text-label' : 'font-semibold text-label group-hover:text-label'
            }`}>
              {h.repoName}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              {!opts.isChild && (
                <span className="text-[11px] text-tertiary-label">{time}</span>
              )}
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
              {opts.isGroupHeader && (
                <span className="text-[10px] text-tertiary-label">8 goals</span>
              )}
            </div>
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
                    className="w-1.5 h-1.5 rounded-full bg-[#34c759] shrink-0"
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
                    : 'text-tint hover:text-[#0077ed]'
                }`}
              >
                {compareMode ? 'Cancel' : 'Compare'}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {grouped.length === 0 && (
              <div className="text-xs text-tertiary-label py-3">
                No previous runs
              </div>
            )}
            <div className="flex flex-col gap-1">
              {grouped.map(entry => {
                if (entry.type === 'single') {
                  return renderHistoryRow(entry.item);
                }

                // Multi-goal group
                const groupId = entry.item.id;
                const expanded = expandedGroups.has(groupId);
                return (
                  <div key={groupId}>
                    {renderHistoryRow(entry.item, {
                      isGroupHeader: true,
                      expanded,
                      groupId,
                      worstScore: entry.worstScore,
                    })}
                    {expanded && entry.children && (
                      <div className="flex flex-col gap-0.5 mt-0.5">
                        {entry.children.map(child =>
                          renderHistoryRow(child, { isChild: true }),
                        )}
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
