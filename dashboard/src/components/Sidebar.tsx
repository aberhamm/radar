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
  activeRunId?: string;
  currentRepoName?: string;
  currentGoal?: string;
  isRunning: boolean;
  onSelectHistory: (id: string) => void;
  onClose: () => void;
}

export function Sidebar({ open, history, currentRepoName, currentGoal, isRunning, onSelectHistory, onClose }: SidebarProps) {
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
        className={`bg-canvas border-r border-black/[0.06] flex flex-col shrink-0 overflow-hidden z-30 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
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
              <div className="bg-white rounded-lg shadow-sm border border-black/[0.06] p-3">
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
                return (
                  <button
                    key={h.id}
                    onClick={() => onSelectHistory(h.id)}
                    className="text-left rounded-lg p-2.5 hover:bg-white hover:shadow-sm transition-all cursor-pointer group"
                  >
                    <div className="text-[13px] font-semibold text-label truncate group-hover:text-tint transition-colors">
                      {h.repoName}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-tertiary-label">{time}</span>
                      <span className="text-[10px] bg-[rgb(0_113_227/0.08)] text-tint rounded px-1.5 py-0.5 font-medium truncate max-w-[100px]">
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
