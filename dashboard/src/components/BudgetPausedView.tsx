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

  const [error, setError] = useState<string | null>(null);

  const handleDecision = async (extend: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/extend-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extend }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(data.error ?? `Failed (${res.status})`);
        setLoading(false);
        return;
      }
      onDecision(extend);
    } catch {
      setError('Network error — check connection');
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm z-20" style={{ animation: 'fadeIn 0.2s ease both' }}>
      <div className="animate-scale-in bg-surface rounded-xl border border-separator shadow-float p-6 max-w-[380px] w-[90%] text-center">
        <div className="text-2xl mb-2">⏸</div>
        <h2 className="text-base font-semibold text-label mb-1.5">Budget Exhausted</h2>
        <p className="text-sm text-secondary-label mb-1">
          {toolCalls > budget
            ? `Tool call budget exceeded (${toolCalls}/${budget}).`
            : `Used ${toolCalls} of ${budget} tool calls.`}
        </p>
        <p className="text-sm text-secondary-label mb-6">
          {findings > 0
            ? `${findings} findings recorded so far.`
            : 'Findings are recorded after analysis completes.'}
        </p>

        {error && (
          <p className="text-xs text-danger mb-3">{error}</p>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={() => handleDecision(true)}
            disabled={loading}
            className={`bg-tint text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_113_227/0.3)] ${
              loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:brightness-110 active:scale-[0.98]'
            }`}
          >
            Extend +50 calls
          </button>
          <button
            onClick={() => handleDecision(false)}
            disabled={loading}
            className={`bg-elevated text-label rounded-lg px-4 py-2.5 text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_0_0/0.1)] ${
              loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-separator active:scale-[0.98]'
            }`}
          >
            Finish &amp; Generate Report
          </button>
        </div>
      </div>
    </div>
  );
}
