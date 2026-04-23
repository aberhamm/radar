'use client';

import { useState, useMemo, useEffect } from 'react';
import type { HistoryItem } from '@/lib/agentSession';
import { groupByRepo } from '@/lib/historyGrouping';

interface HistoryPanelProps {
  history: HistoryItem[];
  activeRunId?: string | null;
  isRunning: boolean;
  onSelectHistory: (id: string) => void;
  onPrefetch?: (id: string) => void;
  compareMode?: boolean;
  compareSelections?: string[];
  onToggleCompare?: () => void;
  onCompareSelect?: (id: string) => void;
  onCompare?: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
  compareHighlight?: [string, string] | null;
}

export function HistoryPanel({
  history,
  activeRunId,
  isRunning,
  onSelectHistory,
  onPrefetch,
  compareMode,
  compareSelections = [],
  onToggleCompare,
  onCompareSelect,
  onCompare,
  hasMore,
  onLoadMore,
  compareHighlight,
}: HistoryPanelProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const repoGroups = useMemo(() => groupByRepo(history), [history]);

  // Auto-expand the most recent repo on first load
  useEffect(() => {
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
        className={`text-left rounded-lg p-2 min-h-touch transition-all group w-full ${
          opts.isChild ? 'pl-4' : ''
        } ${
          isDisabledInCompare
            ? 'opacity-40 cursor-not-allowed'
            : isSelected
              ? 'bg-[rgb(0_113_227/0.08)] cursor-pointer'
              : isActive && !compareMode
                ? 'bg-[rgb(0_113_227/0.06)] cursor-pointer'
                : 'hover:bg-surface cursor-pointer'
        }`}
      >
        <div className="flex items-center gap-1.5">
          {compareMode && !opts.isGroupHeader && (
            <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              isSelected
                ? 'border-tint bg-tint'
                : isDisabledInCompare
                  ? 'border-separator'
                  : 'border-tertiary-label group-hover:border-tint'
            }`}>
              {isSelected && (
                <svg width="7" height="7" viewBox="0 0 10 10" fill="none">
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
          {!opts.isGroupHeader && !opts.isChild && (
            <div className="w-3 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            {opts.isChild ? (
              <>
                <div className="flex items-center gap-1.5">
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
                <div className={`text-[12px] truncate transition-colors ${
                  isSelected ? 'font-bold text-tint' : isActive && !compareMode ? 'font-bold text-label' : 'font-semibold text-label group-hover:text-label'
                }`}>
                  {h.repoName}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-tertiary-label">{time}</span>
                  <span className={`text-[10px] rounded px-1 py-0.5 font-medium truncate max-w-[80px] ${
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
    <div data-component="HistoryPanel" className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 shrink-0">
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

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto pb-2">
        {repoGroups.length === 0 && (
          <div className="text-xs text-tertiary-label py-3">
            No previous runs
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          {repoGroups.map(repoGroup => {
            const repoExpanded = expandedRepos.has(repoGroup.repoName);
            const scoreDot = repoGroup.worstScore === 'red'
              ? 'bg-danger'
              : repoGroup.worstScore === 'yellow'
                ? 'bg-warning'
                : repoGroup.worstScore === 'green'
                  ? 'bg-success'
                  : null;

            const runCount = repoGroup.runs.length;

            return (
              <div key={repoGroup.repoName}>
                <button
                  onClick={() => toggleRepo(repoGroup.repoName)}
                  className="w-full text-left rounded-lg p-2 min-h-touch transition-all hover:bg-surface cursor-pointer group"
                >
                  <div className="flex items-center gap-1.5">
                    <svg
                      className={`w-3 h-3 text-tertiary-label shrink-0 transition-transform ${repoExpanded ? 'rotate-90' : ''}`}
                      viewBox="0 0 12 12"
                      fill="currentColor"
                    >
                      <path d="M4 2l4 4-4 4" />
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-label truncate group-hover:text-label">
                        {repoGroup.repoName}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-tertiary-label">
                          {runCount} run{runCount !== 1 ? 's' : ''}
                        </span>
                        {scoreDot && (
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${scoreDot}`} />
                        )}
                      </div>
                    </div>
                  </div>
                </button>

                {repoExpanded && (
                  <div className="flex flex-col gap-0.5 mt-0.5 ml-1.5">
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

                      const isActive = activeRunId === entry.parentId;
                      const d = new Date(entry.item.startedAt);
                      const time = d.toLocaleString(undefined, {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      });
                      return (
                        <div key={entry.parentId}>
                          <button
                            onClick={() => {
                              if (!compareMode) onSelectHistory(entry.parentId);
                            }}
                            onPointerEnter={() => onPrefetch?.(entry.parentId)}
                            className={`w-full text-left rounded-lg p-2 pl-4 min-h-touch transition-all hover:bg-surface cursor-pointer group ${
                              isActive ? 'bg-[rgb(0_113_227/0.06)]' : ''
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-[12px] truncate transition-colors ${isActive ? 'font-semibold text-tint' : 'font-medium text-label group-hover:text-label'}`}>
                                    Full audit
                                  </span>
                                  <span className="text-[10px] text-tertiary-label">
                                    {entry.children.length} goals
                                  </span>
                                  {entry.worstScore && (
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                      entry.worstScore === 'red' ? 'bg-danger' : entry.worstScore === 'yellow' ? 'bg-warning' : 'bg-success'
                                    }`} />
                                  )}
                                </div>
                                <div className="text-[10px] text-tertiary-label mt-0.5">{time}</div>
                              </div>
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {hasMore && onLoadMore && (
          <button
            onClick={onLoadMore}
            className="w-full mt-2 py-2 text-[11px] text-tint font-medium hover:bg-surface rounded-lg transition-colors cursor-pointer"
          >
            Load more...
          </button>
        )}
      </div>

      {/* Compare footer */}
      {compareMode && compareSelections.length === 2 && onCompare && (
        <div className="py-2 border-t border-separator shrink-0">
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
        <div className="py-2 border-t border-separator shrink-0">
          <div className="text-[11px] text-tertiary-label text-center">
            Select {2 - compareSelections.length} more run{compareSelections.length === 0 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
