'use client';

interface HistoryItem {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  hasResult: boolean;
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
}

export function Sidebar({ open, history, activeRunId, currentRepoName, currentGoal, isRunning, onSelectHistory, onNewRun, onClose }: SidebarProps) {
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
          <div className="px-4 pt-3 pb-2">
            <div className="text-[10px] uppercase tracking-widest text-tertiary-label font-semibold">
              History
            </div>
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
                return (
                  <button
                    key={h.id}
                    onClick={() => onSelectHistory(h.id)}
                    className={`text-left rounded-lg p-2.5 transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-[rgb(0_113_227/0.08)] shadow-sm'
                        : 'hover:bg-surface hover:shadow-sm'
                    }`}
                  >
                    <div className={`text-[13px] font-semibold truncate transition-colors ${
                      isActive ? 'text-tint' : 'text-label group-hover:text-tint'
                    }`}>
                      {h.repoName}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-tertiary-label">{time}</span>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium truncate max-w-[100px] ${
                        isActive
                          ? 'bg-[rgb(0_113_227/0.15)] text-tint'
                          : 'bg-[rgb(0_113_227/0.08)] text-tint'
                      }`}>
                        {h.goal}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
