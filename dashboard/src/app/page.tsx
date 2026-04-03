'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import type { StepEvent, Scorecard, RunMetrics, RunResult } from '@/lib/agentSession';
import { transformRunData } from '@/lib/runTransform';
import { useKeyboardShortcuts } from '@/lib/useKeyboardShortcuts';
import { useTheme } from '@/lib/useTheme';
import { ContextBar } from '@/components/ContextBar';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { IdleView } from '@/components/IdleView';
import { RunningView } from '@/components/RunningView';
import { CompleteView } from '@/components/CompleteView';
import { AnalysisView } from '@/components/AnalysisView';

// ─── Constants ──────────────────────────────────────────────────

const SAMPLE_RUN_ID = '__sample__';

const SAMPLE_HISTORY_ITEM = {
  id: SAMPLE_RUN_ID,
  goal: 'onboarding',
  repoName: 'sitecore-minimal',
  startedAt: '2026-04-02T18:25:21.344Z',
  completedAt: '2026-04-02T18:30:45.000Z',
  hasResult: true,
};

// ─── Types ──────────────────────────────────────────────────────

type DashboardStatus = 'idle' | 'running' | 'budget_paused' | 'complete' | 'error' | 'replaying';

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
}

interface HistoryItem {
  id: string;
  goal: string;
  repoName: string;
  startedAt: string;
  completedAt?: string;
  hasResult: boolean;
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
  const [budgetPausedData, setBudgetPausedData] = useState<{ findings: number; toolCalls: number; budget: number } | null>(null);
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
  const { mode: themeMode, cycle: cycleTheme, setMode: setThemeMode } = useTheme();

  // Prepend sample run to history
  const fullHistory = useMemo(() => [SAMPLE_HISTORY_ITEM, ...history], [history]);

