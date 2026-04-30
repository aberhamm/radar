'use client';

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';

// ─── Types ──────────────────────────────────────────────────────

export type Tab = 'overview' | 'investigation' | 'cost';

export type InfoPage = 'how-it-works' | 'changelog';

export type UrlView =
  | { view: 'idle' }
  | { view: 'run'; runId: string; tab?: Tab }
  | { view: 'compare'; compareIds: [string, string] }
  | { view: 'multi'; parentId: string; tab?: Tab }
  | { view: 'info'; page: InfoPage }
  | { view: 'runs' }
  | { view: 'findings'; runId?: string; findingId?: string }
  | { view: 'reports' }
  | { view: 'settings' };

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

  if (segments[0] === 'runs') {
    return { view: 'runs' };
  }

  if (segments[0] === 'findings') {
    return { view: 'findings', runId: segments[1], findingId: segments[2] };
  }

  if (segments[0] === 'reports') {
    return { view: 'reports' };
  }

  if (segments[0] === 'settings') {
    return { view: 'settings' };
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
    case 'runs':
      return '/runs';
    case 'findings': {
      if (state.runId && state.findingId) return `/findings/${state.runId}/${state.findingId}`;
      if (state.runId) return `/findings/${state.runId}`;
      return '/findings';
    }
    case 'reports':
      return '/reports';
    case 'settings':
      return '/settings';
  }
}

// ─── Vanilla URL store (bypasses Next.js RSC pipeline) ───────────
//
// This app is a single-page catch-all ([[...slug]]). All navigation
// is client-side state. Next.js App Router patches history.pushState
// and triggers an RSC fetch on every pathname change — we avoid that
// by spreading the existing history.state (preserves Next.js internal
// tree for back/forward) and setting __NA so the patched pushState
// calls the original directly without triggering applyUrlFromHistory.

let listeners: Array<() => void> = [];
let currentUrl = typeof window !== 'undefined'
  ? window.location.pathname + window.location.search
  : '/';

function subscribe(listener: () => void) {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

function getSnapshot() {
  return currentUrl;
}

function getServerSnapshot() {
  return '/';
}

function notify() {
  currentUrl = window.location.pathname + window.location.search;
  for (const listener of listeners) listener();
}

function spaHistoryState() {
  return { ...window.history.state, __NA: true };
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
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
  const url = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const urlView = useMemo(() => {
    const qIdx = url.indexOf('?');
    const pathname = qIdx >= 0 ? url.slice(0, qIdx) : url;
    const search = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : undefined;
    return parseUrl(pathname, search);
  }, [url]);

  const prevUrlRef = useRef(url);

  const pushUrl = useCallback((state: UrlView) => {
    const next = buildUrl(state);
    if (next !== prevUrlRef.current) {
      window.history.pushState(spaHistoryState(), '', next);
      prevUrlRef.current = next;
      notify();
    }
  }, []);

  const replaceUrl = useCallback((state: UrlView) => {
    const next = buildUrl(state);
    window.history.replaceState(spaHistoryState(), '', next);
    prevUrlRef.current = next;
    notify();
  }, []);

  return { urlView, pushUrl, replaceUrl };
}
