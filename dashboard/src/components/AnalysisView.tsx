'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { Finding, TransformedRunData } from '@/lib/runTransform';
import { buildInstantState } from '@/lib/runTransform';
import { SAMPLE_ANALYSIS_TURNS, SAMPLE_FINDINGS } from '@/lib/sampleRunData';
import { useAnimationSequence } from '@/lib/useAnimationSequence';
import type { LiveAnalysisState } from '@/lib/useLiveAnalysis';
import { BudgetPausedView } from '@/components/BudgetPausedView';
import { PhaseRail } from '@/components/analysis/PhaseRail';
import { ReasoningStream } from '@/components/analysis/ReasoningStream';
import { RightPanel } from '@/components/analysis/RightPanel';
import { WorkerLaneGrid } from '@/components/analysis/WorkerLaneGrid';
import { SpecialistLaneGrid } from '@/components/analysis/SpecialistLaneGrid';
import { SynthesisBar } from '@/components/analysis/SynthesisBar';

// ─── Props ──────────────────────────────────────────────────────

interface AnalysisViewProps {
  runData?: TransformedRunData;
  isLive?: boolean;
  liveState?: LiveAnalysisState;
  viewMode?: 'instant' | 'replay';
  onStartReplay?: () => void;
  budgetPaused?: boolean;
  budgetPausedData?: { findings: number; toolCalls: number; budget: number } | null;
  onBudgetDecision?: (extend: boolean) => void;
  onSelectWorker?: (id: string) => void;
  onSelectSpecialist?: (id: string | null) => void;
}

// ─── Analysis View ───────────────────────────────────────────────

export function AnalysisView({
  runData,
  isLive,
  liveState,
  viewMode = 'instant',
  onStartReplay,
  budgetPaused,
  budgetPausedData,
  onBudgetDecision,
  onSelectWorker,
  onSelectSpecialist,
}: AnalysisViewProps) {

  // ─── State source routing ──────────────────────────────────────

  const [internalReplay, setInternalReplay] = useState(false);
  const effectiveViewMode = onStartReplay ? viewMode : (internalReplay ? 'replay' : viewMode);

  const DATA_TURNS = runData?.analysisTurns ?? SAMPLE_ANALYSIS_TURNS;
  const DATA_FINDINGS: Finding[] = runData?.findings ?? SAMPLE_FINDINGS;
  const DATA_BATCHES = runData?.findingBatches ?? [4, 5, 4];

  const isInstant = !isLive && effectiveViewMode === 'instant';
  const instantState = useMemo(() => {
    if (isInstant && runData) return buildInstantState(runData);
    return null;
  }, [isInstant, runData]);

  const animState = useAnimationSequence(DATA_TURNS, DATA_FINDINGS, DATA_BATCHES, {
    fastMode: true,
  });

  const {
    phase, turns, typingText, activeTurnIndex,
    examinedFiles, findings,
    progressPercent, pendingActions, statusMessage,
    findingProgress,
  } =
    isLive && liveState
      ? liveState
      : instantState
        ? { ...instantState, findingProgress: null }
        : { ...animState, statusMessage: '', findingProgress: null };

  // ─── UI state ──────────────────────────────────────────────────

  const [verbose, setVerbose] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth >= 1024;
    return true;
  });

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setRightPanelOpen(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ─── Run timer ─────────────────────────────────────────────────

  const [elapsed, setElapsed] = useState(0);
  const timerStart = useRef<number | null>(null);
  useEffect(() => {
    if (!isLive || phase === 'idle') {
      timerStart.current = null;
      return;
    }
    if (!timerStart.current) timerStart.current = Date.now();
    if (phase === 'done') {
      setElapsed(Math.floor((Date.now() - timerStart.current) / 1000));
      return;
    }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - timerStart.current!) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isLive, phase]);

  // ─── Replay controls ──────────────────────────────────────────

  const startReplay = useCallback(() => {
    if (!onStartReplay) setInternalReplay(true);
    else onStartReplay();
    animState.run();
  }, [onStartReplay, animState]);

  const handleRun = useCallback(() => {
    if (!isLive) animState.run();
  }, [isLive, animState]);

  const handleReset = useCallback(() => {
    if (!isLive) animState.reset();
  }, [isLive, animState]);

  // ─── Derived ───────────────────────────────────────────────────

  const isWriting = phase === 'recording' || phase === 'assembling';
  const accentColor =
    isWriting || phase === 'done'
      ? 'var(--color-success)'
      : phase === 'switching'
        ? 'var(--color-warning)'
        : 'var(--color-tint)';

  // Parallel mode state
  const isParallel = isLive && liveState?.isParallel;
  const workers = liveState?.workers ?? null;
  const synthesisStatus = liveState?.synthesisStatus ?? null;
  const effectiveSelectedWorker = liveState?.selectedWorkerId ?? null;
  const workerCount = workers ? workers.size : 0;
  const completeCount = workers ? [...workers.values()].filter(w => w.status === 'complete').length : 0;

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div data-component="AnalysisView" className="flex flex-1 overflow-hidden relative">
      {/* Left: phase bar + scrollable stream */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <PhaseRail
          phase={phase}
          progressPercent={progressPercent}
          isLive={!!isLive}
          isInstant={isInstant}
          budgetPaused={budgetPaused}
          statusMessage={statusMessage}
          elapsed={elapsed}
          verbose={verbose}
          onToggleVerbose={() => setVerbose(v => !v)}
          rightPanelOpen={rightPanelOpen}
          onTogglePanel={() => setRightPanelOpen(p => !p)}
          onStartReplay={startReplay}
          onRun={handleRun}
          onReset={handleReset}
          accentColor={accentColor}
          isParallel={!!isParallel}
          workerCount={workerCount}
          workerCompleteCount={completeCount}
        />

        {/* Parallel mode: worker lane grid */}
        {isParallel && workers && (
          <WorkerLaneGrid
            workers={workers}
            selectedWorkerId={effectiveSelectedWorker}
            onSelectWorker={onSelectWorker ?? (() => {})}
          />
        )}

        {/* Sequential specialist mode: specialist lane grid */}
        {!isParallel && liveState?.specialists && (
          <SpecialistLaneGrid
            specialists={liveState.specialists}
            selectedSpecialistId={liveState.selectedSpecialistId}
            onSelectSpecialist={onSelectSpecialist ?? (() => {})}
          />
        )}

        <ReasoningStream
          phase={phase}
          turns={turns}
          typingText={typingText}
          activeTurnIndex={activeTurnIndex}
          pendingActions={pendingActions}
          findings={findings}
          isLive={!!isLive}
          isInstant={isInstant}
          verbose={verbose}
          accentColor={accentColor}
          findingProgress={findingProgress}
        />

        {/* Parallel mode: synthesis bar */}
        {isParallel && synthesisStatus && (
          <SynthesisBar
            status={synthesisStatus}
            workerCount={workerCount}
            completeCount={completeCount}
          />
        )}
      </div>

      {/* Right sidebar */}
      <RightPanel
        isOpen={rightPanelOpen}
        phase={phase}
        isLive={!!isLive}
        examinedFiles={examinedFiles}
        findings={findings}
      />

      {/* Budget pause overlay */}
      {isLive && budgetPaused && budgetPausedData && onBudgetDecision && (
        <BudgetPausedView
          findings={budgetPausedData.findings}
          toolCalls={budgetPausedData.toolCalls}
          budget={budgetPausedData.budget}
          onDecision={onBudgetDecision}
        />
      )}
    </div>
  );
}
