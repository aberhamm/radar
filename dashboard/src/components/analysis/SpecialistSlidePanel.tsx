'use client';

import { useEffect, useCallback } from 'react';
import type { StreamTurn } from '@/lib/runTransform';
import type { SpecialistState } from '@/lib/useLiveAnalysis';
import { TurnItem } from './TurnItem';

interface SpecialistSlidePanelProps {
  specialist: SpecialistState;
  turns: StreamTurn[];
  typingText?: string;
  open: boolean;
  onClose: () => void;
}

export function SpecialistSlidePanel({ specialist, turns, typingText, open, onClose }: SpecialistSlidePanelProps) {
  const isRunning = specialist.status === 'running';
  const progressPct = specialist.budget > 0
    ? Math.min(100, Math.round((specialist.toolCalls / specialist.budget) * 100))
    : (isRunning ? 50 : 100);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/10"
        onClick={onClose}
        style={{ animation: 'fadeIn 0.15s ease both' }}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 bottom-0 z-50 w-[420px] max-w-[90vw] bg-surface border-l border-separator shadow-xl flex flex-col"
        style={{ animation: 'slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) both' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3.5 border-b shrink-0"
          style={{ borderColor: `color-mix(in srgb, ${specialist.color} 20%, var(--color-separator))` }}
        >
          <div className="flex items-center gap-2.5">
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

        {/* Progress bar */}
        <div className="h-[3px] w-full shrink-0" style={{ background: 'var(--color-elevated)' }}>
          <div
            className="h-full"
            style={{
              width: `${progressPct}%`,
              background: specialist.status === 'complete' ? 'var(--color-success)' : specialist.color,
              transition: 'width 1s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1" style={{ scrollbarWidth: 'thin' }}>
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
          className="flex items-center justify-between px-4 py-3 border-t shrink-0"
          style={{ borderColor: `color-mix(in srgb, ${specialist.color} 15%, var(--color-separator))` }}
        >
          <div className="flex items-center gap-4 text-[11px] text-tertiary-label">
            <span>{specialist.toolCalls} tool calls</span>
            {specialist.findingsCount > 0 && (
              <span style={{ color: specialist.color }}>{specialist.findingsCount} findings</span>
            )}
          </div>
          <span className="text-[10px] font-mono text-quaternary-label">{progressPct}%</span>
        </div>
      </div>
    </>
  );
}
