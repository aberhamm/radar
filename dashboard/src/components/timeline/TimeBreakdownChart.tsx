'use client';

interface Breakdown {
  llmMs: number;
  toolMs: number;
  compressionMs: number;
  retryMs: number;
  idleMs: number;
}

const SEGMENTS: { key: keyof Breakdown; label: string; color: string; dot: string }[] = [
  { key: 'llmMs', label: 'LLM', color: 'bg-tint', dot: 'bg-tint' },
  { key: 'toolMs', label: 'Tools', color: 'bg-success', dot: 'bg-success' },
  { key: 'compressionMs', label: 'Compression', color: 'bg-warning', dot: 'bg-warning' },
  { key: 'retryMs', label: 'Retries', color: 'bg-danger', dot: 'bg-danger' },
  { key: 'idleMs', label: 'Idle', color: 'bg-[var(--color-tertiary-label)]', dot: 'bg-tertiary-label' },
];

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function TimeBreakdownChart({ breakdown }: { breakdown: Breakdown }) {
  const total = Object.values(breakdown).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  const visible = SEGMENTS.filter(s => (breakdown[s.key] / total) >= 0.01);

  return (
    <div data-component="TimeBreakdownChart">
      <div className="text-[10px] text-tertiary-label uppercase tracking-widest font-medium mb-2">
        Time Allocation
      </div>
      <div
        className="flex h-8 rounded-lg overflow-hidden border border-separator shadow-sm"
        style={{ animation: 'expandWidth 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both' }}
      >
        {visible.map((seg) => {
          const pct = (breakdown[seg.key] / total) * 100;
          return (
            <div
              key={seg.key}
              className={`${seg.color} flex items-center justify-center`}
              style={{ width: `${pct}%` }}
              title={`${seg.label}: ${formatMs(breakdown[seg.key])} (${pct.toFixed(1)}%)`}
            >
              {pct > 12 && (
                <span className="text-[10px] font-medium text-white/90">{seg.label}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {SEGMENTS.map((seg) => {
          const ms = breakdown[seg.key];
          if (ms === 0) return null;
          const pct = ((ms / total) * 100).toFixed(1);
          return (
            <div key={seg.key} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${seg.dot}`} />
              <span className="text-[10px] text-secondary-label font-mono">
                {seg.label} {formatMs(ms)} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
