'use client';

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { StepEvent, Scorecard, RunMetrics, HistoryItem } from '@/lib/agentSession';
import { useKeyboardShortcuts } from '@/lib/useKeyboardShortcuts';
import { useTheme } from '@/lib/useTheme';
import { useUrlState, buildUrl, type Tab, type InfoPage } from '@/lib/useUrlState';
import { ContextBar } from '@/components/ContextBar';
import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { AppSidebar, deriveActiveSection, type NavSection } from '@/components/AppSidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { IdleView } from '@/components/IdleView';
import { RunView } from '@/components/RunView';
import { CompareView, type CompareData } from '@/components/CompareView';
import { AnalysisView } from '@/components/AnalysisView';
import { RunLoadingSkeleton } from '@/components/Skeleton';
import { HowItWorksPanel } from '@/components/HowItWorksPanel';
import { ChangelogView } from '@/components/ChangelogView';
import { RunsListView } from '@/components/RunsListView';
import { FindingsTriagePage } from '@/components/FindingsTriagePage';
import { useEventSource } from '@/lib/useEventSource';
import { useLiveAnalysis } from '@/lib/useLiveAnalysis';
import type { TransformedRunData } from '@/lib/runTransform';
import { normalizeFindings, deduplicateFindings, type Finding } from '@/lib/runTransform';
import { toMultiRunData, type RunViewMode, type MultiGoalData } from '@/lib/runViewAdapters';

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

