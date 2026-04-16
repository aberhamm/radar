'use client';

import Link from 'next/link';
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
  { id: 'report', label: 'Report' },
  { id: 'events', label: 'Events' },
  { id: 'rules', label: 'Rules' },
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

      {/* Spacer + bottom link */}
      <div className="flex-1" />
      <Link
        href="/how-it-works"
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[12px] text-tertiary-label hover:text-secondary-label hover:bg-surface transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="8" cy="8" r="6" />
          <path d="M6 6.5a2 2 0 0 1 3.94.5c0 1-1.44 1.5-1.44 1.5" />
          <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
        How It Works
      </Link>
    </div>
  );
}
