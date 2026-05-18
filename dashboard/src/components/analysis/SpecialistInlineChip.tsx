'use client';

import type { SpecialistState } from '@/lib/useLiveAnalysis';
import type { SpecialistDisplayMode } from '@/lib/useSpecialistDisplayMode';

interface SpecialistInlineChipProps {
  specialist: SpecialistState;
  mode: SpecialistDisplayMode;
  isExpanded: boolean;
  onToggle: () => void;
}

export function SpecialistInlineChip({ specialist, mode, isExpanded, onToggle }: SpecialistInlineChipProps) {
  const isRunning = specialist.status === 'running';
  const isComplete = specialist.status === 'complete';
  const isSkipped = specialist.status === 'skipped';

  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all"
      style={{
        background: isExpanded
          ? `color-mix(in srgb, ${specialist.color} 8%, var(--color-surface))`
          : 'var(--color-elevated)',
        borderColor: isExpanded
          ? specialist.color
          : 'var(--color-separator)',
        animation: 'chip-enter 0.3s cubic-bezier(0.16, 1, 0.3, 1) both',
      }}
    >
      {/* Status dot */}
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{
          background: isComplete ? 'var(--color-success)' : isSkipped ? 'var(--color-quaternary-label)' : specialist.color,
          animation: isRunning ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
        }}
      />

      {/* Name */}
      <span
        className="text-[12px] font-semibold"
        style={{ color: isComplete ? 'var(--color-success)' : isSkipped ? 'var(--color-quaternary-label)' : 'var(--color-label)' }}
      >
        {specialist.name}
      </span>

      {/* Tool count */}
      {specialist.toolCalls > 0 && (
        <span className="text-[10px] font-mono text-tertiary-label">
          {specialist.toolCalls}{specialist.budget > 0 ? `/${specialist.budget}` : ''}
        </span>
      )}

      {/* Findings badge */}
      {specialist.findingsCount > 0 && (
        <span
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
          style={{
            background: `color-mix(in srgb, ${specialist.color} 12%, transparent)`,
            color: specialist.color,
          }}
        >
          {specialist.findingsCount} finding{specialist.findingsCount > 1 ? 's' : ''}
        </span>
      )}

      {/* Running indicator */}
      {isRunning && (
        <span className="inline-flex gap-[2px]">
          {[0, 0.15, 0.3].map(delay => (
            <span
              key={delay}
              className="w-[3px] h-[3px] rounded-full"
              style={{
                background: specialist.color,
                animation: `pulse-dot 1.2s ease-in-out infinite`,
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </span>
      )}

      {/* Complete check */}
      {isComplete && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M2.5 6.5L5 9l4.5-6"
            stroke="var(--color-success)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* Expand/modal indicator */}
      {mode === 'inline' && (
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          className={`shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        >
          <path
            d="M2 3l2 2 2-2"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {mode === 'modal' && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-tertiary-label">
          <rect x="1" y="2" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="1" />
          <path d="M1 3.5h8" stroke="currentColor" strokeWidth="0.7" />
        </svg>
      )}
      {mode === 'panel' && (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-tertiary-label">
          <rect x="1" y="1" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
          <path d="M6 1v8" stroke="currentColor" strokeWidth="0.7" />
        </svg>
      )}
    </button>
  );
}
