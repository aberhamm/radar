'use client';

import type { Tab } from '@/lib/useUrlState';

interface HomePanelProps {
  isRunning: boolean;
  currentRepoName?: string;
  currentGoal?: string;
  showSections?: boolean;
  activeTab?: Tab;
  onSectionClick?: (tab: Tab) => void;
}

const SECTIONS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'investigation', label: 'Investigation' },
  { id: 'cost', label: 'Cost' },
];

export function HomePanel({
  isRunning,
  currentRepoName,
  currentGoal,
  showSections,
  activeTab,
  onSectionClick,
}: HomePanelProps) {
  return (
    <div data-component="HomePanel" className="flex flex-col gap-3 h-full">
      {/* Current run card */}
      {isRunning && currentRepoName && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-tertiary-label font-semibold mb-2">
            Current
          </div>
          <div className="bg-surface rounded-lg shadow-sm border border-separator p-3">
            <div className="text-[13px] font-semibold text-label truncate">
              {currentRepoName}
            </div>
            {currentGoal && (
              <div className="text-[11px] text-tint font-medium mt-0.5 truncate">
                {currentGoal}
              </div>
            )}
            <div className="flex items-center gap-1.5 mt-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full bg-success shrink-0"
                style={{ animation: 'pulse-dot 2s ease-in-out infinite' }}
              />
              <span className="text-[10px] text-success font-medium">Running</span>
            </div>
          </div>
        </div>
      )}

      {/* Section navigation */}
      {showSections && onSectionClick && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-tertiary-label font-semibold mb-2">
            Sections
          </div>
          <div className="flex flex-col gap-0.5">
            {SECTIONS.map(section => (
              <button
                key={section.id}
                onClick={() => onSectionClick(section.id)}
                className={`text-left rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors cursor-pointer ${
                  activeTab === section.id
                    ? 'bg-[rgb(0_113_227/0.08)] text-tint'
                    : 'text-secondary-label hover:text-label hover:bg-surface'
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
