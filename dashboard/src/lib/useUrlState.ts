'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────

export type Tab = 'report' | 'events' | 'rules' | 'cost';

export type UrlView =
  | { view: 'idle' }
  | { view: 'run'; runId: string; tab?: Tab }
  | { view: 'compare'; compareIds: [string, string] }
  | { view: 'multi'; parentId: string };

const VALID_TABS = new Set<Tab>(['report', 'events', 'rules', 'cost']);

// ─── Pure Functions ─────────────────────────────────────────────

/** Parse a pathname + search params into a UrlView. */
export function parseUrl(pathname: string, searchParams?: URLSearchParams): UrlView {
  const segments = pathname.split('/').filter(Boolean);

  if (segments.length === 0) {
    return { view: 'idle' };
  }

  if (segments[0] === 'run' && segments[1]) {
    const tab = searchParams?.get('tab') as Tab | null;
    return {
      view: 'run',
      runId: segments[1],
      tab: tab && VALID_TABS.has(tab) ? tab : undefined,
    };
  }

  if (segments[0] === 'compare' && segments[1] && segments[2]) {
    return {
      view: 'compare',
      compareIds: [segments[1], segments[2]],
    };
  }

  if (segments[0] === 'multi' && segments[1]) {
    return {
      view: 'multi',
      parentId: segments[1],
    };
  }

  // Unknown path → idle (will redirect)
  return { view: 'idle' };
}

/** Build a URL string from a UrlView. */
export function buildUrl(state: UrlView): string {
  switch (state.view) {
    case 'idle':
      return '/';
    case 'run': {
      const base = `/run/${state.runId}`;
      return state.tab && state.tab !== 'report' ? `${base}?tab=${state.tab}` : base;
    }
    case 'compare':
      return `/compare/${state.compareIds[0]}/${state.compareIds[1]}`;
    case 'multi':
      return `/multi/${state.parentId}`;
  }
}

// ─── Hook ───────────────────────────────────────────────────────

export interface UseUrlStateReturn {
  /** Current parsed view from URL. */
  urlView: UrlView;
  /** Push a new URL (adds to browser history). */
  pushUrl: (state: UrlView) => void;
  /** Replace current URL (no new history entry). */
  replaceUrl: (state: UrlView) => void;
}

export function useUrlState(): UseUrlStateReturn {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selfNavigated = useRef(false);

  const urlView = parseUrl(pathname, searchParams);

  const pushUrl = useCallback((state: UrlView) => {
    const url = buildUrl(state);
    if (url !== window.location.pathname + window.location.search) {
      selfNavigated.current = true;
      window.history.pushState(null, '', url);
    }
  }, []);

  const replaceUrl = useCallback((state: UrlView) => {
    const url = buildUrl(state);
    selfNavigated.current = true;
    window.history.replaceState(null, '', url);
  }, []);

  // Reset the self-navigated flag after Next.js processes the URL change
  useEffect(() => {
    selfNavigated.current = false;
  }, [pathname, searchParams]);

  return { urlView, pushUrl, replaceUrl };
}
