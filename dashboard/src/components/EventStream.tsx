'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { StepEvent } from '@/lib/agentSession';

interface EventStreamProps {
  events: StepEvent[];
  onNewEvent: (event: StepEvent) => void;
  onBudgetPaused: (data: { findings: number; toolCalls: number; budget: number }) => void;
  onRunComplete: (data: { scorecard: unknown; metrics: unknown; terminationReason: string }) => void;
  onRunError: (error: string) => void;
  readonly?: boolean;
}

// ─── Grouping logic ───────────────────────────────────────────────

interface Turn {
  id: string;
  reasoning: string;
  fullReasoning?: string;
  toolCalls: StepEvent[];
  findings: StepEvent[];
  special: StepEvent[];
  timestamp?: string;
}

function groupEventsIntoTurns(events: StepEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const ev of events) {
    if (ev.type === 'text_response') {
      if (current) turns.push(current);
      current = {
        id: `turn-${ev.step}-${ev.timestamp ?? ''}`,
        reasoning: ev.reasoning ?? ev.action,
        fullReasoning: ev.fullReasoning,
        toolCalls: [],
        findings: [],
        special: [],
        timestamp: ev.timestamp,
      };
      continue;
    }

    if (!current) {
      current = {
        id: `turn-implicit-${ev.step}`,
        reasoning: ev.reasoning ?? '',
        fullReasoning: ev.fullReasoning,
        toolCalls: [],
        findings: [],
        special: [],
        timestamp: ev.timestamp,
      };
    }

    if (ev.type === 'finding') {
      current.findings.push(ev);
    } else if (ev.type === 'model_switch' || ev.type === 'budget_warning' || ev.type === 'assemble_output') {
      current.special.push(ev);
    } else {
      current.toolCalls.push(ev);
    }
  }

  if (current) turns.push(current);
  return turns;
}

// ─── Finding card ─────────────────────────────────────────────────

function parseFinding(ev: StepEvent): { id: string; category: string; severity: string; title: string; description: string } | null {
  try {
    const args = JSON.parse(ev.args ?? '{}');
    const f = args.finding ?? args;
    return {
      id: f.id ?? '?',
      category: f.category ?? '',
      severity: f.severity ?? 'info',
      title: f.title ?? ev.action,
      description: f.description ?? '',
    };
  } catch {
    return null;
  }
}

function severityColor(sev: string): string {
  switch (sev) {
    case 'critical': return '#ff3b30';
    case 'high': return '#ff3b30';
    case 'medium': return '#ff9500';
    case 'low': return '#34c759';
    default: return '#86868b';
  }
}

function FindingCard({ event }: { event: StepEvent }) {
  const finding = parseFinding(event);
  if (!finding) return null;

  return (
    <div
      className="bg-surface rounded-lg border border-separator shadow-sm p-3 mt-1.5"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="text-[10px] font-bold uppercase tracking-wide rounded-md px-2 py-0.5"
          style={{
            color: severityColor(finding.severity),
            background: `${severityColor(finding.severity)}10`,
          }}
        >
          {finding.severity}
        </span>
        <span className="text-[10px] text-tertiary-label uppercase tracking-wide">
          {finding.category}
        </span>
        <span className="text-[10px] font-mono text-quaternary-label ml-auto">
          {finding.id}
        </span>
      </div>
      <div className="text-[13px] font-semibold text-label mb-1">
        {finding.title}
      </div>
      <div className="text-xs text-secondary-label leading-relaxed">
        {finding.description}
      </div>
    </div>
  );
}

// ─── Tool call chip ───────────────────────────────────────────────

