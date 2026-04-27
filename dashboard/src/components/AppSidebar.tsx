'use client';

import { useState, useCallback } from 'react';
import type { SidebarProps } from '@/components/Sidebar';
import { HomePanel } from '@/components/sidebar/HomePanel';
import { HistoryPanel } from '@/components/sidebar/HistoryPanel';
import { InfoPanel } from '@/components/sidebar/InfoPanel';
import { SettingsPanel } from '@/components/sidebar/SettingsPanel';

// ─── Feature flag ──────────────────────────────────────────────
export const USE_SIDEBAR_V2 = true;

// ─── Animation ─────────────────────────────────────────────────
const spring = 'cubic-bezier(0.16, 1, 0.3, 1)';

// ─── Icon helpers ──────────────────────────────────────────────

function IconHome({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6.5L8 2l6 4.5V13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6.5z" />
      <path d="M6 14V9h4v5" />
    </svg>
  );
}

function IconHistory({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

function IconSettings({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M13.5 8a5.5 5.5 0 0 0-.08-.88l1.36-1.06-.68-1.18-1.6.54a5.4 5.4 0 0 0-1.52-.88L10.6 3H9.24l-.38 1.54a5.4 5.4 0 0 0-1.52.88l-1.6-.54-.68 1.18 1.36 1.06A5.5 5.5 0 0 0 6.34 7a5.5 5.5 0 0 0 .08.88l-1.36 1.06.68 1.18 1.6-.54c.44.38.96.68 1.52.88L9.24 12h1.36l.38-1.54a5.4 5.4 0 0 0 1.52-.88l1.6.54.68-1.18-1.36-1.06c.06-.28.08-.58.08-.88z" />
    </svg>
  );
}

function IconInfo({ className = '' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 ${className}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7v4M8 5.5v-.01" />
    </svg>
  );
}

// ─── Types ─────────────────────────────────────────────────────

type Section = 'home' | 'history' | 'info' | 'settings';

const NAV_ITEMS: { id: Section; icon: typeof IconHome; label: string }[] = [
  { id: 'home', icon: IconHome, label: 'Home' },
  { id: 'history', icon: IconHistory, label: 'History' },
  { id: 'info', icon: IconInfo, label: 'Info' },
];

// ─── Rail button ───────────────────────────────────────────────

function RailButton({
  children,
  isActive = false,
  onClick,
  label,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`relative flex items-center justify-center rounded-lg size-10 min-w-10 transition-colors cursor-pointer ${
        isActive
          ? 'text-tint'
          : 'text-tertiary-label hover:text-secondary-label'
      }`}
      style={{ transitionTimingFunction: spring }}
      onClick={onClick}
    >
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-tint" />
      )}
      {children}
    </button>
  );
}

// ─── Icon rail ─────────────────────────────────────────────────

function IconRail({
  activeSection,
  onSectionClick,
}: {
  activeSection: Section;
  onSectionClick: (section: Section) => void;
}) {
  return (
    <div data-component="IconRail" className="bg-canvas border-r border-separator flex flex-col gap-1 items-center py-3 px-2 w-14 h-full shrink-0">
      {/* Brand mark */}
      <div className="mb-1 size-10 flex items-center justify-center">
        <span className="text-[16px] font-bold text-tint font-brand select-none">R</span>
      </div>

      {/* Nav icons */}
      <div className="flex flex-col gap-0.5 w-full items-center">
        {NAV_ITEMS.map(({ id, icon: Icon, label }) => (
          <RailButton
            key={id}
            isActive={activeSection === id}
            onClick={() => onSectionClick(id)}
            label={label}
          >
            <Icon />
          </RailButton>
        ))}
      </div>

      <div className="flex-1" />

      <RailButton
        isActive={activeSection === 'settings'}
        onClick={() => onSectionClick('settings')}
        label="Settings"
      >
        <IconSettings />
      </RailButton>
    </div>
  );
}

// ─── Detail panel ──────────────────────────────────────────────

function DetailPanel({
  activeSection,
  isCollapsed,
  props,
}: {
  activeSection: Section;
  isCollapsed: boolean;
  props: SidebarProps;
}) {
  return (
    <div
      data-component="DetailPanel"
      className={`bg-canvas border-r border-separator flex flex-col shrink-0 overflow-hidden transition-all duration-300 h-full ${
        isCollapsed ? 'w-0' : 'w-[184px]'
      }`}
      style={{ transitionTimingFunction: spring }}
    >
      <div className="w-[184px] flex flex-col h-full overflow-hidden px-3 pt-3">
        {activeSection === 'home' && (
          <HomePanel
            isRunning={props.isRunning}
            currentRepoName={props.currentRepoName}
            currentGoal={props.currentGoal}
            showSections={props.showSections}
            activeTab={props.activeTab}
            onSectionClick={props.onSectionClick}
          />
        )}

        {activeSection === 'history' && (
          <HistoryPanel
            history={props.history}
            activeRunId={props.activeRunId}
            isRunning={props.isRunning}
            onSelectHistory={props.onSelectHistory}
            onPrefetch={props.onPrefetch}
            compareMode={props.compareMode}
            compareSelections={props.compareSelections}
            onToggleCompare={props.onToggleCompare}
            onCompareSelect={props.onCompareSelect}
            onCompare={props.onCompare}
            hasMore={props.hasMore}
            onLoadMore={props.onLoadMore}
            compareHighlight={props.compareHighlight}
          />
        )}

        {activeSection === 'info' && (
          <InfoPanel
            activePage={props.activeInfoPage}
            onNavigate={(page) => props.onInfoNavigate?.(page)}
          />
        )}

        {activeSection === 'settings' && <SettingsPanel />}
      </div>
    </div>
  );
}

// ─── AppSidebar ────────────────────────────────────────────────

export function AppSidebar(props: SidebarProps) {
  const [activeSection, setActiveSection] = useState<Section>('history');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleSectionClick = useCallback((section: Section) => {
    if (section === activeSection) {
      // Toggle collapse when clicking the active section
      setIsCollapsed(prev => !prev);
    } else {
      // Switch section and ensure expanded
      setActiveSection(section);
      setIsCollapsed(false);
    }
  }, [activeSection]);

  return (
    <>
      {/* Backdrop for mobile */}
      {props.open && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-20 lg:hidden"
          onClick={props.onClose}
        />
      )}

      <aside
        data-component="AppSidebar"
        role="navigation"
        aria-label="Run history"
        className={`flex shrink-0 overflow-hidden z-30 transition-all duration-300 h-full fixed lg:relative ${
          props.open ? (isCollapsed ? 'w-14' : 'w-[240px]') : 'w-0'
        }`}
        style={{ transitionTimingFunction: spring }}
      >
        <IconRail activeSection={activeSection} onSectionClick={handleSectionClick} />
        <DetailPanel activeSection={activeSection} isCollapsed={isCollapsed} props={props} />
      </aside>
    </>
  );
}

export default AppSidebar;
