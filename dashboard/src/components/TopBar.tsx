'use client';

import type { ThemeMode } from '@/lib/useTheme';

interface TopBarProps {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  hasHistory: boolean;
  themeMode: ThemeMode;
  onCycleTheme: () => void;
}

export function TopBar({ onToggleSidebar, sidebarOpen, hasHistory, themeMode, onCycleTheme }: TopBarProps) {
  return (
    <header className="bg-surface-translucent backdrop-blur-xl shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-4 h-12 flex items-center gap-3 sticky top-0 z-10 shrink-0">
      {/* Sidebar toggle */}
      {hasHistory && (
        <button
          onClick={onToggleSidebar}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors cursor-pointer"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 16 16" fill="currentColor">
            <rect y="2" width="16" height="1.5" rx="0.75" />
            <rect y="7.25" width="16" height="1.5" rx="0.75" />
            <rect y="12.5" width="16" height="1.5" rx="0.75" />
          </svg>
        </button>
      )}

      {/* Brand */}
      <span className="text-[17px] font-bold text-tint tracking-tight font-brand select-none whitespace-nowrap shrink-0">
        radar
      </span>

      <div className="ml-auto flex gap-3 items-center">
        {/* Theme toggle */}
        <button
          onClick={onCycleTheme}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors cursor-pointer"
          title={`Theme: ${themeMode}`}
        >
          {themeMode === 'light' ? (
            <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          ) : themeMode === 'dark' ? (
            <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