  // Auto-open sidebar on desktop
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
      setSidebarOpen(true);
    }
  }, []);

  // On mount, check session state
  useEffect(() => {
    fetch('/api/session')
      .then(r => r.json())
      .then(data => {
        if (data.history) setHistory(data.history);
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
          }
        } else if (data.status === 'complete' && data.result) {
          setResult(data.result);
          setStatus('complete');
          setIsSampleReplay(false);
        }
      })
      .catch(err => { console.warn('[session] Failed to restore session:', err.message); })
      .finally(() => { setReady(true); });
  }, []);

  const handleStart = useCallback((repoPath: string, goal: string) => {
    const repoName = repoPath.split(/[/\\]/).pop() ?? repoPath;
    setLastRepoPath(repoPath);
    setCurrentRun({
      repoPath,
      repoName,
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
  }, []);

  const handleNewEvent = useCallback((event: StepEvent) => {
    setCurrentRun(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        events: [...prev.events, event],
        toolCalls: event.step > 0 ? event.step : prev.toolCalls,
        budget: event.newBudget ?? prev.budget,
      };
    });
  }, []);

  const handleBudgetPaused = useCallback((data: { findings: number; toolCalls: number; budget: number }) => {
    setStatus('budget_paused');
    setBudgetPausedData(data);
  }, []);

  const handleBudgetDecision = useCallback((extend: boolean) => {
    if (extend) {
      setStatus('running');
      setCurrentRun(prev => prev ? { ...prev, budget: prev.budget + 50 } : prev);
    } else {
      setStatus('running');
    }
    setBudgetPausedData(null);
  }, []);

  const handleRunComplete = useCallback((data: { scorecard: unknown; metrics: unknown; terminationReason: string }) => {
    fetch('/api/session')
      .then(r => r.json())
      .then(sessionData => {
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
  }, []);

  const handleRunError = useCallback((error: string) => {
    console.error('Run error:', error);
    setStatus('error');
  }, []);

  const handleStop = useCallback(async () => {
    await fetch('/api/session', { method: 'DELETE' }).catch(err => { console.warn('[session] DELETE failed:', err.message); });
    setStatus('idle');
    setCurrentRun(null);
    setResult(null);
    setReplayData(null);
    setIsSampleReplay(false);
    setBudgetPausedData(null);
  }, []);

  const handleNewRun = useCallback(() => {
    setNewRunModal(true);
  }, []);

  const handleSelectHistory = useCallback(async (id: string) => {
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
  }, []);

  const handleViewReport = useCallback(() => {
    setStatus('complete');
  }, []);

  const isRunningOrPaused = status === 'running' || status === 'budget_paused';

  const commands = useMemo(() => {
    const cmds = [
      { id: 'new-run', label: 'New Analysis', shortcut: '\u2318N', action: handleNewRun },
      { id: 'toggle-sidebar', label: 'Toggle Sidebar', action: () => setSidebarOpen(p => !p) },
    ];
    if (isRunningOrPaused) {
      cmds.push({ id: 'stop', label: 'Stop Run', shortcut: '\u2318.', action: handleStop });
    }
    cmds.push(
      { id: 'theme-light', label: 'Theme: Light', action: () => setThemeMode('light') },
      { id: 'theme-dark', label: 'Theme: Dark', action: () => setThemeMode('dark') },
      { id: 'theme-system', label: 'Theme: System', action: () => setThemeMode('system') },
    );
    for (const h of fullHistory) {
      cmds.push({ id: `history-${h.id}`, label: `Open: ${h.repoName} (${h.goal})`, action: () => handleSelectHistory(h.id) });
    }
    return cmds;
  }, [isRunningOrPaused, fullHistory, handleNewRun, handleStop, handleSelectHistory, setThemeMode]);

  useKeyboardShortcuts({
    onNewRun: handleNewRun,
    onStop: isRunningOrPaused ? handleStop : undefined,
    onTogglePalette: () => setPaletteOpen(p => !p),
    onEscape: () => { setPaletteOpen(false); setSidebarOpen(false); setNewRunModal(false); },
  });

  if (!ready) {
    return <div className="flex flex-col h-screen overflow-hidden bg-canvas" />;
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-canvas">
      <header className="bg-surface-translucent backdrop-blur-xl shadow-[inset_0_-1px_0_0_rgb(0_0_0/0.06)] px-4 h-12 flex items-center gap-3 sticky top-0 z-10 shrink-0">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(prev => !prev)}
          className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-elevated transition-colors cursor-pointer"
          title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        >
          <svg className="w-4 h-4 text-secondary-label" viewBox="0 0 16 16" fill="currentColor">
            <rect y="2" width="16" height="1.5" rx="0.75" />
            <rect y="7.25" width="16" height="1.5" rx="0.75" />
            <rect y="12.5" width="16" height="1.5" rx="0.75" />
          </svg>
        </button>

        {/* Brand */}
        <span className="text-[17px] font-bold text-tint tracking-tight font-brand select-none whitespace-nowrap shrink-0">
          radar
        </span>

        <div className="ml-auto flex gap-2 items-center">
          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
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

      {/* Context bar: shows run info (hidden when idle) */}
      {status !== 'idle' && currentRun?.repoName && (
        <ContextBar
          status={status === 'replaying' ? 'replaying' : status as 'running' | 'budget_paused' | 'complete' | 'error'}
          repoName={currentRun.repoName}
          goal={currentRun.goal}
          scorecard={result?.scorecard}
          toolCalls={currentRun.toolCalls}
          budget={currentRun.budget}
          onStop={handleStop}
          onNewRun={handleNewRun}
          onViewReport={handleViewReport}
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
        />

        <main className="flex-1 flex flex-col overflow-hidden relative">
          {status === 'idle' && (
            <div key="idle" className="animate-slide-up flex-1 flex flex-col">
              <IdleView
                initialRepoPath={lastRepoPath}
                onStart={handleStart}
              />
            </div>
          )}

          {isRunningOrPaused && currentRun && (
            <div key="running" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <RunningView
                events={currentRun.events}
                status={status as 'running' | 'budget_paused'}
                toolCalls={currentRun.toolCalls}
                budget={currentRun.budget}
                startedAt={currentRun.startedAt}
                budgetPausedData={budgetPausedData}
                onNewEvent={handleNewEvent}
                onBudgetPaused={handleBudgetPaused}
                onBudgetDecision={handleBudgetDecision}
                onRunComplete={handleRunComplete}
                onRunError={handleRunError}
              />
            </div>
          )}

          {status === 'replaying' && isSampleReplay && (
            <div key="sample-replay" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <AnalysisView />
            </div>
          )}

          {status === 'replaying' && !isSampleReplay && replayData && (
            <div key="replaying" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <AnalysisView runData={transformRunData(replayData.events, replayData.result)} />
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
              />
            </div>
          )}

          {status === 'error' && !result && (
            <div key="error" className="animate-scale-in flex-1 flex items-center justify-center flex-col gap-4">
              <svg className="w-10 h-10 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6M9 9l6 6" />
              </svg>
              <p className="text-danger text-sm">Run failed. Check server logs for details.</p>
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
            <IdleView
              initialRepoPath={lastRepoPath}
              onStart={handleStart}
            />
          </div>
        </div>
      )}

      {historyLoading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-canvas/60 backdrop-blur-sm">
          <div className="flex items-center gap-3 bg-surface rounded-lg border border-separator shadow-sm px-5 py-3">
            <div className="w-4 h-4 border-2 border-tint border-t-transparent rounded-full" style={{ animation: 'spin 0.6s linear infinite' }} />
            <span className="text-sm text-secondary-label font-medium">Loading run...</span>
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
