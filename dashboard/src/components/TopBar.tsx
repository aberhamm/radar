'use client';

import type { SessionStatus } from '@/lib/agentSession';
import type { Scorecard, RunMetrics } from '@/lib/agentSession';

interface HistoryItem {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  hasResult: boolean;
}

interface TopBarProps {
  status: SessionStatus;
  repoName?: string;
  goal?: string;
  toolCalls?: number;
  budget?: number;
  scorecard?: Scorecard;
  metrics?: RunMetrics;
  history: HistoryItem[];
  onNewRun: () => void;
  onStop: () => void;
  onSelectHistory: (id: string) => void;
}

function scoreColor(score: 'red' | 'yellow' | 'green'): string {
  return score === 'red' ? '#ff3b30' : score === 'yellow' ? '#ff9500' : '#34c759';
}

export function TopBar({ status, repoName, goal, toolCalls, budget, scorecard, history, onNewRun, onStop, onSelectHistory }: TopBarProps) {
  const isRunning = status === 'running' || status === 'budget_paused';
  const isComplete = status === 'complete' || status === 'error';

  return (
    <header className="bg-white/80 backdrop-blur-xl shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-6 h-14 flex items-center gap-3 sticky top-0 z-10 shrink-0">
      {/* Brand */}
      <span className="font-mono text-sm font-bold text-label tracking-tight whitespace-nowrap">
        repo-audit
      </span>

      {/* Center: repo + goal badges */}
      {(isRunning || isComplete) && repoName && (
        <div className="flex gap-2 items-center flex-1">
          <span className="bg-elevated rounded-md px-2.5 py-0.5 text-xs font-mono font-medium text-label">
            {repoName}
          </span>
          {goal && (
            <span className="bg-[rgb(0_113_227/0.08)] rounded-md px-2.5 py-0.5 text-[11px] font-medium text-tint">
              {goal}
            </span>
          )}
          {scorecard && (
            <span className="flex items-center gap-1.5 text-xs">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: scoreColor(scorecard.overallScore) }}
              />
              <span className="text-secondary-label font-medium">
                {scorecard.overallScore.toUpperCase()}
              </span>
            </span>
          )}
        </div>
      )}

      <div className="ml-auto flex gap-3 items-center">
        {/* Budget progress */}
        {isRunning && budget && toolCalls !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-tertiary-label font-mono whitespace-nowrap">
              {toolCalls} / {budget}
            </span>
            <div className="w-20 h-1 bg-elevated rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (toolCalls / budget) * 100)}%`,
                  background: toolCalls / budget > 0.8 ? '#ff3b30' : toolCalls / budget > 0.6 ? '#ff9500' : '#0071e3',
                }}
              />
            </div>
          </div>
        )}

        {/* History dropdown */}
        {history.length > 0 && (
          <select
            onChange={e => { if (e.target.value) { onSelectHistory(e.target.value); e.target.value = ''; } }}
            defaultValue=""
            className="bg-elevated text-secondary-label border-none rounded-md px-2.5 py-1 text-[11px] cursor-pointer outline-none"
          >
            <option value="" disabled>History</option>
            {history.map(h => {
              const d = new Date(h.startedAt);
              const time = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              return (
                <option key={h.id} value={h.id}>
                  {h.repoName} — {time} ({h.goal})
                </option>
              );
            })}
          </select>
        )}

        {/* Stop button */}
        {isRunning && (
          <button
            onClick={onStop}
            className="bg-[rgb(255_59_48/0.1)] text-danger rounded-md px-3 py-1 text-xs font-medium cursor-pointer hover:bg-[rgb(255_59_48/0.15)] transition-colors"
          >
            Stop
          </button>
        )}

        {/* New Run button */}
        {isComplete && (
          <button
            onClick={onNewRun}
            className="bg-tint text-white rounded-md px-3 py-1 text-xs font-medium cursor-pointer hover:bg-[#0077ed] transition-colors"
          >
            New Run
          </button>
        )}
      </div>
    </header>
  );
}
