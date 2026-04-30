'use client';

import { useState } from 'react';

interface BudgetPausedViewProps {
  findings: number;
  toolCalls: number;
  budget: number;
  onDecision: (extend: boolean) => void;
}

export function BudgetPausedView({ findings, toolCalls, budget, onDecision }: BudgetPausedViewProps) {
  const [dismissing, setDismissing] = useState(false);

  const isReached = toolCalls >= budget;

  const handleDecision = (extend: boolean) => {
    setDismissing(true);
    onDecision(extend);
  };

  if (dismissing) return null;

  return (
    <div data-component="BudgetPausedView" className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm z-20" style={{ animation: 'fadeIn 0.2s ease both' }}>
      <div className="animate-scale-in bg-surface rounded-xl border border-separator shadow-float p-6 max-w-[380px] w-[90%] text-center">
        <div className="text-2xl mb-2">{isReached ? '⏸' : '⚡'}</div>
        <h2 className="text-base font-semibold text-label mb-1.5">
          {isReached ? 'Budget Limit Reached' : 'Budget Running Low'}
        </h2>
        <p className="text-sm text-secondary-label mb-1">
          {isReached
            ? `Used all ${budget} tool calls.`
            : `${budget - toolCalls} of ${budget} tool calls remaining.`}
        </p>
        <p className="text-sm text-secondary-label mb-6">
          {findings > 0
            ? `${findings} finding${findings === 1 ? '' : 's'} recorded so far.`
            : 'Findings are recorded after analysis completes.'}
        </p>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => handleDecision(true)}
            className="bg-tint text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-tint-focus cursor-pointer hover:brightness-110 active:scale-[0.98]"
          >
            Extend +50 calls
          </button>
          <button
            onClick={() => handleDecision(false)}
            className="bg-elevated text-label rounded-lg px-4 py-2.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-separator)] cursor-pointer hover:bg-separator active:scale-[0.98]"
          >
            Finish &amp; Generate Report
          </button>
        </div>
      </div>
    </div>
  );
}
