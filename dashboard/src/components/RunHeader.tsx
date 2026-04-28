'use client';

import type { RunMetrics } from '@/lib/agentSession';

interface RunHeaderProps {
  repoName: string;
  stats: string[];
  metrics: RunMetrics;
}

export function RunHeader({ repoName, stats, metrics }: RunHeaderProps) {
  return (
    <div data-component="RunHeader" className="px-6 py-3 border-b border-separator bg-surface shrink-0">
      <div className="flex items-center gap-4 max-w-[860px]">
        <h1 className="text-[15px] font-semibold text-label">{repoName}</h1>
        <div className="flex items-center gap-3 text-[12px] text-secondary-label">
          {stats.map((s, i) => (
            <span key={i}>
              {i > 0 && <span className="text-separator mr-3">·</span>}
              {s}
            </span>
          ))}
          <span className="text-separator">·</span>
          <span>{metrics.toolCalls} tool calls</span>
          <span className="text-separator">·</span>
          <span>${metrics.totalEstimatedCostUsd.toFixed(2)}</span>
          <span className="text-separator">·</span>
          <span>{(metrics.durationMs / 1000).toFixed(0)}s</span>
        </div>
      </div>
    </div>
  );
}
