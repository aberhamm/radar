'use client';

import type { Scorecard } from '@/lib/agentSession';

type ContextStatus = 'running' | 'budget_paused' | 'complete' | 'error' | 'replaying';

interface ContextBarProps {
  status: ContextStatus;
  repoName: string;
  goal?: string;
  scorecard?: Scorecard;
  toolCalls?: number;
  budget?: number;
  onStop: () => void;
  onNewRun: () => void;
  onViewReport?: () => void;
}

function scoreColor(score: 'red' | 'yellow' | 'green'): string {
  return score === 'red' ? '#ff3b30' : score === 'yellow' ? '#ff9500' : '#34c759';
}

export function ContextBar({ status, repoName, goal, scorecard, toolCalls, budget, onStop, onNewRun, onViewReport }: ContextBarProps) {
  const isRunning = status === 'running' || status === 'budget_paused';
  const isComplete = status === 'complete' || status === 'error';
  const isReplaying = status === 'replaying';

  return (
    <div className="bg-surface border-b border-separator px-4 h-10 flex items-center gap-3 shrink-0 animate-slide-down">
      {/* Repo name */}
      <span className="bg-elevated rounded-md px-2.5 py-0.5 text-xs font-mono font-medium text-label">
        {repoName}
      </span>

      {/* Goal */}
      {goal && (
        <span className="bg-[rgb(0_113_227/0.08)] rounded-md px-2.5 py-0.5 text-[11px] font-medium text-tint">
          {goal}
        </span>
      )}

      {/* Scorecard */}
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

      {/* Budget progress (running only) */}
      {isRunning && budget && toolCalls !== undefined && (
        <div className="flex items-center gap-2 ml-2">
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

      {/* Spacer */}
      <div className="flex-1" />

      {/* Contextual action */}
      {isRunning && (
        <button
          onClick={onStop}
          className="bg-[rgb(255_59_48/0.1)] text-danger rounded-md px-3 py-1 text-xs font-medium cursor-pointer hover:bg-[rgb(255_59_48/0.15)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(255_59_48/0.3)]"
        >
          Stop
        </button>
      )}

      {isReplaying && onViewReport && (
        <button
          onClick={onViewReport}
          className="bg-tint text-white rounded-md px-3 py-1 text-xs font-medium cursor-pointer hover:bg-[#0077ed] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_113_227/0.3)]"
        >
          View Report
        </button>
      )}

      {isComplete && (
        <button
          onClick={onNewRun}
          className="bg-tint text-white rounded-md px-3 py-1 text-xs font-medium cursor-pointer hover:bg-[#0077ed] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_113_227/0.3)]"
        >
          New Run
        </button>
      )}
    </div>
  );
}
