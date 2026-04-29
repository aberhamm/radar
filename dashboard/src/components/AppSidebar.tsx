'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  LayoutDashboard,
  History,
  Search,
  FileText,
  Settings,
} from 'lucide-react';
import type { UrlView } from '@/lib/useUrlState';

// ─── Feature flag ──────────────────────────────────────────────
export const USE_SIDEBAR_V2 = true;

// ─── Animation ─────────────────────────────────────────────────
const spring = 'cubic-bezier(0.16, 1, 0.3, 1)';

// ─── Types ─────────────────────────────────────────────────────

export type NavSection = 'dashboard' | 'runs' | 'findings' | 'reports' | 'settings';

const NAV_ITEMS: { id: NavSection; icon: typeof LayoutDashboard; label: string }[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'runs', icon: History, label: 'Runs' },
  { id: 'findings', icon: Search, label: 'Findings' },
  { id: 'reports', icon: FileText, label: 'Reports' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export interface AppSidebarProps {
  open: boolean;
  collapsed: boolean;
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  onClose: () => void;
}

// ─── Nav item ─────────────────────────────────────────────────

function NavItem({
  icon: Icon,
  label,
  isActive,
  isCollapsed,
  onClick,
}: {
  icon: typeof LayoutDashboard;
  label: string;
  isActive: boolean;
  isCollapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={isCollapsed ? label : undefined}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      onClick={onClick}
      className={`relative flex items-center gap-3 rounded-lg min-h-[40px] transition-all cursor-pointer ${
        isCollapsed ? 'justify-center w-10 mx-auto' : 'px-3 w-full'
      } ${
        isActive
          ? 'text-[var(--color-tint)] font-semibold'
          : 'text-[var(--color-label)] hover:bg-[var(--color-elevated)]'
      }`}
      style={{ transitionTimingFunction: spring }}
    >
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-[var(--color-tint)]" />
      )}
      <Icon className="w-[18px] h-[18px] shrink-0" strokeWidth={isActive ? 2 : 1.5} />
      {!isCollapsed && (
        <span className="text-sm truncate">{label}</span>
      )}
    </button>
  );
}

// ─── AppSidebar ────────────────────────────────────────────────

export function AppSidebar({
  open,
  collapsed,
  activeSection,
  onNavigate,
  onClose,
}: AppSidebarProps) {
  const sidebarWidth = collapsed ? 64 : 155;

  return (
    <>
      {/* Backdrop for mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-sm z-20 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        data-component="AppSidebar"
        role="navigation"
        aria-label="Main navigation"
        className="flex flex-col shrink-0 overflow-hidden z-30 transition-all duration-300 h-full fixed lg:relative bg-sidebar border-r border-sidebar-border"
        style={{
          width: open ? sidebarWidth : 0,
          transitionTimingFunction: spring,
        }}
      >
        <div
          className="flex flex-col h-full overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          {/* Brand header */}
          <div className={`flex items-center shrink-0 h-12 ${collapsed ? 'justify-center' : 'px-4'}`}>
            {collapsed ? (
              <span className="text-[18px] font-bold text-brand font-brand select-none">
                R
              </span>
            ) : (
              <span className="text-[18px] font-bold text-brand tracking-[-0.02em] font-brand select-none">
                radar
              </span>
            )}
          </div>

          {/* Navigation */}
          <nav className={`flex flex-col gap-0.5 flex-1 ${collapsed ? 'px-2' : 'px-2'} py-2`}>
            {NAV_ITEMS.map(({ id, icon, label }) => (
              <NavItem
                key={id}
                icon={icon}
                label={label}
                isActive={activeSection === id}
                isCollapsed={collapsed}
                onClick={() => onNavigate(id)}
              />
            ))}
          </nav>

        </div>
      </aside>
    </>
  );
}

// ─── Helper: derive active section from URL view ──────────────

export function deriveActiveSection(urlView: UrlView): NavSection {
  switch (urlView.view) {
    case 'idle':
      return 'dashboard';
    case 'runs':
    case 'run':
    case 'multi':
    case 'compare':
      return 'runs';
    case 'findings':
      return 'findings';
    case 'reports':
      return 'reports';
    case 'settings':
      return 'settings';
    case 'info':
      return 'dashboard';
    default:
      return 'dashboard';
  }
}

export default AppSidebar;
