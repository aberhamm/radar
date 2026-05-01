'use client';

import type { AnimationPhase } from '@/lib/useAnimationSequence';

interface PhaseRailProps {
  phase: AnimationPhase;
  progressPercent: number;
  isLive: boolean;
  isInstant: boolean;
  budgetPaused?: boolean;
  statusMessage: string;
  elapsed: number;
  verbose: boolean;
  onToggleVerbose: () => void;
  rightPanelOpen: boolean;
  onTogglePanel: () => void;
  onStartReplay: () => void;
  onRun: () => void;
  onReset: () => void;
  accentColor: string;
  isParallel?: boolean;
  workerCount?: number;
  workerCompleteCount?: number;
}

export function PhaseRail({
  phase,
  progressPercent,
  isLive,
  isInstant,
  budgetPaused,
  statusMessage,
  elapsed,
  verbose,
  onToggleVerbose,
  rightPanelOpen,
  onTogglePanel,
  onStartReplay,
  onRun,
  onReset,
  accentColor,
  isParallel,
  workerCount,
  workerCompleteCount,
}: PhaseRailProps) {
  const isWriting = phase === 'recording' || phase === 'assembling';
  const fillColor =
    phase === 'switching'
      ? 'var(--color-warning)'
      : isWriting || phase === 'done'
        ? 'var(--color-success)'
        : 'var(--color-tint)';
  const isActive = phase !== 'done' && phase !== 'idle';

  return (
    <div
      data-component="PhaseRail"
      className="h-10 px-4 flex items-center gap-4 border-b border-separator bg-surface-translucent backdrop-blur-sm shrink-0"
    >
      {/* Live indicator / Replay button / Play controls */}
      {isLive ? (
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: budgetPaused
                ? 'var(--color-warning)'
                : phase === 'done'
                  ? 'var(--color-success)'
                  : 'var(--color-tint)',
              animation: phase !== 'done' ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
            }}
          />
          <span className="text-[10px] font-bold tracking-wider text-secondary-label">
            {budgetPaused ? 'PAUSED' : phase === 'done' ? 'DONE' : 'LIVE'}
          </span>
        </div>
      ) : isInstant ? (
        <button
          type="button"
          onClick={onStartReplay}
          className="px-3 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer shrink-0 bg-elevated text-secondary-label hover:text-label"
        >
          Replay
        </button>
      ) : (
        <button
          type="button"
          onClick={phase === 'idle' || phase === 'done' ? onRun : onReset}
          className={`px-3 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer shrink-0 ${
            phase === 'idle' || phase === 'done'
              ? 'bg-tint text-white hover:brightness-110 active:scale-95'
              : 'bg-elevated text-tertiary-label hover:text-label'
          }`}
        >
          {phase === 'idle' ? 'Play' : phase === 'done' ? 'Replay' : 'Reset'}
        </button>
      )}

      {/* Status dot + label */}
      <div className="flex items-center gap-2 shrink-0">
        {phase !== 'idle' && !isLive && !isInstant && (
          <div
            className="w-1.5 h-1.5 rounded-full transition-all duration-500"
            style={{
              background: accentColor,
              animation: phase !== 'done' ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
            }}
          />
        )}
        <span className="text-[11px] font-semibold text-label">
          {statusMessage
            ? statusMessage
            : phase === 'idle'
              ? isLive
                ? 'Starting'
                : 'Ready'
              : phase === 'analyzing'
                ? 'Analyzing'
                : phase === 'switching'
                  ? 'Switching'
                  : phase === 'recording'
                    ? 'Recording'
                    : phase === 'assembling'
                      ? 'Assembling'
                      : 'Complete'}
        </span>
        {isLive && elapsed > 0 && (
          <span className="text-[10px] font-mono text-tertiary-label">
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        )}
      </div>

      {/* Parallel worker count */}
      {isParallel && isLive && workerCount != null && workerCount > 0 && (
        <div className="flex items-center gap-1 text-[10px] text-tertiary-label shrink-0">
          <span className="font-semibold text-secondary-label">{workerCount}</span> workers
          <span style={{ color: 'var(--color-quaternary-label)' }}>&middot;</span>
          <span className="font-semibold text-secondary-label">{workerCompleteCount ?? 0}</span> done
        </div>
      )}

      {/* Progress bar */}
      <div
        className="flex-1 h-[4px] rounded-full overflow-hidden relative"
        style={{
          background: 'var(--color-elevated)',
          opacity: phase === 'idle' && !isLive ? 0 : 1,
          transition: 'opacity 0.4s ease',
        }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${progressPercent}%`,
            background: `linear-gradient(90deg, ${fillColor}, color-mix(in srgb, ${fillColor} 85%, white))`,
            transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.6s ease',
          }}
        />
        {isActive && (
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${progressPercent}%`,
              background:
                'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)',
              backgroundSize: '200% 100%',
              animation: 'progress-shimmer 2s ease-in-out infinite',
              transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        )}
        {isActive && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
            style={{
              left: `${progressPercent}%`,
              transform: 'translate(-50%, -50%)',
              background: fillColor,
              opacity: 0.5,
              filter: 'blur(4px)',
              animation: 'progress-glow 1.8s ease-in-out infinite',
              transition: 'left 1.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.6s ease',
            }}
          />
        )}
      </div>

      {/* Verbose toggle */}
      <button
        type="button"
        onClick={onToggleVerbose}
        className="ml-auto text-[10px] font-medium text-tertiary-label hover:text-label transition-colors cursor-pointer shrink-0 flex items-center gap-1"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
          {verbose ? (
            <>
              <path
                d="M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5-3-5-6.5-5z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
            </>
          ) : (
            <>
              <path
                d="M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5-3-5-6.5-5z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3 13L13 3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </>
          )}
        </svg>
        {verbose ? 'Verbose' : 'Compact'}
      </button>

      {/* Panel toggle */}
      <button
        type="button"
        onClick={onTogglePanel}
        className="text-[10px] font-medium text-tertiary-label hover:text-label transition-colors cursor-pointer shrink-0 flex items-center gap-1"
        aria-label={rightPanelOpen ? 'Hide findings panel' : 'Show findings panel'}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
          <rect
            x="1"
            y="2"
            width="14"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <line x1="11" y1="2" x2="11" y2="14" stroke="currentColor" strokeWidth="1.3" />
        </svg>
        {rightPanelOpen ? 'Hide' : 'Panel'}
      </button>
    </div>
  );
}
