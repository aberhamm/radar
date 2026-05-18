'use client';

interface Phase {
  label: string;
  durationMs: number;
  toolCalls: number;
}

const PHASE_COLORS: Record<string, string> = {
  investigation: 'bg-tint',
  writing: 'bg-success',
  assembly: 'bg-warning',
  verification: 'bg-info',
};

const PHASE_LABELS: Record<string, string> = {
  investigation: 'Investigation',
  writing: 'Writing',
  assembly: 'Assembly',
  verification: 'Verification',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

export function PhaseBar({ phases, totalDurationMs }: { phases: Phase[]; totalDurationMs: number }) {
  if (phases.length === 0 || totalDurationMs === 0) return null;

  return (
    <div data-component="PhaseBar">
      <div className="text-[10px] text-tertiary-label uppercase tracking-widest font-medium mb-2">
        Phase Timeline
      </div>
      <div className="flex h-10 rounded-lg overflow-hidden border border-separator shadow-sm">
        {phases.map((phase, i) => {
          const pct = (phase.durationMs / totalDurationMs) * 100;
          const showLabel = pct > 15;
          return (
            <div
              key={phase.label}
              className={`${PHASE_COLORS[phase.label] ?? 'bg-elevated'} relative flex items-center justify-center transition-all`}
              style={{
                width: `${pct}%`,
                animation: `expandWidth 0.6s cubic-bezier(0.16, 1, 0.3, 1) ${i * 100}ms both`,
              }}
              title={`${PHASE_LABELS[phase.label] ?? phase.label}: ${formatDuration(phase.durationMs)} (${phase.toolCalls} tool calls)`}
            >
              {showLabel && (
                <div className="text-[11px] font-medium text-white/90 truncate px-2">
                  {PHASE_LABELS[phase.label] ?? phase.label}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex mt-1.5 gap-4">
        {phases.map((phase) => {
          const pct = ((phase.durationMs / totalDurationMs) * 100).toFixed(0);
          return (
            <div key={phase.label} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${PHASE_COLORS[phase.label] ?? 'bg-elevated'}`} />
              <span className="text-[10px] text-secondary-label font-mono">
                {PHASE_LABELS[phase.label] ?? phase.label} {formatDuration(phase.durationMs)} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
