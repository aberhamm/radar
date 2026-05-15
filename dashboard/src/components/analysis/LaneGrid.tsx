'use client';

import type { ReactNode } from 'react';

export interface LanePill {
  id: string;
  name: string;
  color: string;
  isComplete: boolean;
  isActive: boolean;
  content: ReactNode;
}

interface LaneGridProps {
  pills: LanePill[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function LaneGrid({ pills, selectedId, onSelect }: LaneGridProps) {
  return (
    <div
      data-component="LaneGrid"
      className="flex gap-1.5 px-4 py-2.5 border-b border-separator bg-surface shrink-0 overflow-x-auto"
      style={{ scrollbarWidth: 'none' }}
    >
      {pills.map(pill => {
        const isSelected = pill.id === selectedId;

        return (
          <button
            key={pill.id}
            type="button"
            onClick={() => onSelect(pill.id)}
            className={`flex-1 min-w-[130px] max-w-[200px] px-3 py-2.5 rounded-lg border transition-all cursor-pointer flex flex-col gap-2 ${
              isSelected
                ? 'bg-surface border-[var(--worker-color)] shadow-card'
                : pill.isComplete
                  ? 'bg-canvas border-separator opacity-80 hover:opacity-100'
                  : 'bg-canvas border-separator hover:border-[var(--wc-half)]'
            }`}
            style={{
              '--worker-color': pill.color,
              '--wc-half': `color-mix(in srgb, ${pill.color} 40%, var(--color-separator))`,
            } as React.CSSProperties}
          >
            {pill.content}
          </button>
        );
      })}
    </div>
  );
}