type DashboardStatus = 'idle' | 'running' | 'budget_paused' | 'complete' | 'error' | 'comparing' | 'info' | 'runs' | 'findings' | 'reports' | 'settings';

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return localStorage.getItem('sidebar-collapsed') === 'true'; } catch { return false; }
    }
    return false;
  });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newRunModal, setNewRunModal] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelections, setCompareSelections] = useState<string[]>([]);
  const [compareData, setCompareData] = useState<CompareData | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [multiRunData, setMultiRunData] = useState<RunViewMode | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedParallelWorker, setSelectedParallelWorker] = useState<string | null>(null);
  const [pendingMultiComplete, setPendingMultiComplete] = useState<{
    parentRunId: string;
    groupData: MultiGoalData;
    history: HistoryItem[];
  } | null>(null);
  const [sampleInvestigation, setSampleInvestigation] = useState<TransformedRunData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [activeInfoPage, setActiveInfoPage] = useState<InfoPage | undefined>(undefined);
  const [findingsData, setFindingsData] = useState<{
    findings: Finding[];
    runId: string;
    repoName: string;
    goal: string;
    startedAt: string;
    repoUrl?: string;
    goalMap?: Record<string, string>;
    isMultiGoal?: boolean;
  } | null>(null);
  const [findingsLoading, setFindingsLoading] = useState(false);
  const findingsLoadingRef = useRef(false);
  const findingsRunIdRef = useRef<string | undefined>(undefined);
  findingsRunIdRef.current = findingsData?.runId;
  const { mode: themeMode, cycle: cycleTheme, setMode: setThemeMode } = useTheme();
  const { urlView, pushUrl, replaceUrl } = useUrlState();
  const activeSection = deriveActiveSection(urlView);
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

  // Stable mobile/desktop detection via media query (avoids stale window.innerWidth checks)
  const isMobileRef = useRef(typeof window !== 'undefined' ? window.innerWidth < 1024 : false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth >= 1024) setSidebarOpen(true);
    const mq = window.matchMedia('(min-width: 1024px)');
    isMobileRef.current = !mq.matches;
    const handler = (e: MediaQueryListEvent) => {
      isMobileRef.current = !e.matches;
      setSidebarOpen(e.matches);
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

    if (urlView.view === 'runs' || urlView.view === 'findings' || urlView.view === 'reports' || urlView.view === 'settings') {
      setStatus(urlView.view as DashboardStatus);
    } else if (urlView.view === 'info') {
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
            if (isMobileRef.current) setSidebarOpen(false);
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
          setMultiRunData({ kind: 'multi', data: toMultiRunData(data as MultiGoalData) });
          setSelectedRunId(urlView.parentId);
          setStatus('complete');
          if (urlView.tab) setActiveTab(urlView.tab);
          if (isMobileRef.current) setSidebarOpen(false);
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
    if (urlView.view === 'findings') {
      if (status !== 'findings') setStatus('findings');
      if (urlView.runId && urlView.runId !== findingsData?.runId) {
        setFindingsData(null);
      }
    } else if (urlView.view === 'runs' || urlView.view === 'reports' || urlView.view === 'settings') {
      setStatus(urlView.view as DashboardStatus);
    } else if (urlView.view === 'info') {
      setStatus('info');
      setActiveInfoPage(urlView.page);
    } else if (urlView.view === 'idle' && status !== 'idle' && status !== 'running' && status !== 'budget_paused') {
      setStatus('idle');
      setResult(null);
      setCurrentRun(null);
      setSelectedRunId(null);
      setMultiRunData(null);
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
    setMultiRunData(null);
    setCompareData(null);
    pushUrl({ view: 'info', page });
    if (isMobileRef.current) setSidebarOpen(false);
  }, [pushUrl]);

  const handleToggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('sidebar-collapsed', String(next)); } catch {}
      return next;
    });
  }, []);

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
    if (multiRunData?.kind === 'multi') {
      replaceUrl({ view: 'multi', parentId: multiRunData.data.parentId, tab });
    } else if (selectedRunId) {
      replaceUrl({ view: 'run', runId: selectedRunId, tab });
    }
  }, [selectedRunId, multiRunData, replaceUrl]);

  const handleStart = useCallback((repoPath: string, goal: string, repoName?: string, _appRoot?: string, runId?: string, budget?: number, _goals?: string[], _parallel?: boolean) => {
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
    setMultiRunData(null);
    setActiveTab('overview');
    setSelectedParallelWorker(null);

    // Push URL with runId so refresh reconnects
    if (runId) {
      pushUrl({ view: 'run', runId });
    }
  }, [pushUrl]);

  const handleNewEvent = useCallback((event: StepEvent) => {
    setCurrentRun((prev) => {
      if (!prev) return prev;

      // text_delta: replace previous delta from the SAME worker only
      if (event.type === 'text_delta') {
        const events = prev.events;
        const last = events[events.length - 1];
        if (last?.type === 'text_delta' && last.workerId === event.workerId) {
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

      // text_response supersedes the streaming delta — strip it.
      // Other events (tool_call, finding, etc.) leave the delta in place
      // so useLiveAnalysis can still derive typingText from it until
      // the final text_response arrives (prevents reasoning flicker).
      const events = prev.events;
      const last = events[events.length - 1];
      const shouldStripDelta = event.type === 'text_response'
        && last?.type === 'text_delta'
        && last.workerId === event.workerId;
      const base = shouldStripDelta ? events.slice(0, -1) : events;

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

  const handleBudgetResumed = useCallback(() => {
    setStatus('running');
    setBudgetPausedData(null);
  }, []);

  const handleBudgetDecision = useCallback((extend: boolean) => {
    setBudgetPausedData(null);
    setStatus('running');
    if (extend) {
      setCurrentRun((prev) => {
        if (!prev) return prev;
        const newBudget = prev.budget + 50;
        const syntheticEvent: StepEvent = {
          step: prev.toolCalls,
          action: 'budget_extended',
          type: 'status',
          result: 'Resuming analysis...',
          newBudget,
        };
        return { ...prev, budget: newBudget, events: [...prev.events, syntheticEvent] };
      });
    }
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
    (data: { scorecard: unknown; metrics: unknown; terminationReason: string; multiGoal?: boolean; parentRunId?: string }) => {
      fetch('/api/session')
        .then((r) => r.json())
        .then(async (sessionData) => {
          if (sessionData.history) setHistory(sessionData.history);

          // Multi-goal: defer transition so user can keep browsing worker streams
          if (data.multiGoal && data.parentRunId) {
            try {
              const r = await fetch(`/api/history/group/${encodeURIComponent(data.parentRunId)}`);
              const groupData = await r.json();
              if (!groupData.error) {
                setPendingMultiComplete({
                  parentRunId: data.parentRunId,
                  groupData: groupData as MultiGoalData,
                  history: sessionData.history ?? [],
                });
                return;
              }
            } catch { /* fall through to single-goal display */ }
          }

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

  const handleViewMultiResults = useCallback(() => {
    if (!pendingMultiComplete) return;
    const { parentRunId, groupData } = pendingMultiComplete;
    setMultiRunData({ kind: 'multi', data: toMultiRunData(groupData) });
    setSelectedRunId(parentRunId);
    setStatus('complete');
    pushUrl({ view: 'multi', parentId: parentRunId });
    setPendingMultiComplete(null);
  }, [pendingMultiComplete, pushUrl]);

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
    setPendingMultiComplete(null);
    pushUrl({ view: 'idle' });
  }, [pushUrl]);

  const handleNewRun = useCallback(() => {
    setStatus('idle');
    setSelectedRunId(null);
    setCompareMode(false);
    setCompareSelections([]);
    setCompareData(null);
    setNewRunModal(false);
    setPendingMultiComplete(null);
    pushUrl({ view: 'idle' });
  }, [pushUrl]);

  const handleSidebarNavigate = useCallback((section: NavSection) => {
    switch (section) {
      case 'dashboard':
        handleNewRun();
        break;
      case 'runs':
        setStatus('runs');
        pushUrl({ view: 'runs' });
        break;
      case 'findings':
        if (status === 'findings' && findingsRunIdRef.current) {
          pushUrl({ view: 'findings', runId: findingsRunIdRef.current });
        } else {
          setStatus('findings');
          pushUrl({ view: 'findings' });
        }
        break;
      case 'reports':
        setStatus('reports');
        pushUrl({ view: 'reports' });
        break;
      case 'settings':
        setStatus('settings');
        pushUrl({ view: 'settings' });
        break;
    }
    if (isMobileRef.current) setSidebarOpen(false);
  }, [status, pushUrl, handleNewRun]);

  const GOAL_LABELS: Record<string, string> = {
    onboarding: 'Onboarding', audit: 'Audit', 'audit-generic': 'Generic Audit',
    migration: 'Migration', 'component-map': 'Components', 'ci-check': 'CI Check',
    'security-review': 'Security', nextjs: 'Next.js', accessibility: 'Accessibility',
    all: 'All Goals',
  };

  // Build children-by-parent map for multi-goal detection
  const childrenByParent = useMemo(() => {
    const map = new Map<string, HistoryItem[]>();
    for (const h of history) {
      if (h.parentRunId) {
        const children = map.get(h.parentRunId) ?? [];
        children.push(h);
        map.set(h.parentRunId, children);
      }
    }
    return map;
  }, [history]);

  // Runs available for findings triage (have findings, deduplicated for multi-goal)
  const findingsRunOptions = useMemo(() => {
    const options: HistoryItem[] = [];

    // Synthesize entries for multi-goal parent groups (parents aren't in history[])
    for (const [parentId, children] of childrenByParent) {
      const first = children[0];
      const totalFindings = children.reduce((sum, c) => sum + (c.findingsCount ?? 0), 0);
      if (totalFindings === 0) continue;
      options.push({
        id: parentId,
        goal: 'all',
        repoName: first.repoName,
        startedAt: first.startedAt,
        completedAt: first.completedAt,
        hasResult: true,
        findingsCount: totalFindings,
        repoUrl: first.repoUrl,
      });
    }

    // Add single (non-child) runs with findings
    for (const h of history) {
      if (!h.parentRunId && h.findingsCount && h.findingsCount > 0) {
        options.push(h);
      }
    }

    // Sort by startedAt descending (most recent first)
    options.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return options;
  }, [history, childrenByParent]);

  // Load findings for a specific run
  const loadFindingsForRun = useCallback(async (targetRun: HistoryItem) => {
    if (findingsLoadingRef.current) return;
    findingsLoadingRef.current = true;
    setFindingsLoading(true);
    try {
      const children = childrenByParent.get(targetRun.id);
      if (children && children.length > 0) {
        const allFindings: Finding[] = [];
        const goalMap: Record<string, string> = {};
        const results = await Promise.all(
          children.map(async (child) => {
            const res = await fetch(`/api/history/${encodeURIComponent(child.id)}/findings`);
            return { child, data: await res.json() };
          })
        );
        for (const { child, data } of results) {
          if (data.findings) {
            const normalized = normalizeFindings(data.findings);
            for (const f of normalized) {
              if (!goalMap[f.id]) goalMap[f.id] = GOAL_LABELS[child.goal] ?? child.goal;
            }
            allFindings.push(...normalized);
          }
        }
        const dedupedFindings = deduplicateFindings(allFindings);
        const dedupedGoalMap: Record<string, string> = {};
        for (const f of dedupedFindings) dedupedGoalMap[f.id] = goalMap[f.id];
        setFindingsData({
          findings: dedupedFindings,
          runId: targetRun.id,
          repoName: targetRun.repoName,
          goal: children.length > 1 ? 'all' : targetRun.goal,
          startedAt: targetRun.startedAt,
          repoUrl: targetRun.repoUrl,
          goalMap: dedupedGoalMap,
          isMultiGoal: true,
        });
      } else {
        const res = await fetch(`/api/history/${encodeURIComponent(targetRun.id)}/findings`);
        const data = await res.json();
        const findings = data.findings ? normalizeFindings(data.findings) : [];
        const goalLabel = GOAL_LABELS[targetRun.goal] ?? targetRun.goal;
        const goalMap: Record<string, string> = {};
        for (const f of findings) goalMap[f.id] = goalLabel;
        setFindingsData({
          findings,
          runId: targetRun.id,
          repoName: targetRun.repoName,
          goal: targetRun.goal,
          startedAt: targetRun.startedAt,
          repoUrl: targetRun.repoUrl,
          goalMap,
        });
      }
    } catch (err) {
      console.error('[findings] Failed to load:', err);
      setFindingsData(null);
    } finally {
      findingsLoadingRef.current = false;
      setFindingsLoading(false);
    }
  }, [childrenByParent]);

  // Load findings for triage page — from most recent completed run
  const loadFindingsForTriage = useCallback(async () => {
    if (findingsRunOptions.length === 0) {
      setFindingsData(null);
      return;
    }
    const target = findingsRunOptions[0];
    await loadFindingsForRun(target);
    replaceUrl({ view: 'findings', runId: target.id });
  }, [findingsRunOptions, loadFindingsForRun, replaceUrl]);

  const handleRunSwitch = useCallback((runId: string) => {
    const run = findingsRunOptions.find(r => r.id === runId);
    if (run) {
      loadFindingsForRun(run);
      pushUrl({ view: 'findings', runId });
    }
  }, [findingsRunOptions, loadFindingsForRun, pushUrl]);

  // Load findings when entering findings view — use URL runId if present,
  // otherwise fall back to the most recent run with findings.
  const urlRunIdRef = useRef<string | undefined>(undefined);
  urlRunIdRef.current = urlView.view === 'findings' ? urlView.runId : undefined;

  useEffect(() => {
    if (status !== 'findings' || findingsData || findingsLoadingRef.current) return;
    const urlRunId = urlRunIdRef.current;
    if (urlRunId) {
      const targetRun = findingsRunOptions.find(r => r.id === urlRunId);
      if (targetRun) {
        loadFindingsForRun(targetRun);
        return;
      }
    }
    loadFindingsForTriage();
  }, [status, findingsData, findingsRunOptions, loadFindingsForRun, loadFindingsForTriage]);

  const handleFindingSelect = useCallback((findingId: string | null) => {
    const currentRunId = findingsData?.runId;
    if (findingId) {
      replaceUrl({ view: 'findings', runId: currentRunId, findingId });
    } else {
      replaceUrl({ view: 'findings', runId: currentRunId });
    }
  }, [replaceUrl, findingsData?.runId]);


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
      setMultiRunData(null);
      setSelectedRunId(id);
      setStatus('complete');
      setActiveTab(initialTab ?? 'overview');
      pushUrl({ view: 'run', runId: id, tab: initialTab });
      if (isMobileRef.current) setSidebarOpen(false);
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
        setMultiRunData({ kind: 'multi', data: toMultiRunData(data as MultiGoalData) });
        setSelectedRunId(id);
        setStatus('complete');
        setActiveTab(initialTab ?? 'overview');
        pushUrl({ view: 'multi', parentId: id, tab: initialTab });
        if (isMobileRef.current) setSidebarOpen(false);
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
      setMultiRunData(null);
      setSelectedRunId(id);
      setStatus('complete');
      setActiveTab(initialTab ?? 'overview');
      pushUrl({ view: 'run', runId: id, tab: initialTab });
      if (isMobileRef.current) setSidebarOpen(false);
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
      setMultiRunData(null);
      setSelectedRunId(id);
      setStatus('complete');
      setActiveTab(initialTab ?? 'overview');
      pushUrl({ view: 'run', runId: id, tab: initialTab });
      if (isMobileRef.current) setSidebarOpen(false);
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

  // Derive the unified RunView mode from current state
  const runViewMode: RunViewMode | null = useMemo(() => {
    if (multiRunData) return multiRunData;
    if (result && currentRun) {
      return {
        kind: 'single',
        data: {
          briefMarkdown: result.briefMarkdown,
          scorecard: result.scorecard,
          metrics: result.metrics,
          events: currentRun.events,
          goal: currentRun.goal,
          findings: result.state?.findings ?? [],
          runId: selectedRunId ?? undefined,
          repoUrl: selectedRunId ? history.find(h => h.id === selectedRunId)?.repoUrl : undefined,
          investigationRunData: sampleInvestigation ?? undefined,
        },
      };
    }
    return null;
  }, [multiRunData, result, currentRun, selectedRunId, history, sampleInvestigation]);

  // SSE connection for live runs (replaces EventStream inside RunningView)
  useEventSource(isRunningOrPaused, {
    onEvent: handleNewEvent,
    onBudgetPaused: handleBudgetPaused,
    onBudgetResumed: handleBudgetResumed,
    onRunComplete: handleRunComplete,
    onRunError: handleRunError,
  });

  // Derive AnalysisView state from live SSE events
  const liveState = useLiveAnalysis(
    currentRun?.events ?? [],
    status,
    currentRun?.toolCalls ?? 0,
    currentRun?.budget ?? 45,
    selectedParallelWorker,
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

  const isPageView = status === 'runs' || status === 'findings' || status === 'reports' || status === 'settings';
  const showRunContextBar = status !== 'idle' && status !== 'comparing' && !isPageView && (currentRun?.repoName || multiRunData?.kind === 'multi');

  return (
    <div data-component="DashboardPage" className="relative flex h-screen overflow-hidden bg-canvas">
      {/* Global sidebar navigation */}
      <AppSidebar
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        activeSection={activeSection}
        onNavigate={handleSidebarNavigate}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar: minimal — toggle + actions */}
        <header className="bg-surface-translucent backdrop-blur-xl border-b border-separator px-4 h-12 flex items-center gap-3 sticky top-0 z-10 shrink-0">
          {/* Sidebar toggle: mobile = open/close, desktop = collapse/expand */}
          <button
            onClick={() => {
              if (isMobileRef.current) {
                setSidebarOpen((prev) => !prev);
              } else {
                handleToggleSidebarCollapse();
              }
            }}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors cursor-pointer"
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="w-4 h-4 text-secondary-label" strokeWidth={1.5} />
            ) : (
              <PanelLeftClose className="w-4 h-4 text-secondary-label" strokeWidth={1.5} />
            )}
          </button>

          {/* Mobile brand (visible only when sidebar is hidden) */}
          <span className="text-[18px] font-bold text-brand tracking-[-0.02em] font-brand select-none whitespace-nowrap shrink-0 lg:hidden">
            radar
          </span>

          <div className="ml-auto flex gap-2 items-center">
            {!isRunningOrPaused && status !== 'idle' && (
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

        {/* Context bar: shows run info (visible on run-scoped pages) */}
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
        {showRunContextBar && (
          <ContextBar
            status={pendingMultiComplete ? 'complete' : status as 'running' | 'budget_paused' | 'complete' | 'error'}
            repoName={multiRunData?.kind === 'multi' ? multiRunData.data.repoName : (currentRun?.repoName ?? '')}
            goal={multiRunData?.kind === 'multi' ? 'all' : currentRun?.goal}
            scorecard={multiRunData?.kind === 'multi' ? multiRunData.data.mergedScorecard : result?.scorecard}
            toolCalls={currentRun?.toolCalls ?? 0}
            budget={currentRun?.budget ?? 0}
            onStop={handleStop}
            onBudgetDecision={status === 'budget_paused' ? handleBudgetDecisionWithApi : undefined}
            onViewResults={pendingMultiComplete ? handleViewMultiResults : undefined}
            activeTab={activeTab}
          />
        )}

        <main className="flex-1 flex flex-col overflow-hidden relative" role="main" aria-label="Main content">
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

          {(isRunningOrPaused || pendingMultiComplete) && currentRun && !historyLoading && (
            <div key="running" className="animate-slide-up flex-1 flex flex-col overflow-hidden relative">
              <AnalysisView
                isLive={isRunningOrPaused}
                liveState={liveState}
                budgetPaused={status === 'budget_paused'}
                budgetPausedData={budgetPausedData}
                onBudgetDecision={handleBudgetDecisionWithApi}
                onSelectWorker={setSelectedParallelWorker}
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

          {(status === 'complete' || status === 'error') && runViewMode && !historyLoading && (
            <div key="complete" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <RunView
                mode={runViewMode}
                activeTab={activeTab}
                onTabChange={handleTabChange}
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
                className="bg-tint text-white rounded-lg h-11 px-5 text-sm font-medium cursor-pointer hover:brightness-110 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-tint-focus"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Runs list page */}
          {status === 'runs' && !historyLoading && (
            <div key="runs" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <RunsListView
                history={history}
                onSelectRun={handleSelectHistory}
                onPrefetch={handlePrefetch}
                onNewAnalysis={handleNewRun}
                hasMore={hasMoreHistory}
                onLoadMore={handleLoadMore}
              />
            </div>
          )}

          {/* Findings triage page */}
          {status === 'findings' && !findingsLoading && (
            <FindingsTriagePage
              findings={findingsData?.findings ?? []}
              runId={findingsData?.runId ?? ''}
              repoName={findingsData?.repoName}
              goal={findingsData?.goal}
              startedAt={findingsData?.startedAt}
              repoUrl={findingsData?.repoUrl}
              isMultiGoal={findingsData?.isMultiGoal}
              goalMap={findingsData?.goalMap}
              availableRuns={findingsRunOptions}
              onRunSwitch={handleRunSwitch}
              onFindingSelect={handleFindingSelect}
              selectedFindingId={urlView.view === 'findings' ? urlView.findingId : undefined}
            />
          )}
          {status === 'findings' && findingsLoading && (
            <div key="findings-loading" className="flex-1 flex flex-col overflow-hidden">
              <RunLoadingSkeleton />
            </div>
          )}

          {/* Reports page */}
          {status === 'reports' && (
            <div key="reports" className="animate-slide-up flex-1 flex flex-col overflow-y-auto px-6 py-8">
              <h1 className="text-xl font-bold font-brand text-label tracking-tight mb-6">Reports</h1>
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <svg className="w-10 h-10 text-quaternary-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-medium text-secondary-label">No reports yet</p>
                  <p className="text-[12px] text-tertiary-label mt-1 max-w-xs">
                    Complete an analysis, then export a PDF or Markdown report from the Overview tab.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Settings page */}
          {status === 'settings' && (
            <div key="settings" className="animate-slide-up flex-1 flex flex-col overflow-y-auto px-6 py-8">
              <h1 className="text-xl font-bold font-brand text-label tracking-tight mb-6">Settings</h1>
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <svg className="w-10 h-10 text-quaternary-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <div className="text-center">
                  <p className="text-sm font-medium text-secondary-label">Settings coming soon</p>
                  <p className="text-[12px] text-tertiary-label mt-1 max-w-xs">
                    GitHub tokens, Jira integration, and Azure DevOps connections will be configured here.
                  </p>
                </div>
              </div>
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
