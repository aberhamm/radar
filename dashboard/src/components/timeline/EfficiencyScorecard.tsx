'use client';

import type { RunDiagnostics } from '@/lib/agentSession';

interface CardDef {
  label: string;
  value: string;
  warn?: boolean;
}

export function EfficiencyScorecard({ diagnostics }: { diagnostics: RunDiagnostics }) {
  const cards: CardDef[] = [
    {
      label: 'Repeated Calls',
      value: String(diagnostics.efficiency.repeatedCalls),
      warn: diagnostics.efficiency.repeatedCalls > 5,
    },
    {
      label: 'Tool Error Rate',
      value: `${(diagnostics.efficiency.toolErrorRate * 100).toFixed(1)}%`,
      warn: diagnostics.efficiency.toolErrorRate > 0.1,
    },
    {
      label: 'Unique Tool Ratio',
      value: `${(diagnostics.efficiency.uniqueToolCallRatio * 100).toFixed(0)}%`,
    },
    {
      label: 'File / Call Ratio',
      value: diagnostics.investigationBreadth.fileToCallRatio.toFixed(2),
    },
    {
      label: 'Retries',
      value: String(diagnostics.retryStats.totalAttempts),
      warn: diagnostics.retryStats.totalAttempts > 3,
    },
    {
      label: 'Compression Calls',
      value: String(diagnostics.compressionStats.calls),
    },
  ];

  return (
    <div data-component="EfficiencyScorecard">
      <div className="text-[10px] text-tertiary-label uppercase tracking-widest font-medium mb-2">
        Efficiency Signals
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {cards.map((card, i) => (
          <div
            key={card.label}
            className="bg-surface rounded-lg border border-separator shadow-sm p-3"
            style={{ animation: `fadeIn 0.3s ease ${i * 60}ms both` }}
          >
            <div className="text-[10px] text-tertiary-label uppercase tracking-widest font-medium mb-1.5">
              {card.label}
            </div>
            <div className={`text-xl font-bold font-mono ${card.warn ? 'text-warning' : 'text-label'}`}>
              {card.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
