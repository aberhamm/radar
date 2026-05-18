'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import type { StreamTurn } from '@/lib/runTransform';
import type { SpecialistState } from '@/lib/useLiveAnalysis';
import { TurnItem } from './TurnItem';

interface SpecialistModalProps {
  specialist: SpecialistState;
  turns: StreamTurn[];
  typingText?: string;
  open: boolean;
  onClose: () => void;
}

export function SpecialistModal({ specialist, turns, typingText, open, onClose }: SpecialistModalProps) {
  const isRunning = specialist.status === 'running';
  const progressPct = specialist.budget > 0
    ? Math.min(100, Math.round((specialist.toolCalls / specialist.budget) * 100))
    : (isRunning ? 50 : 100);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          className="fixed inset-0 z-50 bg-black/20 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-2xl max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-popover ring-1 ring-foreground/10 shadow-xl flex flex-col outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3.5 border-b shrink-0"
            style={{ borderColor: `color-mix(in srgb, ${specialist.color} 20%, var(--color-separator))` }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  background: specialist.status === 'complete' ? 'var(--color-success)' : specialist.color,
                  animation: isRunning ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
                }}
              />
              <span className="text-sm font-semibold text-label">{specialist.name}</span>
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  background: specialist.status === 'complete'
                    ? 'color-mix(in srgb, var(--color-success) 12%, transparent)'
                    : `color-mix(in srgb, ${specialist.color} 12%, transparent)`,
                  color: specialist.status === 'complete' ? 'var(--color-success)' : specialist.color,
                }}
              >
                {specialist.status}
              </span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 rounded-md flex items-center justify-center text-tertiary-label hover:text-label hover:bg-elevated transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1" style={{ scrollbarWidth: 'thin' }}>
            {turns.length === 0 && isRunning && (
              <div className="flex items-center gap-2 py-4 justify-center">
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
                <span className="text-xs text-tertiary-label">
                  {specialist.currentActivity || 'Starting investigation...'}
                </span>
              </div>
            )}

            {turns.map((turn, i) => (
              <TurnItem
                key={i}
                turn={turn}
                isActive={isRunning && i === turns.length - 1}
                isRecent={i >= turns.length - 3}
                accentColor={specialist.color}
                verbose={true}
              />
            ))}

            {typingText && (
              <div className="text-[13px] text-secondary-label leading-relaxed py-2 opacity-70">
                {typingText}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-5 py-3 border-t shrink-0"
            style={{ borderColor: `color-mix(in srgb, ${specialist.color} 15%, var(--color-separator))` }}
          >
            <div className="flex items-center gap-4 text-[11px] text-tertiary-label">
              <span>{specialist.toolCalls} tool calls</span>
              {specialist.findingsCount > 0 && (
                <span style={{ color: specialist.color }}>{specialist.findingsCount} findings</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 h-[4px] rounded-full overflow-hidden" style={{ background: 'var(--color-elevated)' }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${progressPct}%`,
                    background: specialist.status === 'complete' ? 'var(--color-success)' : specialist.color,
                    transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-quaternary-label">{progressPct}%</span>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
