'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { StepEvent, Scorecard, RunMetrics, RunResult, HistoryItem } from '@/lib/agentSession';
import { transformRunData } from '@/lib/runTransform';
import { useKeyboardShortcuts } from '@/lib/useKeyboardShortcuts';
import { useTheme } from '@/lib/useTheme';
import { ContextBar } from '@/components/ContextBar';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { IdleView } from '@/components/IdleView';
import { CompleteView } from '@/components/CompleteView';
import { CompareView, type CompareData } from '@/components/CompareView';
import { AnalysisView } from '@/components/AnalysisView';
import { MultiGoalView, type MultiGoalData } from '@/components/MultiGoalView';
import { useEventSource } from '@/lib/useEventSource';
import { useLiveAnalysis } from '@/lib/useLiveAnalysis';

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

type DashboardStatus = 'idle' | 'running' | 'budget_paused' | 'complete' | 'error' | 'replaying' | 'comparing' | 'multigoal';

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

interface HistoryRunData {
  repoName: string;
  goal: string;
  startedAt: string;
  events: StepEvent[];
  result: RunResult;
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
  const [replayData, setReplayData] = useState<HistoryRunData | null>(null);
  const [isSampleReplay, setIsSampleReplay] = useState(false);
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
  const { mode: themeMode, cycle: cycleTheme, setMode: setThemeMode } = useTheme();

  // Prepend sample run to history
  const fullHistory = useMemo(() => [SAMPLE_HISTORY_ITEM as HistoryItem, ...history], [history]);

