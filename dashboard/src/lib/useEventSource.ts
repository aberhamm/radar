'use client';

import { useEffect, useRef } from 'react';
import type { StepEvent } from './agentSession';

interface UseEventSourceCallbacks {
  onEvent: (event: StepEvent) => void;
  onBudgetPaused: (data: { findings: number; toolCalls: number; budget: number }) => void;
  onRunComplete: (data: { scorecard: unknown; metrics: unknown; terminationReason: string }) => void;
  onRunError: (error: string) => void;
}

/** Poll interval when SSE goes stale (no events for this long) */
const STALE_CHECK_MS = 10_000;

/**
 * Opens an SSE connection to /api/events when enabled.
 * Dispatches parsed events to the appropriate callback.
 * Falls back to polling /api/session if the SSE stream goes stale.
 */
export function useEventSource(enabled: boolean, callbacks: UseEventSourceCallbacks) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    if (!enabled) return;

    let lastEventAt = Date.now();
    const es = new EventSource('/api/events');

    es.onmessage = (e) => {
      lastEventAt = Date.now();
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'budget_paused') {
          cbRef.current.onBudgetPaused(data);
        } else if (data.type === 'run_complete') {
          cbRef.current.onRunComplete(data.result);
          es.close();
        } else if (data.type === 'run_cancelled') {
          es.close();
        } else if (data.type === 'run_error') {
          cbRef.current.onRunError(data.error);
          es.close();
        } else {
          cbRef.current.onEvent(data as StepEvent);
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {};

    // Staleness detector: if no SSE events arrive for STALE_CHECK_MS,
    // poll the session API to catch missed state transitions.
    const staleTimer = setInterval(async () => {
      if (Date.now() - lastEventAt < STALE_CHECK_MS) return;
      try {
        const res = await fetch('/api/session');
        const data = await res.json();
        if (data.status === 'budget_paused' && data.currentRun?.budgetPausedData) {
          cbRef.current.onBudgetPaused(data.currentRun.budgetPausedData);
        } else if (data.status === 'complete' && data.result) {
          cbRef.current.onRunComplete(data.result);
          es.close();
        } else if (data.status === 'error') {
          cbRef.current.onRunError(data.lastError ?? 'Unknown error');
          es.close();
        }
      } catch { /* polling failed — will retry next interval */ }
    }, STALE_CHECK_MS);

    return () => {
      es.close();
      clearInterval(staleTimer);
    };
  }, [enabled]);
}
