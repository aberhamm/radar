'use client';

import type { Scorecard } from '@/lib/agentSession';
import { scoreColor } from '@/lib/utils';
import type { Tab } from '@/lib/useUrlState';

type ContextStatus = 'running' | 'budget_paused' | 'complete' | 'error' | 'replaying' | 'comparing';

const TAB_LABELS: Record<Tab, string> = {
  report: 'Report',
  events: 'Events',
  rules: 'Rules',
  cost: 'Cost',
};

interface ContextBarProps {
  status: ContextStatus;
  repoName: string;
  goal?: string;
  scorecard?: Scorecard;
  toolCalls?: number;
  budget?: number;
  onStop: () => void;
  onViewReport?: () => void;
  onViewReplay?: () => void;
  onBudgetDecision?: (extend: boolean) => void;
  compareRunNames?: [string, string];
  compareSummary?: string;
  onExitCompare?: () => void;
  /** Active tab for breadcrumb display */
  activeTab?: Tab;
}

export function ContextBar({ status, repoName, goal, scorecard, toolCalls, budget, onStop, onViewReport, onViewReplay, onBudgetDecision, compareRunNames, compareSummary, onExitCompare, activeTab }: ContextBarProps) {
  const isRunning = status === 'running' || status === 'budget_paused';
  const isComplete = status === 'complete' || status === 'error';
  const isReplaying = status === 'replaying';
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
        <span className="bg-[rgb(0_113_227/0.08)] rounded-md px-2.5 py-0.5 text-[11px] font-medium text-tint">
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
      {isRunning && status === 'budget_paused' && onBudgetDecision && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onBudgetDecision(true)}
            className="bg-tint text-white rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:brightness-110 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_113_227/0.3)]"
          >
            Resume +50
          </button>
          <button
            onClick={() => onBudgetDecision(false)}
            className="bg-elevated text-label rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-separator transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_0_0/0.1)]"
          >
            Finish Now
          </button>
          <button
            onClick={onStop}
            className="bg-[rgb(255_59_48/0.1)] text-danger rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-[rgb(255_59_48/0.15)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(255_59_48/0.3)]"
          >
            Stop
          </button>
        </div>
      )}
      {isRunning && status !== 'budget_paused' && (
        <button
          onClick={onStop}
          className="bg-[rgb(255_59_48/0.1)] text-danger rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-[rgb(255_59_48/0.15)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(255_59_48/0.3)]"
        >
          Stop
        </button>
      )}

      {isReplaying && onViewReport && (
        <button
          onClick={onViewReport}
          className="bg-tint text-white rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:brightness-110 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_113_227/0.3)]"
        >
          View Report
        </button>
      )}

      {isComplete && onViewReplay && (
        <button
          onClick={onViewReplay}
          className="bg-elevated text-secondary-label rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:text-label hover:bg-separator transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_0_0/0.1)]"
        >
          View Run
        </button>
      )}

      {isComparing && (
        <div className="flex items-center gap-2">
          {compareSummary && (
            <span className="bg-[rgb(0_113_227/0.08)] rounded-md px-2.5 py-0.5 text-[11px] font-medium text-tint">
              {compareSummary}
            </span>
          )}
          {onExitCompare && (
            <button
              onClick={onExitCompare}
              className="bg-elevated text-label rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-separator transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_0_0/0.1)]"
            >
              Exit Compare
            </button>
          )}
        </div>
      )}
    </div>
  );
}