  // Auto-open sidebar on desktop
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setSidebarOpen(true);
    }
  }, []);

  // On mount, check session state
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
            setStatus(data.status);
            setIsSampleReplay(false);
            // Restore budget pause data so the overlay appears on reconnect
            if (data.status === 'budget_paused' && data.currentRun.budgetPausedData) {
              setBudgetPausedData(data.currentRun.budgetPausedData);
            }
          }
        } else if (data.status === 'complete' && data.result) {
          setResult(data.result);
          setStatus('complete');
          setIsSampleReplay(false);
        }
      })
      .catch((err) => {
        console.warn('[session] Failed to restore session:', err.message);
      })
      .finally(() => {
        setReady(true);
      });
  }, []);

  const handleStart = useCallback((repoPath: string, goal: string, repoName?: string) => {
    const resolvedName = repoName ?? (repoPath.split(/[/\\]/).pop() || repoPath);
    setLastRepoPath(repoPath);
    setCurrentRun({
      repoPath,
      repoName: resolvedName,
      goal,
      startedAt: new Date(),
      events: [],
      toolCalls: 0,
      budget: 45,
    });
    setStatus('running');
    setResult(null);
    setReplayData(null);
    setIsSampleReplay(false);
    setBudgetPausedData(null);
    setNewRunModal(false);
    setSelectedRunId(null);
    setMultiGoalData(null);
  }, []);

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
    setReplayData(null);
    setIsSampleReplay(false);
    setBudgetPausedData(null);
  }, []);

  const handleNewRun = useCallback(() => {
    setNewRunModal(true);
    setCompareMode(false);
    setCompareSelections([]);
  }, []);

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
  }, []);

  const handleSelectHistory = useCallback(async (id: string) => {
    // In compare mode, delegate to compare select
    if (compareMode) {
      handleCompareSelect(id);
      return;
    }

    // Sample run uses built-in data, no fetch needed
    if (id === SAMPLE_RUN_ID) {
      setReplayData(null);
      setResult(null);
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
      setIsSampleReplay(true);
      setSelectedRunId(id);
      setStatus('replaying');
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
      } catch (err) {
        console.error('[history] Failed to load group:', id, err);
      } finally {
        setHistoryLoading(false);
      }
      return;
    }

    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/history/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (data.error || !data.result) {
        console.warn('[history] No result for run:', id, data.error);
        setHistoryLoading(false);
        setSelectedRunId(id);
        return;
      }
      const runData: HistoryRunData = {
        repoName: data.repoName,
        goal: data.goal,
        startedAt: data.startedAt,
        events: data.events ?? [],
        result: data.result,
      };
      setReplayData(runData);
      setResult(data.result as CompletedResult);
      setCurrentRun({
        repoPath: '',
        repoName: data.repoName,
        goal: data.goal,
        startedAt: new Date(data.startedAt),
        events: data.events ?? [],
        toolCalls: data.events?.length ?? 0,
        budget: data.result.metrics?.toolCalls ?? 45,
      });
      setBudgetPausedData(null);
      setIsSampleReplay(false);
      setSelectedRunId(id);
      setStatus('replaying');
    } catch (err) {
      console.error('[history] Failed to load run:', id, err);
    } finally {
      setHistoryLoading(false);
    }
  }, [compareMode, handleCompareSelect, history]);

  const handleViewReport = useCallback(() => {
    setStatus('complete');
  }, []);

  /** Called when user clicks a goal card in MultiGoalView */
  const handleSelectGoalFromMulti = useCallback((goalId: string, _goal: string) => {
    handleSelectHistory(goalId);
  }, [handleSelectHistory]);

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
  }, [isRunningOrPaused, status, fullHistory, handleNewRun, handleStop, handleSelectHistory, handleToggleCompareMode, handleExitCompare, setThemeMode]);

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
          onNewRun={handleNewRun}
          compareRunNames={[compareData.runA.repoName, compareData.runB.repoName]}
          compareSummary={compareData.diff.summary}
          onExitCompare={handleExitCompare}
        />
      )}
      {status !== 'idle' && status !== 'comparing' && currentRun?.repoName && (
        <ContextBar
          status={
            status === 'replaying'
              ? 'replaying'
              : (status as 'running' | 'budget_paused' | 'complete' | 'error')
          }
          repoName={currentRun.repoName}
          goal={currentRun.goal}
          scorecard={result?.scorecard}
          toolCalls={currentRun.toolCalls}
          budget={currentRun.budget}
          onStop={handleStop}
          onNewRun={handleNewRun}
          onViewReport={isSampleReplay || !result ? undefined : handleViewReport}
          onBudgetDecision={status === 'budget_paused' ? handleBudgetDecisionWithApi : undefined}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          open={sidebarOpen}
          history={fullHistory}
          activeRunId={selectedRunId}
          currentRepoName={currentRun?.repoName}
          currentGoal={currentRun?.goal}
          isRunning={isRunningOrPaused}
          onSelectHistory={handleSelectHistory}
          onNewRun={handleNewRun}
          onClose={() => setSidebarOpen(false)}
          compareMode={compareMode}
          compareSelections={compareSelections}
          onToggleCompare={handleToggleCompareMode}
          onCompareSelect={handleCompareSelect}
          onCompare={handleCompare}
          hasMore={hasMoreHistory}
          onLoadMore={handleLoadMore}
        />

        <main className="flex-1 flex flex-col overflow-hidden relative" aria-label="Main content">
          {status === 'idle' && (
            <div key="idle" className="animate-slide-up flex-1 flex flex-col">
              <IdleView initialRepoPath={lastRepoPath} onStart={handleStart} history={history} />
            </div>
          )}

          {isRunningOrPaused && currentRun && (
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

          {status === 'replaying' && isSampleReplay && (
            <div
              key="sample-replay"
              className="animate-slide-up flex-1 flex flex-col overflow-hidden"
            >
              <AnalysisView />
            </div>
          )}

          {status === 'replaying' && !isSampleReplay && replayData && (
            <div key="replaying" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <AnalysisView runData={transformRunData(replayData.events, replayData.result)} />
            </div>
          )}

          {status === 'comparing' && compareData && (
            <div key="comparing" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <CompareView data={compareData} />
            </div>
          )}

          {status === 'multigoal' && multiGoalData && (
            <div key="multigoal" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <MultiGoalView data={multiGoalData} onSelectGoal={handleSelectGoalFromMulti} />
            </div>
          )}

          {(status === 'complete' || status === 'error') && result && currentRun && (
            <div key="complete" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <CompleteView
                briefMarkdown={result.briefMarkdown}
                scorecard={result.scorecard}
                metrics={result.metrics}
                events={currentRun.events}
                goal={currentRun.goal}
                findings={result.state?.findings}
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
                className="bg-tint text-white rounded-lg h-11 px-5 text-sm font-medium cursor-pointer hover:bg-[#0077ed] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_113_227/0.3)]"
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
            <IdleView compact initialRepoPath={lastRepoPath} onStart={handleStart} history={history} />
          </div>
        </div>
      )}

      {(historyLoading || compareLoading) && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-canvas/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 bg-surface rounded-lg border border-separator shadow-sm px-5 py-3">
            <div
              className="w-4 h-4 border-2 border-tint border-t-transparent rounded-full"
              style={{ animation: 'spin 0.6s linear infinite' }}
            />
            <span className="text-sm text-secondary-label font-medium">
              {compareLoading ? 'Comparing runs...' : 'Loading run...'}
            </span>
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
