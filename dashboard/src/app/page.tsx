'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { StepEvent, Scorecard, RunMetrics, RunResult } from '@/lib/agentSession';
import { useKeyboardShortcuts } from '@/lib/useKeyboardShortcuts';
import { TopBar } from '@/components/TopBar';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette } from '@/components/CommandPalette';
import { IdleView } from '@/components/IdleView';
import { RunningView } from '@/components/RunningView';
import { CompleteView } from '@/components/CompleteView';
import { ReplayView } from '@/components/ReplayView';

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

/** Full history run data for replay */
interface HistoryRunData {
  repoName: string;
  goal: string;
  startedAt: string;
  events: StepEvent[];
  result: RunResult;
}

export default function DashboardPage() {
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [currentRun, setCurrentRun] = useState<CurrentRun | null>(null);
  const [result, setResult] = useState<CompletedResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [budgetPausedData, setBudgetPausedData] = useState<{ findings: number; toolCalls: number; budget: number } | null>(null);
  const [lastRepoPath, setLastRepoPath] = useState('');
  const [replayData, setReplayData] = useState<HistoryRunData | null>(null);
  const [ready, setReady] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // On mount, check session state (handles page refresh mid-run)
  useEffect(() => {
    fetch('/api/session')
      .then(r => r.json())
      .then(data => {
        if (data.history) setHistory(data.history);
        if (data.status === 'running' || data.status === 'budget_paused') {
          // Restore in-progress run (only if agent process is actually alive)
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
          }
          // Agent process not alive — stay idle
        } else if (data.status === 'complete' && data.result) {
          setResult(data.result);
          setStatus('complete');
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
    setBudgetPausedData(null);
  }, []);

  const handleNewEvent = useCallback((event: StepEvent) => {
    setCurrentRun(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        events: [...prev.events, event],
        toolCalls: event.step > 0 ? event.step : prev.toolCalls,
        // Update budget from server when extended (authoritative value)
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
    // Fetch the full result including briefMarkdown from session
    fetch('/api/session')
      .then(r => r.json())
      .then(sessionData => {
        if (sessionData.result) {
          setResult(sessionData.result as CompletedResult);
        } else {
          // Fallback: use partial data from SSE event
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
    // Abort the running agent and reset to idle
    await fetch('/api/session', { method: 'DELETE' }).catch(err => { console.warn('[session] DELETE failed:', err.message); });
    setStatus('idle');
    setCurrentRun(null);
    setResult(null);
    setReplayData(null);
    setBudgetPausedData(null);
  }, []);

  const handleNewRun = useCallback(async () => {
    // Reset server session
    await fetch('/api/session', { method: 'DELETE' }).catch(err => { console.warn('[session] DELETE failed:', err.message); });
    setStatus('idle');
    setCurrentRun(null);
    setResult(null);
    setReplayData(null);
    setBudgetPausedData(null);
  }, []);

  const handleSelectHistory = useCallback(async (id: string) => {
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/history/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (data.error || !data.result) {
        console.warn('[history] No result for run:', id, data.error);
        setHistoryLoading(false);
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
      { id: 'new-run', label: 'New Investigation', shortcut: '\u2318N', action: handleNewRun },
      { id: 'toggle-sidebar', label: 'Toggle Sidebar', action: () => setSidebarOpen(p => !p) },
    ];
    if (isRunningOrPaused) {
      cmds.push({ id: 'stop', label: 'Stop Run', shortcut: '\u2318.', action: handleStop });
    }
    for (const h of history) {
      cmds.push({ id: `history-${h.id}`, label: `Open: ${h.repoName} (${h.goal})`, action: () => handleSelectHistory(h.id) });
    }
    return cmds;
  }, [isRunningOrPaused, history, handleNewRun, handleStop, handleSelectHistory]);

  useKeyboardShortcuts({
    onNewRun: handleNewRun,
    onStop: isRunningOrPaused ? handleStop : undefined,
    onTogglePalette: () => setPaletteOpen(p => !p),
    onEscape: () => { setPaletteOpen(false); setSidebarOpen(false); },
  });

  if (!ready) {
    return <div className="flex flex-col h-screen overflow-hidden bg-canvas" />;
  }

  return (
    <div className="relative flex flex-col h-screen overflow-hidden bg-canvas">
      <TopBar
        status={status === 'replaying' ? 'idle' : status}
        repoName={currentRun?.repoName}
        goal={currentRun?.goal}
        toolCalls={currentRun?.toolCalls}
        budget={currentRun?.budget}
        scorecard={result?.scorecard}
        onNewRun={handleNewRun}
        onStop={handleStop}
        onToggleSidebar={() => setSidebarOpen(prev => !prev)}
        sidebarOpen={sidebarOpen}
        hasHistory={history.length > 0}
      />

      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          open={sidebarOpen}
          history={history}
          currentRepoName={currentRun?.repoName}
          currentGoal={currentRun?.goal}
          isRunning={isRunningOrPaused}
          onSelectHistory={handleSelectHistory}
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

          {status === 'replaying' && replayData && (
            <div key="replaying" className="animate-slide-up flex-1 flex flex-col overflow-hidden">
              <ReplayView
                sourceEvents={replayData.events}
                result={replayData.result}
                repoName={replayData.repoName}
                goal={replayData.goal}
                startedAt={new Date(replayData.startedAt)}
                onViewReport={handleViewReport}
              />
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
