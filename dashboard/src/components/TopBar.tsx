'use client';

import type { SessionStatus } from '@/lib/agentSession';
import type { Scorecard, RunMetrics } from '@/lib/agentSession';

interface TopBarProps {
  status: SessionStatus;
  repoName?: string;
  goal?: string;
  toolCalls?: number;
  budget?: number;
  scorecard?: Scorecard;
  metrics?: RunMetrics;
  onNewRun: () => void;
  onStop: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  hasHistory: boolean;
}

function scoreColor(score: 'red' | 'yellow' | 'green'): string {
  return score === 'red' ? '#ff3b30' : score === 'yellow' ? '#ff9500' : '#34c759';
}

export function TopBar({ status, repoName, goal, toolCalls, budget, scorecard, onNewRun, onStop, onToggleSidebar, sidebarOpen, hasHistory }: TopBarProps) {
  const isRunning = status === 'running' || status === 'budget_paused';
  const isComplete = status === 'complete' || status === 'error';

  return (
    <header className="bg-surface-translucent backdrop-blur-xl shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-4 h-14 flex items-center gap-3 sticky top-0 z-10 shrink-0">
      {/* Sidebar toggle */}
      {hasHistory && (
        <button
          onClick={onToggleSidebar}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors cursor-pointer"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 16 16" fill="currentColor">
            <rect y="2" width="16" height="1.5" rx="0.75" />
            <rect y="7.25" width="16" height="1.5" rx="0.75" />
            <rect y="12.5" width="16" height="1.5" rx="0.75" />
          </svg>
        </button>
      )}

      {/* Brand */}
      <span className="text-sm font-bold text-tint tracking-tight whitespace-nowrap">
        Scout
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

        {/* Stop button */}
        {isRunning && (
          <button
            onClick={onStop}
            className="bg-[rgb(255_59_48/0.1)] text-danger rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-[rgb(255_59_48/0.15)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(255_59_48/0.3)]"
          >
            Stop
          </button>
        )}

        {/* New Run button */}
        {isComplete && (
          <button
            onClick={onNewRun}
            className="bg-tint text-white rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-[#0077ed] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_113_227/0.3)]"
          >
            New Run
          </button>
        )}
      </div>
    </header>
  );
}
