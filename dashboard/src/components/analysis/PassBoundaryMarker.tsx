'use client';

interface PassBoundaryMarkerProps {
  passName?: string;
}

export function PassBoundaryMarker({ passName }: PassBoundaryMarkerProps) {
  return (
    <div
      data-component="PassBoundaryMarker"
      className="flex items-center gap-2.5 py-2 my-1 relative z-[1]"
      style={{ animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      <div
        data-timeline-dot
        className="w-[20px] h-[20px] rounded-full bg-tint-muted flex items-center justify-center shrink-0 relative z-[1]"
        style={{ boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-tint) 30%, transparent)' }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path
            d="M2 8h12M8 2v12"
            stroke="var(--color-tint)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div>
        <div className="text-xs font-semibold text-tint">
          {passName ?? 'Next Pass'}
        </div>
        <div className="text-[10px] text-tertiary-label">
          Starting specialist investigation
        </div>
      </div>
    </div>
  );
}
