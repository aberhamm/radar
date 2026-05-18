'use client';

import { useState } from 'react';
import type { StreamTurn } from '@/lib/runTransform';
import type { SpecialistState } from '@/lib/useLiveAnalysis';
import type { SpecialistDisplayMode } from '@/lib/useSpecialistDisplayMode';
import { SpecialistInlineChip } from './SpecialistInlineChip';
import { SpecialistInlineCard } from './SpecialistInlineCard';
import { SpecialistModal } from './SpecialistModal';
import { SpecialistSlidePanel } from './SpecialistSlidePanel';

interface SpecialistDisplayProps {
  specialist: SpecialistState;
  turns: StreamTurn[];
  typingText?: string;
  mode: SpecialistDisplayMode;
  accentColor: string;
}

export function SpecialistDisplay({ specialist, turns, typingText, mode, accentColor }: SpecialistDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      data-component="SpecialistDisplay"
      className="flex flex-col gap-0 py-1.5"
      style={{ animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both' }}
    >
      {/* Chip always renders inline */}
      <div className="flex gap-2.5">
        <div
          data-timeline-dot
          className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 mt-[3px] relative z-[1]"
          style={{
            background: `color-mix(in srgb, ${specialist.color} 12%, var(--color-surface))`,
            boxShadow: `0 0 0 1px color-mix(in srgb, ${specialist.color} 30%, transparent)`,
          }}
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="3" stroke={specialist.color} strokeWidth="1.5" fill="none" />
            <circle cx="6" cy="6" r="1" fill={specialist.color} />
          </svg>
        </div>
        <SpecialistInlineChip
          specialist={specialist}
          mode={mode}
          isExpanded={isOpen}
          onToggle={() => setIsOpen(o => !o)}
        />
      </div>

      {/* Mode-specific detail view */}
      {mode === 'inline' && isOpen && (
        <SpecialistInlineCard
          specialist={specialist}
          turns={turns}
          typingText={typingText}
          accentColor={accentColor}
        />
      )}

      {mode === 'modal' && (
        <SpecialistModal
          specialist={specialist}
          turns={turns}
          typingText={typingText}
          open={isOpen}
          onClose={() => setIsOpen(false)}
        />
      )}

      {mode === 'panel' && (
        <SpecialistSlidePanel
          specialist={specialist}
          turns={turns}
          typingText={typingText}
          open={isOpen}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}
