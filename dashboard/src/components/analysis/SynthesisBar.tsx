'use client';

interface SynthesisBarProps {
  status: 'pending' | 'running' | 'complete';
  workerCount: number;
  completeCount: number;
  crossCuttingCount?: number;
}

export function SynthesisBar({ status, workerCount, completeCount, crossCuttingCount }: SynthesisBarProps) {
  return (
    <div
      data-component="SynthesisBar"
      className="border-t border-separator bg-surface px-5 py-3 flex items-start gap-3 shrink-0"
      style={{ animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      {/* Badge */}
      <div
        className="flex items-center gap-1.5 px-2.5 py-[3px] rounded-md text-[10px] font-bold tracking-wide shrink-0"
        style={{
          background: status === 'complete'
            ? 'color-mix(in srgb, var(--color-success) 10%, transparent)'
            : 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
          color: status === 'complete' ? 'var(--color-success)' : 'var(--color-warning)',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path
            d="M8 2L2 8l6 6M14 2L8 8l6 6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.7"
          />
        </svg>
        SYNTHESIS
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-1">
        {status === 'pending' && (
          <p className="text-[12px] text-secondary-label leading-relaxed">
            Waiting for <strong className="text-label font-semibold">{workerCount - completeCount} workers</strong> to complete before cross-referencing findings...
          </p>
        )}
        {status === 'running' && (
          <div className="flex items-center gap-2">
            <span className="inline-flex gap-[3px]">
              {[0, 0.2, 0.4].map(delay => (
                <span
                  key={delay}
                  className="w-1 h-1 rounded-full"
                  style={{
                    background: 'var(--color-warning)',
                    animation: `pulse-dot 1.2s ease-in-out infinite`,
                    animationDelay: `${delay}s`,
                  }}
                />
              ))}
            </span>
            <p className="text-[12px] text-secondary-label">
              Cross-referencing findings for patterns across clusters...
            </p>
          </div>
        )}
        {status === 'complete' && (
          <p className="text-[12px] text-secondary-label leading-relaxed">
            Synthesis complete{crossCuttingCount != null && crossCuttingCount > 0
              ? <> — found <strong className="text-label font-semibold">{crossCuttingCount} cross-cutting</strong> pattern{crossCuttingCount > 1 ? 's' : ''}</>
              : null}.
          </p>
        )}
      </div>
    </div>
  );
}
