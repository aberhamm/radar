'use client';

import { useRef, useCallback, useEffect, useLayoutEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AnimationPhase } from '@/lib/useAnimationSequence';
import type { StreamTurn, Finding } from '@/lib/runTransform';
import type { FindingProgressState, SpecialistState } from '@/lib/useLiveAnalysis';
import type { SpecialistDisplayMode } from '@/lib/useSpecialistDisplayMode';
import { StaggeredSpinner } from '@/components/Skeleton';
import { TurnItem } from './TurnItem';
import { SwitchMarker } from './SwitchMarker';
import { PassBoundaryMarker } from './PassBoundaryMarker';
import { SpecialistDisplay } from './SpecialistDisplay';

interface ReasoningStreamProps {
  phase: AnimationPhase;
  turns: StreamTurn[];
  typingText: string;
  activeTurnIndex: number | null;
  pendingActions: string[];
  findings: Finding[];
  isLive: boolean;
  isInstant: boolean;
  verbose: boolean;
  accentColor: string;
  findingProgress?: FindingProgressState | null;
  specialists?: Map<string, SpecialistState> | null;
  specialistTurns?: Map<string, StreamTurn[]>;
  specialistDisplayMode?: SpecialistDisplayMode;
}

export function ReasoningStream({
  phase,
  turns,
  typingText,
  activeTurnIndex,
  pendingActions,
  findings,
  isLive,
  isInstant,
  verbose,
  accentColor,
  findingProgress,
  specialists,
  specialistTurns,
  specialistDisplayMode = 'inline',
}: ReasoningStreamProps) {
  const streamRef = useRef<HTMLDivElement>(null);
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const isAutoScrolling = useRef(false);
  const [railStyle, setRailStyle] = useState<{ top: number; height: number } | null>(null);

  const isWriting = phase === 'recording' || phase === 'assembling';

  // Auto-scroll the stream
  useEffect(() => {
    if (streamRef.current && autoScroll) {
      isAutoScrolling.current = true;
      streamRef.current.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
      setTimeout(() => { isAutoScrolling.current = false; }, 150);
    }
  }, [turns, typingText, activeTurnIndex, autoScroll]);

  // Measure timeline dot positions for connector rail
  useLayoutEffect(() => {
    const container = streamContainerRef.current;
    if (!container) { setRailStyle(null); return; }
    const dots = container.querySelectorAll<HTMLElement>('[data-timeline-dot]');
    if (dots.length < 2) { setRailStyle(null); return; }
    const containerRect = container.getBoundingClientRect();
    const first = dots[0].getBoundingClientRect();
    const last = dots[dots.length - 1].getBoundingClientRect();
    const top = Math.round(first.top + first.height / 2 - containerRect.top);
    const height = Math.round(last.top + last.height / 2 - containerRect.top - top);
    setRailStyle(prev =>
      prev && prev.top === top && prev.height === height ? prev : { top, height },
    );
  });

  const handleStreamScroll = useCallback(() => {
    if (isAutoScrolling.current) return;
    const el = streamRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    setAutoScroll(atBottom);
  }, []);

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={streamRef}
        onScroll={handleStreamScroll}
        className="absolute inset-0 overflow-y-auto p-4 space-y-1"
      >
        {/* Idle state — replay mode only */}
        {phase === 'idle' && !isLive && !isInstant && (
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
              <div className="text-xs text-tertiary-label mt-0.5">
                Events will stream in real-time
              </div>
            </div>
          </div>
        )}

        {/* Committed turns */}
        <div data-component="ReasoningStream" className="relative" ref={streamContainerRef}>
          {/* Vertical connector rail */}
          {railStyle && (
            <div
              className="absolute left-[9px] w-px"
              style={{
                top: railStyle.top,
                height: railStyle.height,
                background: `linear-gradient(to bottom, var(--color-separator), color-mix(in srgb, ${accentColor} 30%, var(--color-separator)), var(--color-separator))`,
              }}
            />
          )}

          {turns.map((turn, i) => {
            if (turn.isSwitch) return <SwitchMarker key={`switch-${i}`} />;
            if (turn.isPassBoundary) return <PassBoundaryMarker key={`pass-${i}`} passName={turn.passName} />;

            if (turn.isSpecialistStart && turn.specialistId && specialists) {
              const spec = specialists.get(turn.specialistId);
              if (spec) {
                const sTurns = specialistTurns?.get(turn.specialistId) ?? [];
                return (
                  <SpecialistDisplay
                    key={`spec-${turn.specialistId}`}
                    specialist={spec}
                    turns={sTurns}
                    mode={specialistDisplayMode}
                    accentColor={accentColor}
                  />
                );
              }
            }

            return (
              <TurnItem
                key={i}
                turn={turn}
                isActive={activeTurnIndex === i}
                isRecent={isInstant || i >= turns.length - 2}
                accentColor={accentColor}
                verbose={verbose}
              />
            );
          })}

          {/* Currently typing */}
          {typingText && (
            <div data-component="TypingIndicator" className="flex gap-2.5 py-2">
              <div
                data-timeline-dot
                className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 mt-[3px] relative z-[1]"
                style={{
                  background: `color-mix(in srgb, ${accentColor} 12%, var(--color-surface))`,
                  boxShadow: `0 0 0 2px color-mix(in srgb, ${accentColor} 20%, transparent)`,
                }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ background: accentColor, animation: 'pulse-dot 1.2s ease-in-out infinite' }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`md-content text-[13px] leading-relaxed ${isWriting ? 'text-success' : 'text-label'}`}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{typingText}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Thinking / recording indicator (live mode only) */}
          {isLive && !typingText && turns.length > 0 && phase !== 'done' && (
            <div
              data-component="ThinkingIndicator"
              className="flex gap-2.5 py-2"
              style={{ animation: 'fadeIn 0.4s ease 0.6s both' }}
            >
              <div
                data-timeline-dot
                className="w-[20px] h-[20px] rounded-full flex items-center justify-center shrink-0 mt-[3px] relative z-[1]"
                style={{
                  background: `color-mix(in srgb, ${accentColor} 12%, var(--color-surface))`,
                  boxShadow: `0 0 0 2px color-mix(in srgb, ${accentColor} 20%, transparent)`,
                }}
              >
                {phase === 'recording' ? (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <circle
                      cx="5"
                      cy="5"
                      r="3"
                      fill="var(--color-success)"
                      style={{ animation: 'pulse-dot 1.5s ease-in-out infinite' }}
                    />
                  </svg>
                ) : (
                  <div className="flex items-center gap-[3px]">
                    {[0, 1, 2].map((j) => (
                      <div
                        key={j}
                        className="w-[3px] h-[3px] rounded-full"
                        style={{
                          background: accentColor,
                          animation: `pulse-dot 1.2s ease-in-out ${j * 0.2}s infinite`,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {phase === 'recording' ? (
                  <>
                    <span className="text-[12px] font-semibold text-success">
                      Recording findings
                    </span>
                    <span className="text-[11px] font-mono text-tertiary-label">
                      {findings.length} so far
                    </span>
                    {findingProgress ? (
                      <span className="text-[11px] font-mono text-tertiary-label flex items-center gap-1.5" style={{ animation: 'fadeIn 0.15s ease both' }}>
                        <span className="text-quaternary-label">|</span>
                        {findingProgress.phase === 'finding_recorded' ? (
                          <span className="text-success">{findingProgress.findingId} recorded</span>
                        ) : findingProgress.phase === 'verifying_evidence' ? (
                          <>
                            <span>verifying</span>
                            <span className="text-secondary-label">{findingProgress.evidenceIndex}/{findingProgress.evidenceTotal}</span>
                            <span className="truncate max-w-[160px]">{findingProgress.evidenceFile?.split('/').pop()}</span>
                            <span className="flex gap-[2px]">
                              {[0, 1, 2].map((j) => (
                                <span key={j} className="block w-[2px] h-[2px] rounded-full bg-success" style={{ animation: `pulse-dot 0.8s ease-in-out ${j * 0.15}s infinite` }} />
                              ))}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className={findingProgress.evidenceStatus === 'rejected' ? 'text-warning' : findingProgress.evidenceStatus === 'corrected' ? 'text-warning' : 'text-success'}>
                              {findingProgress.evidenceStatus}
                            </span>
                            <span className="truncate max-w-[160px]">{findingProgress.evidenceFile?.split('/').pop()}</span>
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="flex gap-[3px]">
                        {[0, 1, 2].map((j) => (
                          <span
                            key={j}
                            className="block w-[3px] h-[3px] rounded-full bg-success"
                            style={{ animation: `pulse-dot 1.2s ease-in-out ${j * 0.2}s infinite` }}
                          />
                        ))}
                      </span>
                    )}
                  </>
                ) : pendingActions.length > 0 ? (
                  <span
                    className="text-[11px] text-tertiary-label"
                    style={{ animation: 'fadeIn 0.2s ease both' }}
                  >
                    {pendingActions.length === 1
                      ? pendingActions[0].replace(/_/g, ' ')
                      : `${pendingActions.length} tools in parallel`}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
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
            <path
              d="M5 2v6M3 6l2 2 2-2"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Resume
        </button>
      )}
    </div>
  );
}
