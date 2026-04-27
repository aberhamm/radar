'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { StepEvent, Scorecard, RunMetrics, HistoryItem } from '@/lib/agentSession';
import { useKeyboardShortcuts } from '@/lib/useKeyboardShortcuts';
import { useTheme } from '@/lib/useTheme';
import { useUrlState, buildUrl, type Tab, type MultiTab, type InfoPage } from '@/lib/useUrlState';
import { ContextBar } from '@/components/ContextBar';
import { Sidebar } from '@/components/Sidebar';
import { AppSidebar, USE_SIDEBAR_V2 } from '@/components/AppSidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { IdleView } from '@/components/IdleView';
import { CompleteView } from '@/components/CompleteView';
import { CompareView, type CompareData } from '@/components/CompareView';
import { AnalysisView } from '@/components/AnalysisView';
import { MultiGoalView, type MultiGoalData } from '@/components/MultiGoalView';
import { RunLoadingSkeleton } from '@/components/Skeleton';
import { HowItWorksPanel } from '@/components/HowItWorksPanel';
import { ChangelogView } from '@/components/ChangelogView';
import { useEventSource } from '@/lib/useEventSource';
import { useLiveAnalysis } from '@/lib/useLiveAnalysis';
import type { TransformedRunData } from '@/lib/runTransform';

// ─── Constants ──────────────────────────────────────────────────

const SAMPLE_RUN_ID = '__sample__';

const SAMPLE_HISTORY_ITEM = {
  id: SAMPLE_RUN_ID,
  goal: 'onboarding',
  repoName: 'Demo Run',
  startedAt: '2026-04-02T18:25:21.344Z',
  completedAt: '2026-04-02T18:30:45.000Z',
  hasResult: true,
};

// ─── Helpers ─────────────────────────────────────────────────────

function friendlyError(raw: string): string {
  if (!raw) return 'Something went wrong during the analysis. Please try again.';
  if (raw.includes('ENOENT') || raw.includes('not found'))
    return 'The repository path could not be found. Double-check the path or URL and try again.';
  if (raw.includes('timeout') || raw.includes('ETIMEDOUT'))
    return 'The analysis timed out. This can happen with very large repositories. Try a more specific goal.';
  if (raw.includes('ECONNREFUSED') || raw.includes('network'))
    return 'Could not connect to the analysis server. Make sure the backend is running.';
  if (raw.includes('budget') || raw.includes('limit'))
    return 'The analysis exceeded its resource budget. Try increasing the budget or using a narrower goal.';
  return 'The analysis encountered an unexpected error. Please try again.';
}

// ─── Types ──────────────────────────────────────────────────────

type DashboardStatus = 'idle' | 'running' | 'budget_paused' | 'complete' | 'error' | 'comparing' | 'multigoal' | 'info';

interface CurrentRun {
  repoPath: string;
  repoName: string;
  goal: string;
  startedAt: Date;
  events: StepEvent[];
  toolCalls: number;
  budget: number;
}

interface CompletedResult {
  scorecard: Scorecard;
  metrics: RunMetrics;
  terminationReason: string;
  briefMarkdown: string;
  state?: { findings: unknown[] };
}

// ─── Page ───────────────────────────────────────────────────────

