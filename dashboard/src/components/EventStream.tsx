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
  special: StepEvent[]; // model_switch, budget_warning, assemble_output
  timestamp?: string;
}

function groupEventsIntoTurns(events: StepEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const ev of events) {
    if (ev.type === 'text_response') {
      // Start a new turn
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

    // If no current turn yet, create an implicit one
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
    case 'critical': return '#f85149';
    case 'high': return '#f85149';
    case 'medium': return '#e3b341';
    case 'low': return '#3fb950';
    default: return '#8b949e';
  }
}

function FindingCard({ event }: { event: StepEvent }) {
  const finding = parseFinding(event);
  if (!finding) return null;

  return (
    <div style={{
      background: 'rgba(210,153,34,0.06)',
      border: '1px solid rgba(210,153,34,0.25)',
      borderLeft: `3px solid ${severityColor(finding.severity)}`,
      borderRadius: '0 6px 6px 0',
      padding: '10px 14px',
      marginTop: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: severityColor(finding.severity),
          background: `${severityColor(finding.severity)}18`,
          padding: '2px 6px',
          borderRadius: 3,
        }}>
          {finding.severity}
        </span>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>
          {finding.category}
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          marginLeft: 'auto',
        }}>
          {finding.id}
        </span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        {finding.title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
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
    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
      <button
        onClick={hasDetail ? onToggle : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '6px 10px',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-primary)',
          cursor: hasDetail ? 'pointer' : 'default',
          width: '100%',
          textAlign: 'left',
          transition: 'border-color 0.15s',
          borderColor: isExpanded ? 'var(--accent)' : 'var(--border)',
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>#{event.step}</span>
        <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{event.action}</span>
        {event.result && (
          <span style={{
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            fontSize: 11,
          }}>
            {event.result}
          </span>
        )}
        {hasDetail && (
          <span style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0, marginLeft: 'auto' }}>
            {isExpanded ? '▾' : '▸'}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{
          marginTop: 4,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          overflow: 'hidden',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
        }}>
          {parsedArgs && (
            <div style={{ borderBottom: '1px solid var(--border)' }}>
              <div style={{ padding: '4px 10px', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-elevated)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Arguments
              </div>
              <pre style={{ padding: '8px 10px', margin: 0, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto' }}>
                {parsedArgs}
              </pre>
            </div>
          )}
          {event.fullResult && (
            <div>
              <div style={{ padding: '4px 10px', fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-elevated)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Result
              </div>
              <pre style={{ padding: '8px 10px', margin: 0, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto' }}>
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
  const styles: Record<string, { bg: string; border: string; color: string; icon: string }> = {
    model_switch: { bg: 'rgba(88,166,255,0.08)', border: 'rgba(88,166,255,0.3)', color: '#58a6ff', icon: '⇄' },
    budget_warning: { bg: 'rgba(227,179,65,0.08)', border: 'rgba(227,179,65,0.3)', color: '#e3b341', icon: '!' },
    assemble_output: { bg: 'rgba(63,185,80,0.08)', border: 'rgba(63,185,80,0.3)', color: '#3fb950', icon: '✓' },
  };
  const s = styles[event.type ?? ''] ?? styles.budget_warning;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 6,
      marginTop: 8,
      fontSize: 12,
    }}>
      <span style={{ color: s.color, fontWeight: 700, fontSize: 14 }}>{s.icon}</span>
      <span style={{ color: s.color, fontWeight: 600 }}>{event.action}</span>
      {event.result && (
        <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
          {event.result}
        </span>
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

  const isLongReasoning = (turn.fullReasoning?.length ?? 0) > 150;
  const displayReasoning = reasoningExpanded
    ? (turn.fullReasoning ?? turn.reasoning)
    : (turn.reasoning?.slice(0, 120) + (isLongReasoning ? '...' : ''));

  const parallelCount = turn.toolCalls.length;
  const hasParallel = parallelCount > 1;

  return (
    <div
      style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border)',
        animation: isLatest ? 'fadeIn 0.3s ease' : undefined,
      }}
    >
      {/* Turn header: number + reasoning */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: turn.toolCalls.length > 0 || turn.findings.length > 0 ? 10 : 0 }}>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          padding: '2px 6px',
          flexShrink: 0,
          marginTop: 2,
        }}>
          T{turnIndex + 1}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            onClick={isLongReasoning ? () => setReasoningExpanded(!reasoningExpanded) : undefined}
            style={{
              fontSize: 13,
              color: 'var(--text-primary)',
              lineHeight: 1.5,
              cursor: isLongReasoning ? 'pointer' : 'default',
            }}
          >
            {displayReasoning}
            {isLongReasoning && !reasoningExpanded && (
              <span style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 4 }}>more</span>
            )}
          </div>

          {/* Parallel indicator */}
          {hasParallel && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 6,
              fontSize: 11,
              color: 'var(--text-muted)',
            }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: 'rgba(88,166,255,0.08)',
                border: '1px solid rgba(88,166,255,0.2)',
                borderRadius: 4,
                padding: '1px 6px',
                color: 'var(--accent)',
                fontSize: 10,
                fontWeight: 600,
              }}>
                {parallelCount} parallel
              </span>
            </div>
          )}
        </div>

        {turn.timestamp && (
          <span style={{
            fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}>
            {new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {/* Tool calls grid */}
      {turn.toolCalls.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginLeft: 36,
        }}>
          {turn.toolCalls.map(tc => (
            <ToolCallChip
              key={`${tc.step}-${tc.action}`}
              event={tc}
              isExpanded={expandedCalls.has(tc.step)}
              onToggle={() => toggleCall(tc.step)}
            />
          ))}
        </div>
      )}

      {/* Findings */}
      {turn.findings.length > 0 && (
        <div style={{ marginLeft: 36 }}>
          {turn.findings.map(f => (
            <FindingCard key={`finding-${f.step}`} event={f} />
          ))}
        </div>
      )}

      {/* Special events */}
      {turn.special.length > 0 && (
        <div style={{ marginLeft: 36 }}>
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

  // Auto-scroll
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

  // SSE connection
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
        } else if (data.type === 'run_error') {
          onRunError(data.error);
          es.close();
        } else {
          onNewEvent(data as StepEvent);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      style={{
        flex: 1,
        overflowY: 'auto',
        background: 'var(--bg-primary)',
        position: 'relative',
      }}
    >
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {events.length === 0 && (
        <div style={{
          padding: '40px 20px',
          color: 'var(--text-muted)',
          fontSize: 13,
          textAlign: 'center',
        }}>
          Waiting for agent to start...
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
          style={{
            position: 'sticky',
            bottom: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '4px 12px',
            fontSize: 11,
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'block',
            margin: '0 auto',
          }}
        >
          Resume auto-scroll
        </button>
      )}
    </div>
  );
}
