'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { StepEvent } from '@/lib/agentSession';

interface EventStreamProps {
  events: StepEvent[];
  onNewEvent: (event: StepEvent) => void;
  onBudgetPaused: (data: { findings: number; toolCalls: number; budget: number }) => void;
  onRunComplete: (data: { scorecard: unknown; metrics: unknown; terminationReason: string }) => void;
  onRunError: (error: string) => void;
  readonly?: boolean;
}

function eventBgColor(type: StepEvent['type']): string {
  switch (type) {
    case 'finding': return 'rgba(210,153,34,0.08)';
    case 'model_switch': return 'rgba(88,166,255,0.06)';
    case 'budget_warning': return 'rgba(227,179,65,0.06)';
    case 'assemble_output': return 'rgba(63,185,80,0.06)';
    default: return 'transparent';
  }
}

function eventBorderColor(type: StepEvent['type']): string {
  switch (type) {
    case 'finding': return '#d29922';
    case 'model_switch': return '#58a6ff';
    case 'budget_warning': return '#e3b341';
    case 'assemble_output': return '#3fb950';
    default: return 'transparent';
  }
}

function eventTextColor(type: StepEvent['type']): string {
  switch (type) {
    case 'finding': return '#d29922';
    case 'model_switch': return '#58a6ff';
    case 'budget_warning': return '#e3b341';
    case 'assemble_output': return '#3fb950';
    default: return 'var(--text-primary)';
  }
}

function ActionIcon({ type }: { type: StepEvent['type'] }) {
  switch (type) {
    case 'finding': return <span style={{ color: '#d29922' }}>◆</span>;
    case 'model_switch': return <span style={{ color: '#58a6ff' }}>⇄</span>;
    case 'assemble_output': return <span style={{ color: '#3fb950' }}>✓</span>;
    case 'budget_warning': return <span style={{ color: '#e3b341' }}>!</span>;
    default: return null;
  }
}

interface EventRowProps {
  event: StepEvent;
  showBranchLine?: boolean;
  isBatchStart?: boolean;
  isBatchEnd?: boolean;
}

function EventRow({ event, showBranchLine, isBatchStart, isBatchEnd }: EventRowProps) {
  const borderColor = eventBorderColor(event.type);
  const hasBorder = borderColor !== 'transparent';

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      padding: '4px 12px',
      background: eventBgColor(event.type),
      borderLeft: hasBorder ? `3px solid ${borderColor}` : '3px solid transparent',
      fontSize: 12,
      fontFamily: 'var(--font-mono)',
      lineHeight: 1.5,
      position: 'relative',
    }}>
      {/* Batch branch line */}
      {showBranchLine && (
        <div style={{
          position: 'absolute',
          left: isBatchStart ? 16 : 16,
          top: isBatchStart ? '50%' : 0,
          bottom: isBatchEnd ? '50%' : 0,
          width: 1,
          background: 'var(--border)',
          zIndex: 0,
        }} />
      )}

      {/* Step number */}
      <span style={{ color: 'var(--text-muted)', minWidth: 28, textAlign: 'right', flexShrink: 0 }}>
        {event.step > 0 ? `#${event.step}` : ''}
      </span>

      {/* Icon */}
      <span style={{ width: 14, flexShrink: 0, textAlign: 'center' }}>
        <ActionIcon type={event.type} />
      </span>

      {/* Action name */}
      <span style={{
        color: eventTextColor(event.type),
        minWidth: 140,
        flexShrink: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {event.action}
      </span>

      {/* Reasoning / result */}
      <span style={{
        color: 'var(--text-secondary)',
        fontStyle: 'italic',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {event.reasoning || event.result || ''}
      </span>
    </div>
  );
}

export function EventStream({ events, onNewEvent, onBudgetPaused, onRunComplete, onRunError, readonly }: EventStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const esRef = useRef<EventSource | null>(null);

  // Group events by batchId to show parallel call branches
  interface GroupedEvent {
    event: StepEvent;
    showBranchLine: boolean;
    isBatchStart: boolean;
    isBatchEnd: boolean;
  }
  const groupedEvents: GroupedEvent[] = [];
  const batchMap = new Map<string, number[]>();

  events.forEach((ev, i) => {
    if (ev.batchId) {
      if (!batchMap.has(ev.batchId)) batchMap.set(ev.batchId, []);
      batchMap.get(ev.batchId)!.push(i);
    }
  });

  events.forEach((ev, i) => {
    const batchIndices = ev.batchId ? batchMap.get(ev.batchId) ?? [] : [];
    const inBatch = batchIndices.length > 1;
    const isBatchStart = inBatch && batchIndices[0] === i;
    const isBatchEnd = inBatch && batchIndices[batchIndices.length - 1] === i;
    groupedEvents.push({
      event: ev,
      showBranchLine: inBatch,
      isBatchStart,
      isBatchEnd,
    });
  });

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
          // Regular step event
          onNewEvent(data as StepEvent);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // EventSource auto-reconnects — no action needed
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
        fontFamily: 'var(--font-mono)',
        fontSize: 12,
        position: 'relative',
      }}
    >
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

      {groupedEvents.map(({ event, showBranchLine, isBatchStart, isBatchEnd }, i) => (
        <EventRow
          key={i}
          event={event}
          showBranchLine={showBranchLine}
          isBatchStart={isBatchStart}
          isBatchEnd={isBatchEnd}
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