export default function DashboardPage() {
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [currentRun, setCurrentRun] = useState<CurrentRun | null>(null);
  const [result, setResult] = useState<CompletedResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [budgetPausedData, setBudgetPausedData] = useState<{
    findings: number;
    toolCalls: number;
    budget: number;
  } | null>(null);
  const [lastRepoPath, setLastRepoPath] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth >= 1024;
    return true;
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newRunModal, setNewRunModal] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelections, setCompareSelections] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<CompareData | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [multiGoalData, setMultiGoalData] = useState<MultiGoalData | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [sampleInvestigation, setSampleInvestigation] = useState<TransformedRunData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [multiTab, setMultiTab] = useState<MultiTab>('overview');
  const [activeInfoPage, setActiveInfoPage] = useState<InfoPage | undefined>(undefined);
  const { mode: themeMode, cycle: cycleTheme, setMode: setThemeMode } = useTheme();
  const { urlView, pushUrl, replaceUrl } = useUrlState();
  const urlHandledRef = useRef(false);

  // Cache loaded runs to avoid re-fetching on re-selection.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runCacheRef = useRef(new Map<string, {
    repoName: string; goal: string; startedAt: string;
    result: any; // matches raw API JSON shape (lacks outputPaths that RunResult requires)
  }>());
  // Track in-flight prefetches to avoid duplicate requests
  const prefetchingRef = useRef(new Set<string>());

  // Prepend sample run to history
  const fullHistory = useMemo(() => [SAMPLE_HISTORY_ITEM as HistoryItem, ...history], [history]);

  // Auto-open sidebar on desktop, auto-close on mobile resize
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 1024) setSidebarOpen(true);
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => {
      if (!e.matches) setSidebarOpen(false);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // On mount, check session state + handle initial URL
  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((data) => {
        if (data.history) {
          setHistory(data.history);
          setHasMoreHistory(data.hasMore ?? false);
        }
        if (data.status === 'running' || data.status === 'budget_paused') {
          if (data.currentRun && data.currentRun.isAlive) {
            setCurrentRun({
              repoPath: '',
              repoName: data.currentRun.repoName,
              goal: data.currentRun.goal,
              startedAt: new Date(data.currentRun.startedAt),
              events: [],
              toolCalls: 0,
              budget: 45,
            });
            setSelectedRunId(data.currentRun.id ?? null);
            setStatus(data.status);
            // Push URL to match the running run
            if (data.currentRun.id) {
              pushUrl({ view: 'run', runId: data.currentRun.id });
            }
            // Restore budget pause data so the overlay appears on reconnect
            if (data.status === 'budget_paused' && data.currentRun.budgetPausedData) {
              setBudgetPausedData(data.currentRun.budgetPausedData);
            }
            urlHandledRef.current = true;
          }
        }
        // For completed sessions: don't auto-restore. The URL-based
        // navigation effect below will handle deep-links (/run/id,
        // /multi/id, /compare/a/b). Root "/" stays idle.
      })
      .catch((err) => {
        console.warn('[session] Failed to restore session:', err.message);
      })
      .finally(() => {
        setReady(true);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // After ready, handle URL-based initial navigation (deep link / shared URL)
  useEffect(() => {
    if (!ready || urlHandledRef.current) return;
    urlHandledRef.current = true;

    if (urlView.view === 'info') {
      setStatus('info');
      setActiveInfoPage(urlView.page);
    } else if (urlView.view === 'run' && urlView.runId) {
      handleSelectHistory(urlView.runId, urlView.tab);
    } else if (urlView.view === 'compare') {
      // Load compare directly from URL
      (async () => {
        setCompareLoading(true);
        try {
          const res = await fetch(`/api/compare?a=${encodeURIComponent(urlView.compareIds[0])}&b=${encodeURIComponent(urlView.compareIds[1])}`);
          const data = await res.json();
          if (res.ok && !data.error) {
            setCompareData(data as CompareData);
            setStatus('comparing');
            if (window.innerWidth < 1024) setSidebarOpen(false);
          } else {
            console.warn('[url] Compare failed:', data.error);
            pushUrl({ view: 'idle' });
          }
        } catch (err) {
          console.error('[url] Failed to load compare:', err);
        } finally {
          setCompareLoading(false);
        }
      })();
    } else if (urlView.view === 'multi') {
      // Fetch group data directly — don't rely on handleSelectHistory which
      // needs history[] populated to detect group parents. On direct URL
      // navigation, history may still be empty due to stale closure.
      (async () => {
        setHistoryLoading(true);
        try {
          const r = await fetch(`/api/history/group/${encodeURIComponent(urlView.parentId)}`);
          const data = await r.json();
          if (data.error) {
            console.warn('[url] Failed to load multi-goal group:', urlView.parentId, data.error);
            return;
          }
          setMultiGoalData(data as MultiGoalData);
          setSelectedRunId(urlView.parentId);
          setStatus('multigoal');
          if (urlView.tab) setMultiTab(urlView.tab);
          if (window.innerWidth < 1024) setSidebarOpen(false);
        } catch (err) {
          console.error('[url] Failed to load multi-goal group:', urlView.parentId, err);
        } finally {
          setHistoryLoading(false);
        }
      })();
    }
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL when browser back/forward changes the pathname
  useEffect(() => {
    if (!ready) return;

    // When URL changes externally (back/forward), sync internal state
    if (urlView.view === 'info') {
      setStatus('info');
      setActiveInfoPage(urlView.page);
    } else if (urlView.view === 'idle' && status !== 'idle' && status !== 'running' && status !== 'budget_paused') {
      setStatus('idle');
      setResult(null);
      setCurrentRun(null);
      setSelectedRunId(null);
      setMultiGoalData(null);
      setCompareData(null);
    } else if (urlView.view === 'run' && urlView.runId && urlView.runId !== selectedRunId && status !== 'running') {
      handleSelectHistory(urlView.runId, urlView.tab);
    }
  }, [urlView]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInfoNavigate = useCallback((page: InfoPage) => {
    setStatus('info');
    setActiveInfoPage(page);
    setResult(null);
    setCurrentRun(null);
    setSelectedRunId(null);
    setMultiGoalData(null);
    setCompareData(null);
    pushUrl({ view: 'info', page });
    if (window.innerWidth < 1024) setSidebarOpen(false);
  }, [pushUrl]);

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    if (selectedRunId) {
      replaceUrl({ view: 'run', runId: selectedRunId, tab });
    }
  }, [selectedRunId, replaceUrl]);

  const handleMultiTabChange = useCallback((tab: MultiTab) => {
    setMultiTab(tab);
    if (multiGoalData?.parentId) {
      replaceUrl({ view: 'multi', parentId: multiGoalData.parentId, tab });
    }
  }, [multiGoalData?.parentId, replaceUrl]);

  const handleStart = useCallback((repoPath: string, goal: string, repoName?: string, _appRoot?: string, runId?: string, budget?: number) => {
    const resolvedName = repoName ?? (repoPath.split(/[/\\]/).pop() || repoPath);
    setLastRepoPath(repoPath);
    setCurrentRun({
      repoPath,
      repoName: resolvedName,
      goal,
      startedAt: new Date(),
      events: [],
      toolCalls: 0,
      budget: budget ?? 45,
    });
    setStatus('running');
    setResult(null);
    setBudgetPausedData(null);
    setNewRunModal(false);
    setSelectedRunId(runId ?? null);
    setMultiGoalData(null);
    setActiveTab('overview');

    // Push URL with runId so refresh reconnects
    if (runId) {
      pushUrl({ view: 'run', runId });
    }
  }, [pushUrl]);

  const handleNewEvent = useCallback((event: StepEvent) => {
    setCurrentRun((prev) => {
      if (!prev) return prev;

      // text_delta: replace previous delta (high-frequency, only latest matters)
      if (event.type === 'text_delta') {
        const events = prev.events;
        const last = events[events.length - 1];
        if (last?.type === 'text_delta') {
          const updated = [...events];
          updated[updated.length - 1] = event;
          return { ...prev, events: updated };
        }
        return { ...prev, events: [...events, event] };
      }

      // tool_start: append directly (parallel tools start simultaneously, ~5-10 per batch)
      if (event.type === 'tool_start') {
        return { ...prev, events: [...prev.events, event] };
      }

      // Regular events: strip trailing text_delta (superseded by text_response/tool_call)
      const events = prev.events;
      const last = events[events.length - 1];
      const base = last?.type === 'text_delta' ? events.slice(0, -1) : events;

      return {
        ...prev,
        events: [...base, event],
        toolCalls: event.step > 0 ? event.step : prev.toolCalls,
        budget: event.newBudget ?? prev.budget,
      };
    });
  }, []);

  const handleBudgetPaused = useCallback(
    (data: { findings: number; toolCalls: number; budget: number }) => {
      setStatus('budget_paused');
      setBudgetPausedData(data);
    },
    [],
  );

  const handleBudgetDecision = useCallback((extend: boolean) => {
    if (extend) {
      setStatus('running');
      setCurrentRun((prev) => (prev ? { ...prev, budget: prev.budget + 50 } : prev));
    } else {
      setStatus('running');
    }
    setBudgetPausedData(null);
  }, []);

  /** Budget decision from ContextBar — calls the API then updates UI */
  const handleBudgetDecisionWithApi = useCallback(async (extend: boolean) => {
    // Always dismiss the modal immediately so the UI doesn't get stuck
    handleBudgetDecision(extend);
    try {
      await fetch('/api/extend-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ extend }),
      });
    } catch {
      // API error — modal already dismissed, agent will resolve on its own
    }
  }, [handleBudgetDecision]);

  const handleRunComplete = useCallback(
    (data: { scorecard: unknown; metrics: unknown; terminationReason: string }) => {
      fetch('/api/session')
        .then((r) => r.json())
        .then((sessionData) => {
          if (sessionData.result) {
            setResult(sessionData.result as CompletedResult);
          } else {
            setResult({
              scorecard: data.scorecard as Scorecard,
              metrics: data.metrics as RunMetrics,
              terminationReason: data.terminationReason,
              briefMarkdown: '',
            });
          }
          if (sessionData.history) setHistory(sessionData.history);
          setStatus('complete');
        })
        .catch(() => {
          setResult({
            scorecard: data.scorecard as Scorecard,
            metrics: data.metrics as RunMetrics,
            terminationReason: data.terminationReason,
            briefMarkdown: '',
          });
          setStatus('complete');
        });
    },
    [],
  );

  const handleRunError = useCallback((error: string) => {
    console.error('Run error:', error);
    setErrorMessage(error);
    setStatus('error');
  }, []);

  const handleStop = useCallback(async () => {
    await fetch('/api/session', { method: 'DELETE' }).catch((err) => {
      console.warn('[session] DELETE failed:', err.message);
    });
    setStatus('idle');
    setCurrentRun(null);
    setResult(null);
    setBudgetPausedData(null);
    setSelectedRunId(null);
    pushUrl({ view: 'idle' });
  }, [pushUrl]);

  const handleNewRun = useCallback(() => {
    setStatus('idle');
    setSelectedRunId(null);
    setCompareMode(false);
    setCompareSelections([]);
    setCompareData(null);
    setNewRunModal(false);
    pushUrl({ view: 'idle' });
  }, [pushUrl]);

  const handleToggleCompareMode = useCallback(() => {
    setCompareMode(prev => !prev);
    setCompareSelections([]);
  }, []);

  const handleCompareSelect = useCallback((id: string) => {
    setCompareSelections(prev => {
      if (prev.includes(id)) return prev.filter(s => s !== id);
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  }, []);

  const handleCompare = useCallback(async () => {
    if (compareSelections.length !== 2) return;
    setCompareLoading(true);
    try {
      const res = await fetch(`/api/compare?a=${encodeURIComponent(compareSelections[0])}&b=${encodeURIComponent(compareSelections[1])}`);
      const data = await res.json();
      if (!res.ok) {
        console.error('[compare] API error:', data.error);
        setCompareLoading(false);
        return;
      }
      setCompareData(data as CompareData);
      setStatus('comparing');
      setCompareMode(false);
      pushUrl({ view: 'compare', compareIds: [compareSelections[0], compareSelections[1]] });
    } catch (err) {
      console.error('[compare] Fetch error:', err);
    } finally {
      setCompareLoading(false);
    }
  }, [compareSelections]);

  const handleLoadMore = useCallback(async () => {
    try {
      const res = await fetch(`/api/session?offset=${history.length}&limit=50`);
      const data = await res.json();
      if (data.history && data.history.length > 0) {
        setHistory(prev => [...prev, ...data.history]);
        setHasMoreHistory(data.hasMore ?? false);
      } else {
        setHasMoreHistory(false);
      }
    } catch {
      // silently fail
    }
  }, [history.length]);

  const handleExitCompare = useCallback(() => {
    setStatus('idle');
    setCompareData(null);
    setCompareSelections([]);
    setCompareMode(false);
    pushUrl({ view: 'idle' });
  }, [pushUrl]);

  const handleSelectHistory = useCallback(async (id: string, initialTab?: Tab) => {
    // In compare mode, delegate to compare select
    if (compareMode) {
      handleCompareSelect(id);
      return;
    }

    // Sample run uses built-in data, no fetch needed
    if (id === SAMPLE_RUN_ID) {
      const { SAMPLE_SCORECARD, SAMPLE_METRICS, SAMPLE_BRIEF_MARKDOWN, SAMPLE_FINDINGS: sampleFindings, SAMPLE_ANALYSIS_TURNS } = await import('@/lib/sampleRunData');
      setResult({
        scorecard: SAMPLE_SCORECARD,
        metrics: SAMPLE_METRICS,
        terminationReason: 'completed',
        briefMarkdown: SAMPLE_BRIEF_MARKDOWN,
        state: { findings: sampleFindings },
      });
      setSampleInvestigation({
        analysisTurns: SAMPLE_ANALYSIS_TURNS,
        findings: sampleFindings,
        findingBatches: [sampleFindings.length],
      });
      setCurrentRun({
        repoPath: '',
        repoName: SAMPLE_HISTORY_ITEM.repoName,
        goal: SAMPLE_HISTORY_ITEM.goal,
        startedAt: new Date(SAMPLE_HISTORY_ITEM.startedAt),
        events: [],
        toolCalls: 50,
        budget: 45,
      });
      setBudgetPausedData(null);
      setSelectedRunId(id);
      setStatus('complete');
      setActiveTab(initialTab ?? 'overview');
      pushUrl({ view: 'run', runId: id, tab: initialTab });
      if (window.innerWidth < 1024) setSidebarOpen(false);
      return;
    }

    // Check if this is a multi-goal group parent click
    const isGroupParent = history.some(h => h.parentRunId === id);
    if (isGroupParent) {
      setHistoryLoading(true);
      try {
        const r = await fetch(`/api/history/group/${encodeURIComponent(id)}`);
        const data = await r.json();
        if (data.error) {
          console.warn('[history] Failed to load group:', id, data.error);
          return;
        }
        setMultiGoalData(data as MultiGoalData);
        setSelectedRunId(id);
        setStatus('multigoal');
        pushUrl({ view: 'multi', parentId: id });
        if (window.innerWidth < 1024) setSidebarOpen(false);
      } catch (err) {
        console.error('[history] Failed to load group:', id, err);
      } finally {
        setHistoryLoading(false);
      }
      return;
    }

    // Check cache first — runs are immutable, no need to re-fetch
    const cached = runCacheRef.current.get(id);
    if (cached) {
      setResult(cached.result);
      setCurrentRun({
        repoPath: '',
        repoName: cached.repoName,
        goal: cached.goal,
        startedAt: new Date(cached.startedAt),
        events: [],
        toolCalls: cached.result.metrics?.toolCalls ?? 0,
        budget: cached.result.metrics?.toolCalls ?? 45,
      });
      setBudgetPausedData(null);
      setSampleInvestigation(null);
      setSelectedRunId(id);
      setStatus('complete');
      setActiveTab(initialTab ?? 'overview');
      pushUrl({ view: 'run', runId: id, tab: initialTab });
      if (window.innerWidth < 1024) setSidebarOpen(false);
      return;
    }

    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/history/${encodeURIComponent(id)}?slim=1`);
      const data = await r.json();
      if (data.error || !data.result) {
        console.warn('[history] No result for run:', id, data.error);
        setHistoryLoading(false);
        setSelectedRunId(null);
        setStatus('idle');
        pushUrl({ view: 'idle' });
        return;
      }
      // Cache the loaded run
      runCacheRef.current.set(id, {
        repoName: data.repoName,
        goal: data.goal,
        startedAt: data.startedAt,
        result: data.result,
      });
      setResult(data.result as CompletedResult);
      setCurrentRun({
        repoPath: '',
        repoName: data.repoName,
        goal: data.goal,
        startedAt: new Date(data.startedAt),
        events: [],
        toolCalls: data.result.metrics?.toolCalls ?? 0,
        budget: data.result.metrics?.toolCalls ?? 45,
      });
      setBudgetPausedData(null);
      setSampleInvestigation(null);
      setSelectedRunId(id);
      setStatus('complete');
      setActiveTab(initialTab ?? 'overview');
      pushUrl({ view: 'run', runId: id, tab: initialTab });
      if (window.innerWidth < 1024) setSidebarOpen(false);
    } catch (err) {
      console.error('[history] Failed to load run:', id, err);
    } finally {
      setHistoryLoading(false);
    }
  }, [compareMode, handleCompareSelect, history, pushUrl]);

  // Prefetch a run on hover — fires the request and populates the cache
  // so that the subsequent click is instant.
  const groupParentIds = useMemo(() => {
    const ids = new Set<string>();
    for (const h of history) { if (h.parentRunId) ids.add(h.parentRunId); }
    return ids;
  }, [history]);

  const handlePrefetch = useCallback((id: string) => {
    if (id === SAMPLE_RUN_ID) return;
    if (groupParentIds.has(id)) return;
    if (runCacheRef.current.has(id)) return;
    if (prefetchingRef.current.has(id)) return;
    prefetchingRef.current.add(id);
    fetch(`/api/history/${encodeURIComponent(id)}?slim=1`)
      .then(r => r.json())
      .then(data => {
        if (data.result && !data.error) {
          runCacheRef.current.set(id, {
            repoName: data.repoName,
            goal: data.goal,
            startedAt: data.startedAt,
            result: data.result,
          });
        }
      })
      .catch(() => {})
      .finally(() => { prefetchingRef.current.delete(id); });
  }, [groupParentIds]);

  const isRunningOrPaused = status === 'running' || status === 'budget_paused';

  // SSE connection for live runs (replaces EventStream inside RunningView)
  useEventSource(isRunningOrPaused, {
    onEvent: handleNewEvent,
    onBudgetPaused: handleBudgetPaused,
    onRunComplete: handleRunComplete,
    onRunError: handleRunError,
  });

  // Derive AnalysisView state from live SSE events
  const liveState = useLiveAnalysis(
    currentRun?.events ?? [],
    status,
    currentRun?.toolCalls ?? 0,
    currentRun?.budget ?? 45,
  );

  const commands = useMemo(() => {
    const cmds = [
      { id: 'new-run', label: 'New Analysis', shortcut: '\u2318N', action: handleNewRun },
      { id: 'toggle-sidebar', label: 'Toggle Sidebar', action: () => setSidebarOpen((p) => !p) },
    ];
    cmds.push({ id: 'compare', label: 'Compare Runs', action: handleToggleCompareMode });
    if (isRunningOrPaused) {
      cmds.push({ id: 'stop', label: 'Stop Run', shortcut: '\u2318.', action: handleStop });
    }
    if (status === 'comparing') {
      cmds.push({ id: 'exit-compare', label: 'Exit Compare', action: handleExitCompare });
    }
    cmds.push(
      { id: 'how-it-works', label: 'How It Works', action: () => handleInfoNavigate('how-it-works') },
      { id: 'changelog', label: 'Changelog', action: () => handleInfoNavigate('changelog') },
      { id: 'theme-light', label: 'Theme: Light', action: () => setThemeMode('light') },
      { id: 'theme-dark', label: 'Theme: Dark', action: () => setThemeMode('dark') },
      { id: 'theme-system', label: 'Theme: System', action: () => setThemeMode('system') },
    );
    for (const h of fullHistory) {
      cmds.push({
        id: `history-${h.id}`,
        label: `Open: ${h.repoName} (${h.goal})`,
        action: () => handleSelectHistory(h.id),
      });
    }
    return cmds;
  }, [isRunningOrPaused, status, fullHistory, handleNewRun, handleStop, handleSelectHistory, handleToggleCompareMode, handleExitCompare, handleInfoNavigate, setThemeMode]);

  useKeyboardShortcuts({
    onNewRun: handleNewRun,
    onStop: isRunningOrPaused ? handleStop : undefined,
    onTogglePalette: () => setPaletteOpen((p) => !p),
    onEscape: () => {
      setPaletteOpen(false);
      setSidebarOpen(false);
      setNewRunModal(false);
    },
  });

  if (!ready) {
    return <div className="flex flex-col h-screen overflow-hidden bg-canvas" />;
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-canvas">
      <header className="bg-surface-translucent backdrop-blur-xl shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-4 h-12 flex items-center gap-3 sticky top-0 z-10 shrink-0">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen((prev) => !prev)}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors cursor-pointer"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 16 16" fill="currentColor">
            <rect y="2" width="16" height="1.5" rx="0.75" />
            <rect y="7.25" width="16" height="1.5" rx="0.75" />
            <rect y="12.5" width="16" height="1.5" rx="0.75" />
          </svg>
        </button>

        {/* Brand */}
        <span className="text-[20px] font-bold text-tint tracking-[-0.02em] font-brand select-none whitespace-nowrap shrink-0">
          radar
        </span>

        <div className="ml-auto flex gap-2 items-center">
          {/* New Analysis — always accessible from header */}
          {!isRunningOrPaused && (
            <button
              onClick={handleNewRun}
              className="flex items-center gap-1.5 h-7 rounded-md bg-tint text-white px-3 text-[12px] font-semibold cursor-pointer hover:brightness-110 active:scale-[0.98] transition-all"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              New Analysis
            </button>
          )}
          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors cursor-pointer"
            title={`Theme: ${themeMode}`}
            aria-label={`Switch theme, current: ${themeMode}`}
          >
            {themeMode === 'light' ? (
              <svg
                className="w-4 h-4 text-secondary-label"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            ) : themeMode === 'dark' ? (
              <svg
                className="w-4 h-4 text-secondary-label"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            ) : (
              <svg
                className="w-4 h-4 text-secondary-label"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Context bar: shows run info (hidden when idle) */}
      {status === 'comparing' && compareData && (
        <ContextBar
          status="comparing"
          repoName=""
          onStop={handleExitCompare}
          compareRunNames={[compareData.runA.repoName, compareData.runB.repoName]}
          compareSummary={compareData.diff.summary}
          onExitCompare={handleExitCompare}
        />
      )}
      {status !== 'idle' && status !== 'comparing' && status !== 'multigoal' && currentRun?.repoName && (
        <ContextBar
          status={status as 'running' | 'budget_paused' | 'complete' | 'error'}
          repoName={currentRun.repoName}
          goal={currentRun.goal}
          scorecard={result?.scorecard}
          toolCalls={currentRun.toolCalls}
          budget={currentRun.budget}
          onStop={handleStop}
          onBudgetDecision={status === 'budget_paused' ? handleBudgetDecisionWithApi : undefined}
          activeTab={activeTab}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        {USE_SIDEBAR_V2 ? (
          <AppSidebar
            open={sidebarOpen}
            history={fullHistory}
            activeRunId={selectedRunId}
            currentRepoName={currentRun?.repoName}
            currentGoal={currentRun?.goal}
            isRunning={isRunningOrPaused}
            onSelectHistory={handleSelectHistory}
            onPrefetch={handlePrefetch}
            onNewRun={handleNewRun}
            onClose={() => setSidebarOpen(false)}
            compareMode={compareMode}
            compareSelections={compareSelections}
            onToggleCompare={handleToggleCompareMode}
            onCompareSelect={handleCompareSelect}
            onCompare={handleCompare}
            hasMore={hasMoreHistory}
            onLoadMore={handleLoadMore}
            activeTab={activeTab}
            onSectionClick={handleTabChange}
            showSections={(status === 'complete' || status === 'error') && !!result}
            compareHighlight={status === 'comparing' && compareData ? [compareSelections[0], compareSelections[1]] as [string, string] : null}
            activeInfoPage={status === 'info' ? activeInfoPage : undefined}
            onInfoNavigate={handleInfoNavigate}
          />
        ) : (
          <Sidebar
            open={sidebarOpen}
            history={fullHistory}
            activeRunId={selectedRunId}
            currentRepoName={currentRun?.repoName}
            currentGoal={currentRun?.goal}
            isRunning={isRunningOrPaused}
            onSelectHistory={handleSelectHistory}
            onPrefetch={handlePrefetch}
            onNewRun={handleNewRun}
            onClose={() => setSidebarOpen(false)}
            compareMode={compareMode}
            compareSelections={compareSelections}
            onToggleCompare={handleToggleCompareMode}
            onCompareSelect={handleCompareSelect}
            onCompare={handleCompare}
            hasMore={hasMoreHistory}
            onLoadMore={handleLoadMore}
            activeTab={activeTab}
            onSectionClick={handleTabChange}
            showSections={(status === 'complete' || status === 'error') && !!result}
            compareHighlight={status === 'comparing' && compareData ? [compareSelections[0], compareSelections[1]] as [string, string] : null}
            activeInfoPage={status === 'info' ? activeInfoPage : undefined}
            onInfoNavigate={handleInfoNavigate}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden relative" aria-label="Main content">
          {(historyLoading || compareLoading) && (
            <div key="loading" className="flex-1 flex flex-col overflow-hidden">
              <RunLoadingSkeleton />
            </div>
          )}

          {status === 'idle' && !historyLoading && !compareLoading && (
            <div key="idle" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <IdleView initialRepoPath={lastRepoPath} onStart={handleStart} history={history} historyReady={ready} />
            </div>
          )}

          {isRunningOrPaused && currentRun && !historyLoading && (
            <div key="running" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <AnalysisView
                isLive
                liveState={liveState}
                budgetPaused={status === 'budget_paused'}
                budgetPausedData={budgetPausedData}
                onBudgetDecision={handleBudgetDecisionWithApi}
              />
            </div>
          )}

          {status === 'comparing' && compareData && !compareLoading && (
            <div key="comparing" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <CompareView data={compareData} />
            </div>
          )}

          {status === 'info' && activeInfoPage && (
            <div key={`info-${activeInfoPage}`} className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              {activeInfoPage === 'how-it-works' && (
                <div className="flex-1 overflow-y-auto">
                  <div className="max-w-xl mx-auto px-6 py-10">
                    <HowItWorksPanel />
                  </div>
                </div>
              )}
              {activeInfoPage === 'changelog' && <ChangelogView />}
            </div>
          )}

          {status === 'multigoal' && multiGoalData && !historyLoading && (
            <div key="multigoal" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <MultiGoalView
                data={multiGoalData}
                activeTab={multiTab}
                onTabChange={handleMultiTabChange}
              />
            </div>
          )}

          {(status === 'complete' || status === 'error') && result && currentRun && !historyLoading && (
            <div key="complete" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <CompleteView
                briefMarkdown={result.briefMarkdown}
                scorecard={result.scorecard}
                metrics={result.metrics}
                events={currentRun.events}
                goal={currentRun.goal}
                findings={result.state?.findings}
                runId={selectedRunId ?? undefined}
                repoUrl={selectedRunId ? history.find(h => h.id === selectedRunId)?.repoUrl : undefined}
                activeTab={activeTab}
                onTabChange={handleTabChange}
                investigationRunData={sampleInvestigation ?? undefined}
              />
            </div>
          )}

          {status === 'error' && !result && (
            <div
              key="error"
              className="animate-scale-in flex-1 flex items-center justify-center flex-col gap-4"
            >
              <svg
                className="w-10 h-10 text-danger"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6M9 9l6 6" />
              </svg>
              <h2 className="text-lg font-semibold text-label mb-2">Analysis could not complete</h2>
              <p className="text-sm text-secondary-label max-w-sm">{friendlyError(errorMessage)}</p>
              <button
                onClick={handleNewRun}
                className="bg-tint text-white rounded-lg h-11 px-5 text-sm font-medium cursor-pointer hover:brightness-110 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_113_227/0.3)]"
              >
                Try Again
              </button>
            </div>
          )}
        </main>
      </div>

      {/* New Analysis modal */}
      {newRunModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-sm"
            onClick={() => setNewRunModal(false)}
          />
          <div className="relative z-10 w-full max-w-lg mx-4 animate-scale-in">
            <IdleView compact initialRepoPath={lastRepoPath} onStart={handleStart} history={history} historyReady={ready} />
          </div>
        </div>
      )}


      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
      />
    </div>
  );
}
