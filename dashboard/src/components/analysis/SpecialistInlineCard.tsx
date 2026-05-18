'use client';

import type { StreamTurn } from '@/lib/runTransform';
import type { SpecialistState } from '@/lib/useLiveAnalysis';
import { TurnItem } from './TurnItem';

interface SpecialistInlineCardProps {
  specialist: SpecialistState;
  turns: StreamTurn[];
  typingText?: string;
  accentColor: string;
}

export function SpecialistInlineCard({ specialist, turns, typingText, accentColor }: SpecialistInlineCardProps) {
  const isRunning = specialist.status === 'running';
  const progressPct = specialist.budget > 0
    ? Math.min(100, Math.round((specialist.toolCalls / specialist.budget) * 100))
    : (isRunning ? 50 : 100);

  return (
    <div
      className="ml-[30px] mt-1 mb-2 rounded-lg border overflow-hidden"
      style={{
        borderColor: `color-mix(in srgb, ${specialist.color} 30%, var(--color-separator))`,
        animation: 'expand-down 0.25s cubic-bezier(0.16, 1, 0.3, 1) both',
        transformOrigin: 'top',
      }}
    >
      {/* Progress bar */}
      <div className="h-[3px] w-full" style={{ background: 'var(--color-elevated)' }}>
        <div
          className="h-full"
          style={{
            width: `${progressPct}%`,
            background: specialist.status === 'complete' ? 'var(--color-success)' : specialist.color,
            transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </div>

      {/* Nested reasoning stream */}
      <div className="px-3 py-2 max-h-[280px] overflow-y-auto space-y-0.5" style={{ scrollbarWidth: 'thin' }}>
        {turns.length === 0 && isRunning && (
          <div className="flex items-center gap-2 py-2">
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
            <span className="text-[11px] text-tertiary-label">
              {specialist.currentActivity || 'Starting investigation...'}
            </span>
          </div>
        )}

        {turns.map((turn, i) => (
          <TurnItem
            key={i}
            turn={turn}
            isActive={isRunning && i === turns.length - 1}
            isRecent={i >= turns.length - 2}
            accentColor={specialist.color}
            verbose={false}
          />
        ))}

        {typingText && (
          <div className="text-[12px] text-secondary-label leading-relaxed py-1 opacity-70">
            {typingText.length > 120 ? typingText.slice(0, 120) + '...' : typingText}
          </div>
        )}
      </div>

      {/* Footer metrics */}
      <div
        className="flex items-center justify-between px-3 py-1.5 border-t text-[10px] text-tertiary-label"
        style={{ borderColor: `color-mix(in srgb, ${specialist.color} 15%, var(--color-separator))` }}
      >
        <span>{specialist.toolCalls} tool calls</span>
        {specialist.findingsCount > 0 && (
          <span style={{ color: specialist.color }}>{specialist.findingsCount} findings</span>
        )}
        <span>{specialist.status === 'complete' ? 'Complete' : `${progressPct}%`}</span>
      </div>
    </div>
  );
}
