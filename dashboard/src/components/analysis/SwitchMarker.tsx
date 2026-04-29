'use client';

export function SwitchMarker() {
  return (
    <div
      data-component="ModelSwitchMarker"
      className="flex items-center gap-2.5 py-2 my-1 relative z-[1]"
      style={{ animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      <div
        data-timeline-dot
        className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 relative z-[1]"
        style={{ background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)', boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-warning) 30%, transparent)' }}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
          <path
            d="M3 8h10M10 5l3 3-3 3M6 11L3 8l3-3"
            stroke="var(--color-warning)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div>
        <div className="text-xs font-semibold text-warning">Analysis Complete</div>
        <div className="text-[10px] text-tertiary-label">
          Switching to fast model for writing
        </div>
      </div>
    </div>
  );
}
