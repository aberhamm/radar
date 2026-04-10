'use client';

interface HistoryItem {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  hasResult: boolean;
  score?: 'red' | 'yellow' | 'green' | null;
  findingsCount?: number;
}

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
}

export function Sidebar({ open, history, activeRunId, currentRepoName, currentGoal, isRunning, onSelectHistory, onNewRun, onClose, compareMode, compareSelections = [], onToggleCompare, onCompareSelect, onCompare }: SidebarProps) {
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
            {history.length === 0 && (
              <div className="text-xs text-tertiary-label py-3">
                No previous runs
              </div>
            )}
            <div className="flex flex-col gap-1">
              {history.map(h => {
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
                const scoreDot = h.score === 'red'
                  ? 'bg-danger'
                  : h.score === 'yellow'
                    ? 'bg-warning'
                    : h.score === 'green'
                      ? 'bg-success'
                      : null;

                const handleClick = () => {
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
                    className={`text-left rounded-lg p-2.5 transition-all group border-l-2 ${
                      isDisabledInCompare
                        ? 'border-transparent opacity-40 cursor-not-allowed'
                        : isSelected
                          ? 'bg-[rgb(0_113_227/0.12)] border-tint shadow-sm cursor-pointer'
                          : isActive && !compareMode
                            ? 'bg-[rgb(0_113_227/0.1)] border-tint shadow-sm cursor-pointer'
                            : 'border-transparent hover:bg-surface hover:shadow-sm cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {compareMode && (
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
                      <div className="flex-1 min-w-0">
                        <div className={`text-[13px] font-semibold truncate transition-colors ${
                          isSelected ? 'text-tint' : isActive && !compareMode ? 'text-tint' : 'text-label group-hover:text-tint'
                        }`}>
                          {h.repoName}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-tertiary-label">{time}</span>
                          <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium truncate max-w-[100px] ${
                            isSelected || (isActive && !compareMode)
                              ? 'bg-[rgb(0_113_227/0.15)] text-tint'
                              : 'bg-[rgb(0_113_227/0.08)] text-tint'
                          }`}>
                            {h.goal}
                          </span>
                          {scoreDot && (
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${scoreDot}`} />
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
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
