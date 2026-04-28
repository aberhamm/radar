'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// ─── Types ──────────────────────────────────────────────────────

export type Tab = 'overview' | 'investigation' | 'cost';

export type InfoPage = 'how-it-works' | 'changelog';

export type UrlView =
  | { view: 'idle' }
  | { view: 'run'; runId: string; tab?: Tab }
  | { view: 'compare'; compareIds: [string, string] }
  | { view: 'multi'; parentId: string; tab?: Tab }
  | { view: 'info'; page: InfoPage };

const VALID_TABS = new Set<Tab>(['overview', 'investigation', 'cost']);

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
    const tab = searchParams?.get('tab') as Tab | null;
    return {
      view: 'multi',
      parentId: segments[1],
      tab: tab && VALID_TABS.has(tab) ? tab : undefined,
    };
  }

  if (segments[0] === 'how-it-works' || segments[0] === 'changelog') {
    return { view: 'info', page: segments[0] };
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
      return state.tab && state.tab !== 'overview' ? `${base}?tab=${state.tab}` : base;
    }
    case 'compare':
      return `/compare/${state.compareIds[0]}/${state.compareIds[1]}`;
    case 'multi': {
      const base = `/multi/${state.parentId}`;
      return state.tab && state.tab !== 'overview' ? `${base}?tab=${state.tab}` : base;
    }
    case 'info':
      return `/${state.page}`;
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

  // Memoize urlView so it only changes when the URL actually changes.
  // Without this, parseUrl() returns a new object reference every render,
  // causing any useEffect([urlView]) to fire on every render — which
  // creates an infinite loop when pushState URL updates arrive in a
  // later React transition than the accompanying setState calls.
  const searchStr = searchParams?.toString() ?? '';
  const urlView = useMemo(() => parseUrl(pathname, searchParams), [pathname, searchStr]); // eslint-disable-line react-hooks/exhaustive-deps

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
