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
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(13,17,23,0.85)',
      zIndex: 20,
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 32,
        maxWidth: 400,
        width: '90%',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 28, marginBottom: 12 }}>⏸</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Budget Exhausted</h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Used {toolCalls} of {budget} tool calls.
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
          {findings} findings recorded so far.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={() => handleDecision(true)}
            disabled={loading}
            style={{
              background: 'var(--accent)',
              color: '#000',
              border: 'none',
              borderRadius: 4,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            Extend +50 calls
          </button>
          <button
            onClick={() => handleDecision(false)}
            disabled={loading}
            style={{
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            Finish &amp; Generate Report
          </button>
        </div>
      </div>
    </div>
  );
}
