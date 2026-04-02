'use client';

import { useState } from 'react';

interface BudgetPausedViewProps {
  findings: number;
  toolCalls: number;
  budget: number;
  onDecision: (extend: boolean) => void;
}

export function BudgetPausedView({ findings, toolCalls, budget, onDecision }: BudgetPausedViewProps) {
  const [loading, setLoading] = useState(false);

  const handleDecision = async (extend: boolean) => {
    setLoading(true);
    try {
      await fetch('/api/extend-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extend }),
      });
      onDecision(extend);
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm z-20">
      <div className="bg-white rounded-xl border border-black/[0.06] shadow-float p-6 max-w-[380px] w-[90%] text-center">
        <div className="text-2xl mb-2">⏸</div>
        <h2 className="text-base font-semibold text-label mb-1.5">Budget Exhausted</h2>
        <p className="text-sm text-secondary-label mb-1">
          Used {toolCalls} of {budget} tool calls.
        </p>
        <p className="text-sm text-secondary-label mb-6">
          {findings} findings recorded so far.
        </p>

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => handleDecision(true)}
            disabled={loading}
            className={`bg-tint text-white rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[#0077ed] active:scale-[0.98]'
            }`}
          >
            Extend +50 calls
          </button>
          <button
            onClick={() => handleDecision(false)}
            disabled={loading}
            className={`bg-elevated text-label rounded-lg px-4 py-2 text-sm font-medium transition-all ${
              loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-[#e8e8ed] active:scale-[0.98]'
            }`}
          >
            Finish &amp; Generate Report
          </button>
        </div>
      </div>
    </div>
  );
}
