'use client';

import type React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { StreamTurn } from '@/lib/runTransform';
import { ActivityChipGroup } from '@/components/ActivityChip';

interface TurnItemProps {
  turn: StreamTurn;
  isActive: boolean;
  isRecent: boolean;
  accentColor: string;
  verbose: boolean;
}

function deriveIcon(
  isActive: boolean,
  isWrite: boolean,
  hasActivities: boolean,
  accentColor: string,
): { iconColor: string; icon: React.ReactNode } {
  if (isActive) {
    return {
      iconColor: accentColor,
      icon: (
        <div
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: accentColor, animation: 'pulse-dot 1.2s ease-in-out infinite' }}
        />
      ),
    };
  }
  if (isWrite) {
    return {
      iconColor: 'var(--color-success)',
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path
            d="M8.5 1.5l2 2L4 10H2v-2l6.5-6.5z"
            stroke="var(--color-success)"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    };
  }
  if (hasActivities) {
    return {
      iconColor: 'var(--color-tertiary-label)',
      icon: (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    };
  }
  return {
    iconColor: 'var(--color-tertiary-label)',
    icon: (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M2.5 6.5L5 9l4.5-6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  };
}

export function TurnItem({ turn, isActive, isRecent, accentColor, verbose }: TurnItemProps) {
  const isWrite = turn.phase === 'write';
  const hasActivities = turn.activities.length > 0;
  const { iconColor, icon } = deriveIcon(isActive, isWrite, hasActivities, accentColor);

  return (
    <div
      data-component="ReasoningTurn"
      className={`flex gap-2.5 py-2 transition-opacity duration-300 ${isRecent ? 'opacity-100' : 'opacity-40 hover:opacity-100 focus-within:opacity-100'}`}
    >
      {/* Status icon waypoint */}
      <div
        data-component="TurnIcon"
        data-timeline-dot
        className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 mt-[3px] relative z-[1] transition-all duration-300"
        style={{
          background: isActive
            ? `color-mix(in srgb, ${accentColor} 12%, var(--color-surface))`
            : 'var(--color-surface)',
          color: iconColor,
          boxShadow: isActive
            ? `0 0 0 2px color-mix(in srgb, ${accentColor} 20%, transparent)`
            : '0 0 0 1px var(--color-separator)',
        }}
      >
        {icon}
      </div>

      {/* Turn content */}
      <div data-component="TurnContent" className="flex-1 min-w-0">
        {turn.reasoning && (
          <div
            className={`md-content text-[13px] leading-relaxed ${
              isWrite ? 'text-success' : 'text-secondary-label'
            }`}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {verbose
                ? turn.reasoning
                : turn.reasoning.length > 150
                  ? turn.reasoning.slice(0, 150) + '…'
                  : turn.reasoning}
            </ReactMarkdown>
          </div>
        )}

        {hasActivities && (
          <ActivityChipGroup
            activities={turn.activities}
            active={isActive}
            accentColor={accentColor}
          />
        )}
      </div>
    </div>
  );
}
