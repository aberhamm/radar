'use client';

import type { WorkerState } from '@/lib/useLiveAnalysis';

interface WorkerLaneGridProps {
  workers: Map<string, WorkerState>;
  selectedWorkerId: string | null;
  onSelectWorker: (id: string) => void;
}

export function WorkerLaneGrid({ workers, selectedWorkerId, onSelectWorker }: WorkerLaneGridProps) {
  const entries = [...workers.values()];

  return (
    <div
      data-component="WorkerLaneGrid"
      className="flex gap-1.5 px-4 py-2.5 border-b border-separator bg-surface shrink-0 overflow-x-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {entries.map(w => {
        const isSelected = w.clusterId === selectedWorkerId;
        const isComplete = w.status === 'complete';
        const isActive = w.status === 'running';
        const progressPercent = w.budget > 0 ? Math.min(100, Math.round((w.toolCalls / w.budget) * 100)) : 0;

        return (
          <button
            key={w.clusterId}
            type="button"
            onClick={() => onSelectWorker(w.clusterId)}
            className={`flex-1 min-w-[130px] max-w-[200px] px-3 py-2.5 rounded-lg border transition-all cursor-pointer flex flex-col gap-2 ${
              isSelected
                ? 'bg-surface border-[var(--worker-color)] shadow-card'
                : isComplete
                  ? 'bg-canvas border-separator opacity-80 hover:opacity-100'
                  : 'bg-canvas border-separator hover:border-[var(--wc-half)]'
            }`}
            style={{
              '--worker-color': w.color,
              '--wc-half': `color-mix(in srgb, ${w.color} 40%, var(--color-separator))`,
            } as React.CSSProperties}
          >
            {/* Top: dot + name + counter */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <div
                  className="w-[7px] h-[7px] rounded-full shrink-0"
                  style={{
                    background: isComplete ? 'var(--color-success)' : w.color,
                    animation: isActive ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
                  }}
                />
                <span
                  className="text-[11px] font-semibold truncate"
                  style={{ color: isComplete ? 'var(--color-success)' : 'var(--color-label)' }}
                >
                  {w.name}
                </span>
              </div>
              <span
                className="text-[10px] font-mono shrink-0"
                style={{ color: isComplete ? 'var(--color-success)' : 'var(--color-tertiary-label)' }}
              >
                {w.toolCalls}/{w.budget}{isComplete ? ' ✓' : ''}
              </span>
            </div>

            {/* Progress bar */}
            <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--color-elevated)' }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${isComplete ? 100 : progressPercent}%`,
                  background: isComplete ? 'var(--color-success)' : w.color,
                  transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>

            {/* Bottom: status + findings badge */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] flex items-center gap-1" style={{ color: isComplete ? 'var(--color-success)' : 'var(--color-quaternary-label)' }}>
                {isActive && (
                  <span className="inline-flex gap-[2px]">
                    {[0, 0.15, 0.3].map(delay => (
                      <span
                        key={delay}
                        className="w-[3px] h-[3px] rounded-full"
                        style={{
                          background: w.color,
                          animation: `pulse-dot 1.2s ease-in-out infinite`,
                          animationDelay: `${delay}s`,
                        }}
                      />
                    ))}
                  </span>
                )}
                {isComplete ? 'Complete' : isActive ? (w.currentActivity || 'investigating...') : w.status === 'pending' ? 'Waiting' : ''}
              </span>
              {w.findingsCount > 0 && (
                <span
                  className="text-[10px] font-semibold px-1.5 rounded-md"
                  style={{
                    background: `color-mix(in srgb, ${w.color} 12%, transparent)`,
                    color: w.color,
                  }}
                >
                  {w.findingsCount}
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
