'use client';

import { useState, useRef, useEffect } from 'react';
import type { Activity } from '@/lib/runTransform';

// ─── Activity Chip (button only — expanded content rendered by group) ────

export function ActivityChipButton({
  activity,
  active,
  accentColor,
  expanded,
  onToggle,
  index,
}: {
  activity: Activity;
  active: boolean;
  accentColor: string;
  expanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  const hasContent = activity.files.length > 0 || !!activity.detail;
  const [justCompleted, setJustCompleted] = useState(false);
  const [entered, setEntered] = useState(false);
  const wasActive = useRef(active);

  // Mark entrance animation as done (only runs once on mount)
  useEffect(() => {
    const timer = setTimeout(() => setEntered(true), 350 + index * 50);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect active→completed transition for pop animation
  useEffect(() => {
    if (wasActive.current && !active) {
      setJustCompleted(true);
      const timer = setTimeout(() => setJustCompleted(false), 350);
      return () => clearTimeout(timer);
    }
    wasActive.current = active;
  }, [active]);

  return (
    <button
      type="button"
      onClick={hasContent ? onToggle : undefined}
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg text-left ${hasContent ? 'cursor-pointer' : 'cursor-default'}`}
      style={{
        ...(active ? {
          background: `color-mix(in srgb, ${accentColor} 8%, transparent)`,
          color: accentColor,
        } : {
          background: expanded ? `color-mix(in srgb, ${accentColor} 6%, var(--color-elevated))` : 'var(--color-elevated)',
          color: expanded ? 'var(--color-secondary-label)' : 'var(--color-secondary-label)',
        }),
        ...(!entered ? { animation: `chip-enter 0.3s cubic-bezier(0.16, 1, 0.3, 1) ${index * 50}ms both` } : {}),
        transition: 'background 0.3s ease, color 0.3s ease',
      }}
    >
      {active ? (
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: accentColor, animation: 'pulse-dot 1s ease-in-out infinite' }}
        />
      ) : (
        <svg
          width="10" height="10" viewBox="0 0 12 12" fill="none"
          className="shrink-0"
          style={justCompleted ? { animation: 'check-pop 0.4s cubic-bezier(0.16, 1, 0.3, 1) both' } : undefined}
        >
          <path d="M2.5 6.5L5 9l4.5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            style={justCompleted ? {
              strokeDasharray: 12,
              strokeDashoffset: 12,
              animation: 'check-draw 0.3s cubic-bezier(0.16, 1, 0.3, 1) 0.1s forwards',
            } : undefined}
          />
        </svg>
      )}
      {activity.label}
      {hasContent && (
        <svg
          width="8" height="8" viewBox="0 0 8 8" fill="none"
          className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

// ─── Activity Chip Group (accordion — one expanded at a time, full-width detail) ──

export function ActivityChipGroup({
  activities,
  active,
  accentColor,
}: {
  activities: Activity[];
  active: boolean;
  accentColor: string;
}) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const handleToggle = (index: number) => {
    setExpandedIndex(prev => prev === index ? null : index);
  };

  const expandedActivity = expandedIndex !== null ? activities[expandedIndex] : null;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap gap-1.5">
        {activities.map((act, ai) => (
          <ActivityChipButton
            key={ai}
            activity={act}
            active={active}
            accentColor={accentColor}
            expanded={expandedIndex === ai}
            onToggle={() => handleToggle(ai)}
            index={ai}
          />
        ))}
      </div>
      {expandedActivity && (expandedActivity.files.length > 0 || expandedActivity.detail) && (
        <div
          key={expandedIndex}
          className="mt-2 pl-3 border-l-2 space-y-1.5"
          style={{
            borderColor: active
              ? `color-mix(in srgb, ${accentColor} 20%, transparent)`
              : 'var(--color-separator)',
            animation: 'expand-down 0.25s cubic-bezier(0.16, 1, 0.3, 1) both',
            transformOrigin: 'top',
          }}
        >
          {expandedActivity.detail && (
            <div className="text-[11px] text-secondary-label leading-relaxed">
              {expandedActivity.detail}
            </div>
          )}
          {expandedActivity.files.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {expandedActivity.files.map((file, fi) => (
                <span
                  key={fi}
                  className="text-[9px] font-mono text-quaternary-label bg-canvas px-1.5 py-0.5 rounded"
                  style={{ animation: `chip-enter 0.2s cubic-bezier(0.16, 1, 0.3, 1) ${fi * 30}ms both` }}
                >
                  {file}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
