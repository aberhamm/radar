'use client';

import type { Scorecard } from '@/lib/agentSession';
import { scoreColor } from '@/lib/utils';
import type { Tab } from '@/lib/useUrlState';

type ContextStatus = 'running' | 'budget_paused' | 'complete' | 'error' | 'comparing';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview',
  investigation: 'Investigation',
  cost: 'Cost',
  timeline: 'Timeline',
};

interface ContextBarProps {
  status: ContextStatus;
  repoName: string;
  goal?: string;
  scorecard?: Scorecard;
  toolCalls?: number;
  budget?: number;
  onStop: () => void;
  onBudgetDecision?: (extend: boolean) => void;
  onViewResults?: () => void;
  compareRunNames?: [string, string];
  compareSummary?: string;
  onExitCompare?: () => void;
  /** Active tab for breadcrumb display */
  activeTab?: Tab;
}

export function ContextBar({ status, repoName, goal, scorecard, toolCalls, budget, onStop, onBudgetDecision, onViewResults, compareRunNames, compareSummary, onExitCompare, activeTab }: ContextBarProps) {
  const isRunning = status === 'running' || status === 'budget_paused';
  const isComplete = status === 'complete' || status === 'error';
  const isComparing = status === 'comparing';

  return (
    <div data-component="ContextBar" className="bg-surface border-b border-separator px-4 h-10 flex items-center gap-3 shrink-0 animate-slide-down">
      {/* Repo name — always first (compare mode shows both names) */}
      {isComparing && compareRunNames ? (
        <span className="bg-elevated rounded-md px-2.5 py-0.5 text-xs font-mono font-medium text-label">
          {compareRunNames[0]} <span className="text-tertiary-label">vs</span> {compareRunNames[1]}
        </span>
      ) : (
        <span className="bg-elevated rounded-md px-2.5 py-0.5 text-xs font-mono font-medium text-label">
          {repoName}
        </span>
      )}

      {/* Running: budget progress is the headline */}
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
                background: toolCalls / budget > 0.8 ? 'var(--color-danger)' : toolCalls / budget > 0.6 ? 'var(--color-warning)' : 'var(--color-tint)',
              }}
            />
          </div>
        </div>
      )}

      {/* Complete/Replay: scorecard is the headline */}
      {!isRunning && scorecard && (
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: scoreColor(scorecard.overallScore) }}
            role="img"
            aria-label={`Score: ${scorecard.overallScore}`}
          />
          <span className="text-secondary-label font-medium">
            {scorecard.overallScore.toUpperCase()}
          </span>
        </span>
      )}

      {/* Goal — context */}
      {goal && (
        <span className="bg-tint-subtle rounded-md px-2.5 py-0.5 text-[11px] font-medium text-tint">
          {goal}
        </span>
      )}

      {/* Breadcrumb: section name (only for completed runs) */}
      {isComplete && activeTab && (
        <>
          <span className="text-[11px] text-tertiary-label">/</span>
          <span className="text-[11px] text-secondary-label font-medium">
            {TAB_LABELS[activeTab]}
          </span>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Contextual action */}
      {onViewResults && (
        <button
          onClick={onViewResults}
          className="bg-tint text-white rounded-md px-3 py-1.5 text-xs font-semibold cursor-pointer hover:brightness-110 active:scale-[0.97] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-tint-focus"
        >
          View Results
        </button>
      )}
      {isRunning && status === 'budget_paused' && onBudgetDecision && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onBudgetDecision(true)}
            className="bg-tint text-white rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:brightness-110 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tint-focus"
          >
            Resume +50
          </button>
          <button
            onClick={() => onBudgetDecision(false)}
            className="bg-elevated text-label rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-separator transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-separator)]"
          >
            Finish Now
          </button>
          <button
            onClick={onStop}
            className="bg-danger-subtle text-danger rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-danger-muted transition-colors focus:outline-none focus-visible:ring-2 ring-tint-soft"
          >
            Stop
          </button>
        </div>
      )}
      {isRunning && status !== 'budget_paused' && (
        <button
          onClick={onStop}
          className="bg-danger-subtle text-danger rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-danger-muted transition-colors focus:outline-none focus-visible:ring-2 ring-tint-soft"
        >
          Stop
        </button>
      )}

      {isComparing && (
        <div className="flex items-center gap-2">
          {compareSummary && (
            <span className="bg-tint-subtle rounded-md px-2.5 py-0.5 text-[11px] font-medium text-tint">
              {compareSummary}
            </span>
          )}
          {onExitCompare && (
            <button
              onClick={onExitCompare}
              className="bg-elevated text-label rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-separator transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-separator)]"
            >
              Exit Compare
            </button>
          )}
        </div>
      )}
    </div>
  );
}
