'use client';

import { useState, useEffect, useCallback } from 'react';
import type { StepEvent } from '@agent/agent/runner';
import type { Scorecard, RunMetrics } from '@agent/types/output';
import { TopBar } from '@/components/TopBar';
import { IdleView } from '@/components/IdleView';
import { RunningView } from '@/components/RunningView';
import { CompleteView } from '@/components/CompleteView';

type DashboardStatus = 'idle' | 'running' | 'budget_paused' | 'complete' | 'error';

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

export default function DashboardPage() {
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [currentRun, setCurrentRun] = useState<CurrentRun | null>(null);
  const [result, setResult] = useState<CompletedResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [budgetPausedData, setBudgetPausedData] = useState<{ findings: number; toolCalls: number; budget: number } | null>(null);
  const [lastRepoPath, setLastRepoPath] = useState('');

  // On mount, check session state (handles page refresh mid-run)
  useEffect(() => {
    fetch('/api/session')
      .then(r => r.json())
      .then(data => {
        if (data.history) setHistory(data.history);
        if (data.status === 'running' || data.status === 'budget_paused') {
          // Restore in-progress run
          if (data.currentRun) {
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
        } else if (data.status === 'complete' && data.result) {
          setResult(data.result);
          setStatus('complete');
        }
      })
      .catch(() => { /* ignore — start fresh */ });
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
    setBudgetPausedData(null);
  }, []);

  const handleNewEvent = useCallback((event: StepEvent) => {
    setCurrentRun(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        events: [...prev.events, event],
        toolCalls: event.step > 0 ? event.step : prev.toolCalls,
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

  const handleNewRun = useCallback(async () => {
    // Reset server session
    await fetch('/api/session', { method: 'DELETE' }).catch(() => {});
    setStatus('idle');
    setCurrentRun(null);
    setResult(null);
    setBudgetPausedData(null);
  }, []);

  const handleSelectHistory = useCallback((_id: string) => {
    // History viewing not yet implemented — could restore result from history
  }, []);

  const isRunningOrPaused = status === 'running' || status === 'budget_paused';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar
        status={status}
        repoName={currentRun?.repoName}
        goal={currentRun?.goal}
        toolCalls={currentRun?.toolCalls}
        budget={currentRun?.budget}
        scorecard={result?.scorecard}
        history={history}
        onNewRun={handleNewRun}
        onSelectHistory={handleSelectHistory}
      />

      {status === 'idle' && (
        <IdleView
          initialRepoPath={lastRepoPath}
          onStart={handleStart}
        />
      )}

      {isRunningOrPaused && currentRun && (
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
      )}

      {(status === 'complete' || status === 'error') && result && currentRun && (
        <CompleteView
          briefMarkdown={result.briefMarkdown}
          scorecard={result.scorecard}
          metrics={result.metrics}
          events={currentRun.events}
          goal={currentRun.goal}
        />
      )}

      {status === 'error' && !result && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
        }}>
          <div style={{ fontSize: 32 }}>✗</div>
          <p style={{ color: 'var(--error)', fontSize: 14 }}>Run failed. Check server logs for details.</p>
          <button
            onClick={handleNewRun}
            style={{
              background: 'var(--accent)',
              color: '#000',
              border: 'none',
              borderRadius: 4,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
