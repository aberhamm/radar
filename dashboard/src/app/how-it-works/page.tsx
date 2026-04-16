'use client';

import Link from 'next/link';
import { useTheme } from '@/lib/useTheme';
import { HowItWorksPanel } from '@/components/HowItWorksPanel';

export default function HowItWorksPage() {
  const { mode: themeMode, cycle: cycleTheme } = useTheme();

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-canvas">
      {/* Header — matches dashboard chrome */}
      <header className="bg-surface-translucent backdrop-blur-xl shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-4 h-12 flex items-center gap-3 sticky top-0 z-10 shrink-0">
        <Link
          href="/"
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors"
          title="Back to dashboard"
        >
          <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z" />
          </svg>
        </Link>

        <span className="text-[20px] font-bold text-tint tracking-[-0.02em] font-brand select-none whitespace-nowrap shrink-0">
          radar
        </span>

        <div className="ml-auto flex gap-2 items-center">
          <button
            onClick={cycleTheme}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors cursor-pointer"
            title={`Theme: ${themeMode}`}
            aria-label={`Switch theme, current: ${themeMode}`}
          >
            {themeMode === 'light' ? (
              <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : themeMode === 'dark' ? (
              <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-6 py-10">
          <HowItWorksPanel />
        </div>
      </main>
    </div>
  );
}
