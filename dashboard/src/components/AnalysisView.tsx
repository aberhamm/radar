'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Finding, TransformedRunData } from '@/lib/runTransform';
import { CATEGORIES } from '@/lib/runTransform';
import { SAMPLE_ANALYSIS_TURNS, SAMPLE_FINDINGS } from '@/lib/sampleRunData';
import { useAnimationSequence } from '@/lib/useAnimationSequence';
import type { LiveAnalysisState } from '@/lib/useLiveAnalysis';
import { ActivityChipGroup } from '@/components/ActivityChip';
import { FindingCard } from '@/components/FindingCard';
import { FileTree } from '@/components/FileTree';
import { BudgetPausedView } from '@/components/BudgetPausedView';
import { StaggeredSpinner } from '@/components/Skeleton';

// ─── Props ──────────────────────────────────────────────────────

interface AnalysisViewProps {
  runData?: TransformedRunData;
  isLive?: boolean;
  liveState?: LiveAnalysisState;
  budgetPaused?: boolean;
  budgetPausedData?: { findings: number; toolCalls: number; budget: number } | null;
  onBudgetDecision?: (extend: boolean) => void;
}

// ─── Analysis View ───────────────────────────────────────────────

export function AnalysisView({ runData, isLive, liveState, budgetPaused, budgetPausedData, onBudgetDecision }: AnalysisViewProps) {
  // Use real data when provided, fall back to sample data
  const DATA_TURNS = runData?.analysisTurns ?? SAMPLE_ANALYSIS_TURNS;
  const DATA_FINDINGS: Finding[] = runData?.findings ?? SAMPLE_FINDINGS;
  const DATA_BATCHES = runData?.findingBatches ?? [4, 5, 4];

  // Separate switch turn from analysis turns
  const switchIndex = DATA_TURNS.findIndex(t => t.activities.some(a => a.label === 'switch_to_fast_model'));
  const INV_TURNS = switchIndex >= 0 ? DATA_TURNS.slice(0, switchIndex) : DATA_TURNS;
  const HAS_SWITCH = switchIndex >= 0;

  // Animation hook (used for replay mode; runs but is ignored in live mode)
  const animState = useAnimationSequence(INV_TURNS, DATA_FINDINGS, DATA_BATCHES, HAS_SWITCH);

  // Pick state source: live events or animation replay
  const {
    phase, turns, typingText, activeTurnIndex, coveredTopics,
    examinedFiles, findings, scoreVisible, progressPercent, pendingActions,
    statusMessage,
  } = isLive && liveState ? liveState : { ...animState, statusMessage: '' };

  // Findings for score panel: live findings grow over time, replay uses full set
  const scorePanelFindings = isLive ? findings : DATA_FINDINGS;

  // UI-only state
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [findingsCollapsed, setFindingsCollapsed] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const filesScrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [verbose, setVerbose] = useState(true);
  const isAutoScrolling = useRef(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth >= 1024;
    return true;
  });

  // Auto-collapse right panel on tablet
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setRightPanelOpen(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Run timer
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

  // Auto-scroll the files list when new files appear
  useEffect(() => {
    if (filesScrollRef.current && !filesCollapsed) {
      filesScrollRef.current.scrollTop = filesScrollRef.current.scrollHeight;
    }
  }, [examinedFiles, filesCollapsed]);

  // Auto-scroll the stream (only when autoScroll is enabled)
  useEffect(() => {
    if (streamRef.current && autoScroll) {
      isAutoScrolling.current = true;
      streamRef.current.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
      setTimeout(() => { isAutoScrolling.current = false; }, 150);
    }
  }, [turns, typingText, activeTurnIndex, autoScroll]);

  // Detect manual scroll-up to pause autoscroll
  const handleStreamScroll = useCallback(() => {
    if (isAutoScrolling.current) return;
    const el = streamRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setAutoScroll(atBottom);
  }, []);

  // Replay controls (no-ops in live mode)
  const handleRun = useCallback(() => {
    setAutoScroll(true);
    if (!isLive) animState.run();
  }, [isLive, animState]);

  const handleReset = useCallback(() => {
    setAutoScroll(true);
    if (!isLive) animState.reset();
  }, [isLive, animState]);

  const isWriting = phase === 'recording' || phase === 'assembling';
  const accentColor = isWriting || phase === 'done' ? 'var(--color-success)' : phase === 'switching' ? 'var(--color-warning)' : 'var(--color-tint)';

  return (
      <div className="flex flex-1 overflow-hidden relative">
        {/* Left: phase bar + scrollable stream */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Phase progress rail */}
          <div className="h-10 px-4 flex items-center gap-4 border-b border-separator bg-surface-translucent backdrop-blur-sm shrink-0">
            {/* Live indicator or Play/Reset button */}
            {isLive ? (
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: budgetPaused ? 'var(--color-warning)' : phase === 'done' ? 'var(--color-success)' : 'var(--color-tint)',
                    animation: phase !== 'done' ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
                  }}
                />
                <span className="text-[10px] font-bold tracking-wider text-secondary-label">
                  {budgetPaused ? 'PAUSED' : phase === 'done' ? 'DONE' : 'LIVE'}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={phase === 'idle' || phase === 'done' ? handleRun : handleReset}
                className={`px-3 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer shrink-0 ${
                  phase === 'idle' || phase === 'done'
                    ? 'bg-tint text-white hover:brightness-110 active:scale-95'
                    : 'bg-elevated text-tertiary-label hover:text-label'
                }`}
              >
                {phase === 'idle' ? 'Play' : phase === 'done' ? 'Replay' : 'Reset'}
              </button>
            )}
              {/* Status dot + label */}
              <div className="flex items-center gap-2 shrink-0">
                {phase !== 'idle' && !isLive && (
                  <div
                    className="w-1.5 h-1.5 rounded-full transition-all duration-500"
                    style={{
                      background: accentColor,
                      animation: phase !== 'done' ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
                    }}
                  />
                )}
                <span className="text-[11px] font-semibold text-label">
                  {statusMessage
                    ? statusMessage
                    : phase === 'idle' ? (isLive ? 'Starting' : 'Ready') : phase === 'analyzing' ? 'Analyzing' : phase === 'switching' ? 'Switching' : phase === 'recording' ? 'Recording' : phase === 'assembling' ? 'Assembling' : 'Complete'}
                </span>
                {isLive && elapsed > 0 && (
                  <span className="text-[10px] font-mono text-tertiary-label">
                    {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                  </span>
                )}
              </div>

              {/* Unified progress bar */}
              {(() => {
                const pct = progressPercent;
                const fillColor = phase === 'switching'
                  ? 'var(--color-warning)'
                  : phase === 'recording' || phase === 'assembling' || phase === 'done'
                    ? 'var(--color-success)'
                    : 'var(--color-tint)';
                const isActive = phase !== 'done' && phase !== 'idle';
                return (
                  <div
                    className="flex-1 h-[4px] rounded-full overflow-hidden relative"
                    style={{
                      background: 'var(--color-elevated)',
                      opacity: phase === 'idle' && !isLive ? 0 : 1,
                      transition: 'opacity 0.4s ease',
                    }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${fillColor}, color-mix(in srgb, ${fillColor} 85%, white))`,
                        transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.6s ease',
                      }}
                    />
                    {isActive && (
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)',
                          backgroundSize: '200% 100%',
                          animation: 'progress-shimmer 2s ease-in-out infinite',
                          transition: 'width 1.2s cubic-bezier(0.16, 1, 0.3, 1)',
                        }}
                      />
                    )}
                    {isActive && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full"
                        style={{
                          left: `${pct}%`,
                          transform: 'translate(-50%, -50%)',
                          background: fillColor,
                          opacity: 0.5,
                          filter: 'blur(4px)',
                          animation: 'progress-glow 1.8s ease-in-out infinite',
                          transition: 'left 1.2s cubic-bezier(0.16, 1, 0.3, 1), background 0.6s ease',
                        }}
                      />
                    )}
                  </div>
                );
              })()}

              {/* Verbose toggle */}
              <button
                type="button"
                onClick={() => setVerbose(v => !v)}
                className="ml-auto text-[10px] font-medium text-tertiary-label hover:text-label transition-colors cursor-pointer shrink-0 flex items-center gap-1"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
                  {verbose ? (
                    <>
                      <path d="M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5-3-5-6.5-5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
                    </>
                  ) : (
                    <>
                      <path d="M8 3C4.5 3 1.5 8 1.5 8s3 5 6.5 5 6.5-5 6.5-5-3-5-6.5-5z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                    </>
                  )}
                </svg>
                {verbose ? 'Verbose' : 'Compact'}
              </button>

              {/* Panel toggle */}
              <button
                type="button"
                onClick={() => setRightPanelOpen(p => !p)}
                className="text-[10px] font-medium text-tertiary-label hover:text-label transition-colors cursor-pointer shrink-0 flex items-center gap-1"
                aria-label={rightPanelOpen ? 'Hide findings panel' : 'Show findings panel'}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="shrink-0">
                  <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
                  <line x1="11" y1="2" x2="11" y2="14" stroke="currentColor" strokeWidth="1.3" />
                </svg>
                {rightPanelOpen ? 'Hide' : 'Panel'}
              </button>
            </div>
            <div className="flex-1 relative overflow-hidden">
              <div
                ref={streamRef}
                onScroll={handleStreamScroll}
                className="absolute inset-0 overflow-y-auto p-4 space-y-1"
              >
                {/* Idle / loading state */}
                {phase === 'idle' && !isLive && (
                  <div className="text-xs text-quaternary-label text-center pt-32">
                    Press Play to watch the full agent run
                  </div>
                )}

                {/* Live: waiting for first event */}
                {isLive && turns.length === 0 && !typingText && (
                  <div className="flex flex-col items-center justify-center gap-3 pt-24 text-center animate-slide-up">
                    <StaggeredSpinner color={accentColor} size={22} />
                    <div>
                      <div className="text-sm font-medium text-secondary-label">
                        {pendingActions.length > 0
                          ? pendingActions.length === 1
                            ? pendingActions[0].replace(/_/g, ' ')
                            : `Running ${pendingActions.length} tools in parallel`
                          : 'Agent is starting up'}
                      </div>
                      <div className="text-xs text-tertiary-label mt-0.5">Events will stream in real-time</div>
                    </div>
                  </div>
                )}

                {/* Committed turns */}
                <div className="relative">
                  {/* Vertical connector rail */}
                  {turns.length > 1 && (
                    <div
                      className="absolute left-[9px] top-4 bottom-4 w-px"
                      style={{
                        background: `linear-gradient(to bottom, var(--color-separator), color-mix(in srgb, ${accentColor} 30%, var(--color-separator)), var(--color-separator))`,
                      }}
                    />
                  )}

                  {turns.map((turn, i) => {
                    if (turn.isSwitch) {
                      return (
                        <div
                          key={`switch-${i}`}
                          className="flex items-center gap-3 px-4 py-3 my-3 rounded-xl bg-[rgba(255,159,10,0.05)] border border-[rgba(255,159,10,0.15)] relative z-[1]"
                          style={{ animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both' }}
                        >
                          <div className="w-7 h-7 rounded-full bg-[rgba(255,159,10,0.1)] flex items-center justify-center shrink-0">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                              <path d="M3 8h10M10 5l3 3-3 3M6 11L3 8l3-3" stroke="var(--color-warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-warning">Analysis Complete</div>
                            <div className="text-[10px] text-tertiary-label">Switching to fast model for writing</div>
                          </div>
                        </div>
                      );
                    }

                    const isRecent = i >= turns.length - 2;
                    const isActive = activeTurnIndex === i;
                    const isWrite = turn.phase === 'write';
                    const hasActivities = turn.activities.length > 0;

                    // Derive turn status icon
                    let iconColor = 'var(--color-tertiary-label)';
                    let icon: React.ReactNode;

                    if (isActive) {
                      // Active: pulsing dot
                      iconColor = accentColor;
                      icon = (
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: accentColor, animation: 'pulse-dot 1.2s ease-in-out infinite' }}
                        />
                      );
                    } else if (isWrite) {
                      // Write phase: pen icon
                      iconColor = 'var(--color-success)';
                      icon = (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M8.5 1.5l2 2L4 10H2v-2l6.5-6.5z" stroke="var(--color-success)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      );
                    } else if (hasActivities) {
                      // Investigative: magnifying glass
                      iconColor = 'var(--color-tertiary-label)';
                      icon = (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" />
                          <path d="M7.5 7.5L10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                      );
                    } else {
                      // Complete: checkmark
                      icon = (
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6.5L5 9l4.5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      );
                    }

                    return (
                      <div
                        key={i}
                        className={`flex gap-2.5 py-2 transition-opacity duration-300 ${isRecent ? 'opacity-100' : 'opacity-40 hover:opacity-100 focus-within:opacity-100'}`}
                      >
                        {/* Status icon waypoint */}
                        <div
                          className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 mt-0.5 relative z-[1] transition-all duration-300"
                          style={{
                            background: isActive
                              ? `color-mix(in srgb, ${accentColor} 12%, var(--color-surface))`
                              : 'var(--color-surface)',
                            color: iconColor,
                            boxShadow: isActive
                              ? `0 0 0 2px color-mix(in srgb, ${accentColor} 20%, transparent)`
                              : '0 0 0 1px var(--color-separator)',
                          }}
                        >
                          {icon}
                        </div>

                        {/* Turn content */}
                        <div className="flex-1 min-w-0">
                          <div className={`md-content text-[13px] leading-relaxed ${
                            isWrite ? 'text-success' : 'text-secondary-label'
                          }`}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {verbose ? turn.reasoning : (turn.reasoning.length > 150 ? turn.reasoning.slice(0, 150) + '\u2026' : turn.reasoning)}
                            </ReactMarkdown>
                          </div>

                          {hasActivities && (
                            <ActivityChipGroup activities={turn.activities} active={isActive} accentColor={accentColor} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Currently typing */}
                {typingText && (
                  <div className="py-2">
                    <div className={`md-content text-[13px] leading-relaxed ${isWriting ? 'text-success' : 'text-label'}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{typingText}</ReactMarkdown>
                      <span
                        className="inline-block w-[2px] h-[14px] ml-0.5 align-text-bottom rounded-full"
                        style={{ background: accentColor, animation: 'pulse-dot 0.8s step-end infinite' }}
                      />
                    </div>
                  </div>
                )}

                {/* Thinking indicator: shows between turns when no typing text yet */}
                {isLive && !typingText && turns.length > 0 && phase !== 'done' && (
                  <div className="py-2 flex items-center gap-2" style={{ animation: 'fadeIn 0.4s ease 0.6s both' }}>
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            background: accentColor,
                            opacity: 0.4,
                            animation: `pulse-dot 1.2s ease-in-out ${i * 0.2}s infinite`,
                          }}
                        />
                      ))}
                    </div>
                    {pendingActions.length > 0 && (
                      <span className="text-[11px] text-tertiary-label" style={{ animation: 'fadeIn 0.2s ease both' }}>
                        {pendingActions.length === 1
                          ? pendingActions[0].replace(/_/g, ' ')
                          : `${pendingActions.length} tools in parallel`}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Resume autoscroll button */}
              {!autoScroll && phase !== 'idle' && phase !== 'done' && (
                <button
                  type="button"
                  onClick={() => setAutoScroll(true)}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface border border-separator shadow-card text-[10px] font-medium text-secondary-label cursor-pointer hover:bg-elevated transition-all"
                  style={{ animation: 'fadeIn 0.2s ease both' }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M5 2v6M3 6l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Resume
                </button>
              )}
            </div>

            {/* Bottom: topic coverage */}
            <div className="border-t border-separator bg-surface-translucent shrink-0">
              <div className="px-4 pt-2 pb-1 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wide text-tertiary-label font-semibold">Topics</div>
                {coveredTopics.size > 0 && (
                  <span className="text-[10px] font-mono text-quaternary-label">{coveredTopics.size}/{CATEGORIES.length}</span>
                )}
              </div>
              <div className="px-4 pb-2 flex flex-wrap gap-1">
                {CATEGORIES.map(cat => {
                  const isTouched = coveredTopics.has(cat.id);
                  const hasFindings = findings.some(f => f.category === cat.id);
                  // 3 levels: not started → touched (tool calls) → confirmed (findings)
                  const level = hasFindings ? 2 : isTouched ? 1 : 0;

                  return (
                    <span
                      key={cat.id}
                      className="relative text-[9px] font-medium px-2 py-0.5 rounded-md transition-all duration-300 overflow-hidden"
                      style={{
                        color: level === 2
                          ? 'var(--color-tint)'
                          : level === 1
                            ? 'var(--color-secondary-label)'
                            : 'var(--color-quaternary-label)',
                        background: level === 0 ? 'transparent' : undefined,
                      }}
                    >
                      {/* Fill bar background */}
                      {level > 0 && (
                        <span
                          className="absolute inset-0 rounded-md transition-all duration-500"
                          style={{
                            background: level === 2
                              ? 'rgba(0,113,227,0.08)'
                              : 'rgba(0,113,227,0.03)',
                            width: level === 2 ? '100%' : '50%',
                          }}
                        />
                      )}
                      <span className="relative">
                        {level === 2 && (
                          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="inline mr-0.5 -mt-px">
                            <path d="M2.5 6.5L5 9l4.5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                        {level === 1 && (
                          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="inline mr-0.5 -mt-px">
                            <circle cx="6" cy="6" r="2" fill="currentColor" opacity="0.4" />
                          </svg>
                        )}
                        {cat.label}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right sidebar: files examined + findings */}
          <div className={`border-l border-separator bg-canvas flex flex-col shrink-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${rightPanelOpen ? 'w-[260px]' : 'w-0 border-l-0'}`}>
          <div className="w-[260px] flex flex-col h-full">
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {/* Files examined section */}
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => setFilesCollapsed(p => !p)}
                  className="w-full h-10 px-3 flex items-center justify-between cursor-pointer hover:bg-elevated/50 transition-colors border-b border-separator bg-surface"
                >
                  <div className="text-[10px] uppercase tracking-wide text-tertiary-label font-semibold">
                    Files Examined
                  </div>
                  <div className="flex items-center gap-1.5">
                    {examinedFiles.length > 0 && (
                      <span className="text-[10px] font-mono text-quaternary-label">{examinedFiles.length}</span>
                    )}
                    <svg
                      width="8" height="8" viewBox="0 0 8 8" fill="none"
                      className={`text-quaternary-label transition-transform duration-200 ${filesCollapsed ? '-rotate-90' : ''}`}
                    >
                      <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>
                {!filesCollapsed && (
                  <div
                    ref={filesScrollRef}
                    className="px-2 py-2 h-[200px] overflow-y-auto"
                    style={{ animation: 'expand-down 0.2s cubic-bezier(0.16, 1, 0.3, 1) both' }}
                  >
                    <FileTree files={examinedFiles} />
                  </div>
                )}
              </div>

              {/* Findings section */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                <button
                  type="button"
                  onClick={() => setFindingsCollapsed(p => !p)}
                  className="w-full h-10 px-3 flex items-center justify-between cursor-pointer hover:bg-elevated/50 transition-colors border-b border-separator bg-surface"
                >
                  <div className="text-[10px] uppercase tracking-wide text-tertiary-label font-semibold">
                    Findings
                  </div>
                  <div className="flex items-center gap-1.5">
                    {findings.length > 0 && (
                      <span className="text-[10px] font-mono text-quaternary-label">{findings.length}</span>
                    )}
                    <svg
                      width="8" height="8" viewBox="0 0 8 8" fill="none"
                      className={`text-quaternary-label transition-transform duration-200 ${findingsCollapsed ? '-rotate-90' : ''}`}
                    >
                      <path d="M2 3l2 2 2-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </button>
                {!findingsCollapsed && (
                  <div
                    className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5 min-h-0"
                    style={{ animation: 'expand-down 0.2s cubic-bezier(0.16, 1, 0.3, 1) both' }}
                  >
                    {findings.length === 0 && (phase !== 'idle' || isLive) && (
                      <div className="text-[10px] text-quaternary-label text-center pt-1 pb-2">
                        Findings appear after analysis
                      </div>
                    )}
                    {findings.length === 0 && phase === 'idle' && !isLive && (
                      <div className="text-[10px] text-quaternary-label text-center pt-1 pb-2">
                        &mdash;
                      </div>
                    )}

                    {findings.map((f, i) => (
                      <FindingCard key={`${f.id}-${i}`} finding={f} index={i} />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Scorecard at bottom */}
            <div className="border-t border-separator bg-surface-translucent shrink-0">
              <div className="px-3 pt-2 pb-1 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wide text-tertiary-label font-semibold">Score</div>
                {scoreVisible && (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(255,59,48,0.08)] text-danger"
                    style={{ animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both' }}
                  >RED</span>
                )}
              </div>
              <div className="px-3 pb-2 flex gap-1.5">
                {[
                  { n: scorePanelFindings.filter(f => f.severity === 'critical').length, l: 'Crit', c: 'var(--color-danger)' },
                  { n: scorePanelFindings.filter(f => f.severity === 'high').length, l: 'High', c: 'var(--color-danger)' },
                  { n: scorePanelFindings.filter(f => f.severity === 'medium').length, l: 'Med', c: 'var(--color-warning)' },
                  { n: scorePanelFindings.filter(f => f.severity === 'low' || f.severity === 'info').length, l: 'Low', c: 'var(--color-success)' },
                ].map(s => {
                  const showCount = isLive ? findings.length > 0 : scoreVisible;
                  return (
                    <div
                      key={s.l}
                      className={`flex-1 text-center rounded-md py-0.5 transition-all duration-500 ${showCount ? (scoreVisible ? 'opacity-100' : 'opacity-40') : 'opacity-30'}`}
                      style={showCount ? {
                        background: `color-mix(in srgb, ${s.c} 6%, transparent)`,
                        animation: scoreVisible ? 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both' : undefined,
                      } : undefined}
                    >
                      <div className="text-xs font-bold font-brand" style={{ color: showCount ? s.c : 'var(--color-quaternary-label)' }}>
                        {showCount ? s.n : '\u2014'}
                      </div>
                      <div className="text-[8px] text-tertiary-label leading-none">{s.l}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          </div>

        {/* Budget pause overlay (live mode only) */}
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
