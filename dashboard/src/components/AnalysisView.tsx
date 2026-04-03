'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { Finding, TransformedRunData } from '@/lib/runTransform';
import { CATEGORIES } from '@/lib/runTransform';
import { SAMPLE_ANALYSIS_TURNS, SAMPLE_FINDINGS } from '@/lib/sampleRunData';
import { useAnimationSequence } from '@/lib/useAnimationSequence';
import { ActivityChipGroup } from '@/components/ActivityChip';
import { FindingCard } from '@/components/FindingCard';

// ─── Analysis View ───────────────────────────────────────────────

export function AnalysisView({ runData }: { runData?: TransformedRunData }) {
  // Use real data when provided, fall back to sample data
  const DATA_TURNS = runData?.analysisTurns ?? SAMPLE_ANALYSIS_TURNS;
  const DATA_FINDINGS: Finding[] = runData?.findings ?? SAMPLE_FINDINGS;
  const DATA_BATCHES = runData?.findingBatches ?? [4, 5, 4];

  // Separate switch turn from analysis turns
  const switchIndex = DATA_TURNS.findIndex(t => t.activities.some(a => a.label === 'switch_to_fast_model'));
  const INV_TURNS = switchIndex >= 0 ? DATA_TURNS.slice(0, switchIndex) : DATA_TURNS;
  const HAS_SWITCH = switchIndex >= 0;

  // Animation state + orchestration from hook
  const {
    phase, turns, typingText, activeTurnIndex, coveredTopics,
    examinedFiles, findings, scoreVisible, progressPercent,
    run, reset,
  } = useAnimationSequence(INV_TURNS, DATA_FINDINGS, DATA_BATCHES, HAS_SWITCH);

  // UI-only state
  const [filesCollapsed, setFilesCollapsed] = useState(false);
  const [findingsCollapsed, setFindingsCollapsed] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);
  const filesScrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const isAutoScrolling = useRef(false);

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

  // Reset autoScroll when animation resets
  const handleRun = useCallback(() => {
    setAutoScroll(true);
    run();
  }, [run]);

  const handleReset = useCallback(() => {
    setAutoScroll(true);
    reset();
  }, [reset]);

  const isWriting = phase === 'recording' || phase === 'assembling';
  const accentColor = isWriting || phase === 'done' ? 'var(--color-success)' : phase === 'switching' ? 'var(--color-warning)' : 'var(--color-tint)';

  return (
      <div className="flex flex-1 overflow-hidden">
        {/* Left: phase bar + scrollable stream */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Phase progress rail */}
          <div className="h-10 px-4 flex items-center gap-4 border-b border-separator bg-surface-translucent backdrop-blur-sm shrink-0">
            {/* Play / Reset button */}
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
              {/* Status dot + label */}
              <div className="flex items-center gap-2 shrink-0">
                {phase !== 'idle' && (
                  <div
                    className="w-1.5 h-1.5 rounded-full transition-all duration-500"
                    style={{
                      background: accentColor,
                      animation: phase !== 'done' ? 'pulse-dot 1.5s ease-in-out infinite' : undefined,
                    }}
                  />
                )}
                <span className="text-[11px] font-semibold text-label">
                  {phase === 'idle' ? 'Ready' : phase === 'analyzing' ? 'Analyzing' : phase === 'switching' ? 'Switching' : phase === 'recording' ? 'Recording' : phase === 'assembling' ? 'Assembling' : 'Complete'}
                </span>
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
                      opacity: phase === 'idle' ? 0 : 1,
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
            </div>
            <div className="flex-1 relative overflow-hidden">
              <div
                ref={streamRef}
                onScroll={handleStreamScroll}
                className="absolute inset-0 overflow-y-auto p-4 space-y-1"
              >
                {phase === 'idle' && (
                  <div className="text-xs text-quaternary-label text-center pt-32">
                    Press Play to watch the full agent run
                  </div>
                )}

                {/* Committed turns */}
                {turns.map((turn, i) => {
                  if (turn.isSwitch) {
                    return (
                      <div
                        key={`switch-${i}`}
                        className="flex items-center gap-3 px-4 py-3 my-3 rounded-xl bg-[rgba(255,159,10,0.05)] border border-[rgba(255,159,10,0.15)]"
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
                  return (
                    <div
                      key={i}
                      className={`py-2 transition-opacity duration-300 ${isRecent ? 'opacity-100' : 'opacity-40 hover:opacity-100 focus-within:opacity-100'}`}
                    >
                      <p className={`text-[13px] leading-relaxed ${
                        turn.phase === 'write' ? 'text-success' : 'text-secondary-label'
                      }`}>
                        {turn.reasoning}
                      </p>

                      {turn.activities.length > 0 && (
                        <ActivityChipGroup activities={turn.activities} active={activeTurnIndex === i} accentColor={accentColor} />
                      )}
                    </div>
                  );
                })}

                {/* Currently typing */}
                {typingText && (
                  <div className="py-2">
                    <p className={`text-[13px] leading-relaxed ${isWriting ? 'text-success' : 'text-label'}`}>
                      {typingText}
                      <span
                        className="inline-block w-[2px] h-[14px] ml-0.5 align-text-bottom rounded-full"
                        style={{ background: accentColor, animation: 'pulse-dot 0.8s step-end infinite' }}
                      />
                    </p>
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
                  const isCovered = coveredTopics.has(cat.id);
                  return (
                    <span
                      key={cat.id}
                      className={`text-[9px] font-medium px-2 py-0.5 rounded-md transition-all duration-300 ${
                        isCovered
                          ? 'bg-[rgba(0,113,227,0.06)] text-tint'
                          : 'bg-transparent text-quaternary-label'
                      }`}
                    >
                      {isCovered && (
                        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" className="inline mr-0.5 -mt-px">
                          <path d="M2.5 6.5L5 9l4.5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {cat.label}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right sidebar: files examined + findings */}
          <div className="w-[260px] border-l border-separator bg-canvas flex flex-col shrink-0">
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
                    className="px-3 py-2.5 flex flex-col space-y-0.5 h-[200px] overflow-y-auto"
                    style={{ animation: 'expand-down 0.2s cubic-bezier(0.16, 1, 0.3, 1) both' }}
                  >
                    {examinedFiles.length > 0 ? examinedFiles.map((file, fi) => (
                      <div
                        key={`${fi}-${file}`}
                        className="text-[9px] font-mono text-secondary-label bg-elevated px-1.5 py-0.5 rounded"
                        style={{ animation: 'chip-enter 0.2s cubic-bezier(0.16, 1, 0.3, 1) both' }}
                      >
                        {file}
                      </div>
                    )) : (
                      <div className="text-[10px] text-quaternary-label w-full text-center py-1">&mdash;</div>
                    )}
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
                    {findings.length === 0 && phase !== 'idle' && (
                      <div className="text-[10px] text-quaternary-label text-center pt-1 pb-2">
                        Findings appear after analysis
                      </div>
                    )}
                    {findings.length === 0 && phase === 'idle' && (
                      <div className="text-[10px] text-quaternary-label text-center pt-1 pb-2">
                        &mdash;
                      </div>
                    )}

                    {findings.map((f) => (
                      <FindingCard key={f.id} finding={f} />
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
                  { n: DATA_FINDINGS.filter(f => f.severity === 'critical').length, l: 'Crit', c: 'var(--color-danger)' },
                  { n: DATA_FINDINGS.filter(f => f.severity === 'high').length, l: 'High', c: 'var(--color-danger)' },
                  { n: DATA_FINDINGS.filter(f => f.severity === 'medium').length, l: 'Med', c: 'var(--color-warning)' },
                  { n: DATA_FINDINGS.filter(f => f.severity === 'low' || f.severity === 'info').length, l: 'Low', c: 'var(--color-success)' },
                ].map(s => (
                  <div
                    key={s.l}
                    className={`flex-1 text-center rounded-md py-0.5 transition-all duration-500 ${scoreVisible ? 'opacity-100' : 'opacity-30'}`}
                    style={scoreVisible ? {
                      background: `color-mix(in srgb, ${s.c} 6%, transparent)`,
                      animation: 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) both',
                    } : undefined}
                  >
                    <div className="text-xs font-bold font-brand" style={{ color: scoreVisible ? s.c : 'var(--color-quaternary-label)' }}>
                      {scoreVisible ? s.n : '\u2014'}
                    </div>
                    <div className="text-[8px] text-tertiary-label leading-none">{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
  );
}