function ToolCallChip({ event, isExpanded, onToggle }: { event: StepEvent; isExpanded: boolean; onToggle: () => void }) {
  const hasDetail = !!(event.args || event.fullResult);
  let parsedArgs: string | null = null;
  try {
    if (event.args) {
      const obj = JSON.parse(event.args);
      parsedArgs = JSON.stringify(obj, null, 2);
    }
  } catch { /* keep null */ }

  return (
    <div className="flex-[1_1_auto] min-w-0">
      <button
        onClick={hasDetail ? onToggle : undefined}
        className={`flex items-center gap-1.5 w-full text-left rounded-md px-2.5 py-1.5 text-xs font-mono transition-all ${
          isExpanded
            ? 'bg-[rgb(0_113_227/0.05)] border border-[rgb(0_113_227/0.2)]'
            : 'bg-elevated border border-transparent hover:border-separator'
        } ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="text-quaternary-label text-[10px] shrink-0">#{event.step}</span>
        <span className="font-medium text-label whitespace-nowrap">{event.action}</span>
        {event.result && (
          <span className="text-tertiary-label overflow-hidden text-ellipsis whitespace-nowrap flex-1 text-[11px]">
            {event.result}
          </span>
        )}
        {hasDetail && (
          <span className="text-quaternary-label text-[10px] shrink-0 ml-auto">
            {isExpanded ? '▾' : '▸'}
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-1 bg-elevated rounded-lg overflow-hidden text-[11px] font-mono">
          {parsedArgs && (
            <div className="border-b border-separator">
              <div className="px-3 py-1 text-[10px] text-tertiary-label font-semibold uppercase tracking-wide bg-canvas">
                Arguments
              </div>
              <pre className="px-3 py-2 m-0 text-secondary-label whitespace-pre-wrap break-words leading-relaxed max-h-[200px] overflow-y-auto">
                {parsedArgs}
              </pre>
            </div>
          )}
          {event.fullResult && (
            <div>
              <div className="px-3 py-1 text-[10px] text-tertiary-label font-semibold uppercase tracking-wide bg-canvas">
                Result
              </div>
              <pre className="px-3 py-2 m-0 text-secondary-label whitespace-pre-wrap break-words leading-relaxed max-h-[200px] overflow-y-auto">
                {(() => { try { return JSON.stringify(JSON.parse(event.fullResult!), null, 2); } catch { return event.fullResult; } })()}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Special event badges ─────────────────────────────────────────

function SpecialEvent({ event }: { event: StepEvent }) {
  const config: Record<string, { color: string; bg: string; icon: string }> = {
    model_switch: { color: '#0071e3', bg: 'rgba(0,113,227,0.06)', icon: '⇄' },
    budget_warning: { color: '#ff9500', bg: 'rgba(255,149,0,0.06)', icon: '!' },
    assemble_output: { color: '#34c759', bg: 'rgba(52,199,89,0.06)', icon: '✓' },
  };
  const s = config[event.type ?? ''] ?? config.budget_warning;

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-lg mt-2 text-xs"
      style={{ background: s.bg }}
    >
      <span className="font-bold text-sm" style={{ color: s.color }}>{s.icon}</span>
      <span className="font-semibold" style={{ color: s.color }}>{event.action}</span>
      {event.result && (
        <span className="font-mono text-[11px] text-tertiary-label">{event.result}</span>
      )}
    </div>
  );
}

// ─── Turn card ────────────────────────────────────────────────────

function TurnCard({ turn, turnIndex, isLatest }: { turn: Turn; turnIndex: number; isLatest: boolean }) {
  const [expandedCalls, setExpandedCalls] = useState<Set<number>>(new Set());
  const [reasoningExpanded, setReasoningExpanded] = useState(false);

  const toggleCall = useCallback((step: number) => {
    setExpandedCalls(prev => {
      const next = new Set(prev);
      if (next.has(step)) next.delete(step);
      else next.add(step);
      return next;
    });
  }, []);

  const fullText = turn.fullReasoning ?? turn.reasoning;
  const isLongReasoning = fullText.length > 150;
  const displayReasoning = reasoningExpanded
    ? fullText
    : (fullText.slice(0, 150) + (isLongReasoning ? '...' : ''));

  const batchIds = new Set(turn.toolCalls.map(tc => tc.batchId).filter(Boolean));
  const hasBatches = batchIds.size > 0;
  const isAllParallel = hasBatches && batchIds.size === 1 && turn.toolCalls.length > 1;
  const totalCalls = turn.toolCalls.length;

  return (
    <div
      className="bg-surface rounded-xl border border-separator shadow-sm mx-4 mb-2 p-4 hover:shadow-elevated hover:-translate-y-[1px] transition-all duration-200"
      style={isLatest ? { animation: 'slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) both' } : undefined}
    >
      {/* Turn header */}
      <div className={`flex gap-2.5 items-start ${(turn.toolCalls.length > 0 || turn.findings.length > 0) ? 'mb-2.5' : ''}`}>
        <span className="text-[10px] text-tertiary-label font-mono bg-elevated rounded-md px-2 py-0.5 shrink-0 mt-0.5 font-medium">
          {turnIndex + 1}
        </span>
        <div className="flex-1 min-w-0">
          <div
            onClick={isLongReasoning ? () => setReasoningExpanded(!reasoningExpanded) : undefined}
            className={`text-[13px] text-label leading-relaxed ${isLongReasoning ? 'cursor-pointer' : ''}`}
          >
            {displayReasoning}
            {isLongReasoning && !reasoningExpanded && (
              <span className="text-tint text-[11px] ml-1 font-medium">more</span>
            )}
          </div>

          {totalCalls > 1 && (
            <div className="mt-1.5">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded-md px-2 py-0.5 ${
                isAllParallel
                  ? 'bg-[rgb(0_113_227/0.06)] text-tint'
                  : 'bg-elevated text-tertiary-label'
              }`}>
                {totalCalls} {isAllParallel ? 'parallel' : 'sequential'}
              </span>
            </div>
          )}
        </div>

        {turn.timestamp && (
          <span className="text-[10px] text-quaternary-label font-mono shrink-0 whitespace-nowrap">
            {new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Tool calls */}
      {turn.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 ml-7">
          {turn.toolCalls.map((tc, i) => (
            <ToolCallChip
              key={`${tc.step}-${tc.action}-${i}`}
              event={tc}
              isExpanded={expandedCalls.has(tc.step)}
              onToggle={() => toggleCall(tc.step)}
            />
          ))}
        </div>
      )}

      {/* Findings */}
      {turn.findings.length > 0 && (
        <div className="ml-7">
          {turn.findings.map(f => (
            <FindingCard key={`finding-${f.step}`} event={f} />
          ))}
        </div>
      )}

      {/* Special events */}
      {turn.special.length > 0 && (
        <div className="ml-7">
          {turn.special.map(s => (
            <SpecialEvent key={`special-${s.step}-${s.type}`} event={s} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────

export function EventStream({ events, onNewEvent, onBudgetPaused, onRunComplete, onRunError, readonly }: EventStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  const turns = useMemo(() => groupEventsIntoTurns(events), [events]);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [events, autoScroll]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    if (readonly) return;

    const es = new EventSource('/api/events');
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'budget_paused') {
          onBudgetPaused(data);
        } else if (data.type === 'run_complete') {
          onRunComplete(data.result);
          es.close();
        } else if (data.type === 'run_cancelled') {
          es.close();
        } else if (data.type === 'run_error') {
          onRunError(data.error);
          es.close();
        } else {
          onNewEvent(data as StepEvent);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {};

    return () => {
      es.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto bg-canvas relative pt-3"
    >
      {events.length === 0 && (
        <div className="animate-slide-up flex flex-col items-center justify-center gap-3 pt-20 text-center">
          <div className="w-5 h-5 border-2 border-tint border-t-transparent rounded-full" style={{ animation: 'spin 0.6s linear infinite' }} />
          <div>
            <div className="text-sm font-medium text-secondary-label">Agent is starting up</div>
            <div className="text-xs text-tertiary-label mt-0.5">Events will stream in real-time</div>
          </div>
        </div>
      )}

      {turns.map((turn, i) => (
        <TurnCard
          key={turn.id}
          turn={turn}
          turnIndex={i}
          isLatest={i === turns.length - 1}
        />
      ))}

      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="sticky bottom-3 left-1/2 -translate-x-1/2 bg-surface-translucent backdrop-blur-sm shadow-card rounded-full px-4 py-1.5 text-[11px] text-secondary-label cursor-pointer block mx-auto hover:shadow-elevated transition-shadow"
        >
          Resume auto-scroll
        </button>
      )}
    </div>
  );
}
