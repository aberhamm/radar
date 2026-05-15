'use client';

import type { SpecialistState } from '@/lib/useLiveAnalysis';
import { LaneGrid, type LanePill } from './LaneGrid';

interface SpecialistLaneGridProps {
  specialists: Map<string, SpecialistState>;
  selectedSpecialistId: string | null;
  onSelectSpecialist: (id: string | null) => void;
}

export function SpecialistLaneGrid({ specialists, selectedSpecialistId, onSelectSpecialist }: SpecialistLaneGridProps) {
  const CORE_ID = '__core__';

  const corePill: LanePill = {
    id: CORE_ID,
    name: 'Core',
    color: 'var(--color-tint)',
    isComplete: true,
    isActive: false,
    content: (
      <>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="w-[7px] h-[7px] rounded-full shrink-0"
              style={{ background: 'var(--color-success)' }}
            />
            <span
              className="text-[11px] font-semibold truncate"
              style={{ color: 'var(--color-success)' }}
            >
              Core
            </span>
          </div>
          <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--color-success)' }}>
            ✓
          </span>
        </div>
        <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--color-elevated)' }}>
          <div className="h-full rounded-full" style={{ width: '100%', background: 'var(--color-success)' }} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: 'var(--color-success)' }}>Complete</span>
        </div>
      </>
    ),
  };

  const specialistPills: LanePill[] = [...specialists.values()].map(s => {
    const isComplete = s.status === 'complete';
    const isActive = s.status === 'running';
    const isSkipped = s.status === 'skipped';

    return {
      id: s.id,
      name: s.name,
      color: s.color,
      isComplete,
      isActive,
      content: (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className="w-[7px] h-[7px] rounded-full shrink-0"
                style={{
                  background: isComplete ? 'var(--color-success)' : isSkipped ? 'var(--color-quaternary-label)' : s.color,
                  animation: isActive ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
                }}
              />
              <span
                className="text-[11px] font-semibold truncate"
                style={{ color: isComplete ? 'var(--color-success)' : isSkipped ? 'var(--color-quaternary-label)' : 'var(--color-label)' }}
              >
                {s.name.replace(' Specialist', '')}
              </span>
            </div>
            <span
              className="text-[10px] font-mono shrink-0"
              style={{ color: isComplete ? 'var(--color-success)' : 'var(--color-tertiary-label)' }}
            >
              {isSkipped ? '—' : isComplete ? `${s.toolCalls} ✓` : s.toolCalls > 0 ? String(s.toolCalls) : ''}
            </span>
          </div>

          <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'var(--color-elevated)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: isComplete ? '100%' : isSkipped ? '0%' : s.budget > 0 ? `${Math.min(100, Math.round((s.toolCalls / s.budget) * 100))}%` : '50%',
                background: isComplete ? 'var(--color-success)' : s.color,
                transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[10px] flex items-center gap-1" style={{ color: isComplete ? 'var(--color-success)' : 'var(--color-quaternary-label)' }}>
              {isActive && (
                <span className="inline-flex gap-[2px]">
                  {[0, 0.15, 0.3].map(delay => (
                    <span
                      key={delay}
                      className="w-[3px] h-[3px] rounded-full"
                      style={{
                        background: s.color,
                        animation: `pulse-dot 1.2s ease-in-out infinite`,
                        animationDelay: `${delay}s`,
                      }}
                    />
                  ))}
                </span>
              )}
              {isComplete ? 'Complete' : isActive ? (s.currentActivity || 'investigating...') : isSkipped ? 'Skipped' : ''}
            </span>
            {s.findingsCount > 0 && (
              <span
                className="text-[10px] font-semibold px-1.5 rounded-md"
                style={{
                  background: `color-mix(in srgb, ${s.color} 12%, transparent)`,
                  color: s.color,
                }}
              >
                {s.findingsCount}
              </span>
            )}
          </div>
        </>
      ),
    };
  });

  const allPills = [corePill, ...specialistPills];
  const effectiveSelectedId = selectedSpecialistId === null ? CORE_ID : selectedSpecialistId;

  return (
    <LaneGrid
      pills={allPills}
      selectedId={effectiveSelectedId}
      onSelect={(id) => onSelectSpecialist(id === CORE_ID ? null : id)}
    />
  );
}
