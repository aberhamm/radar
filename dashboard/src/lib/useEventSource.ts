'use client';

import { useEffect, useRef } from 'react';
import type { StepEvent } from './agentSession';

interface UseEventSourceCallbacks {
  onEvent: (event: StepEvent) => void;
  onBudgetPaused: (data: { findings: number; toolCalls: number; budget: number }) => void;
  onRunComplete: (data: { scorecard: unknown; metrics: unknown; terminationReason: string }) => void;
  onRunError: (error: string) => void;
}

/**
 * Opens an SSE connection to /api/events when enabled.
 * Dispatches parsed events to the appropriate callback.
 */
export function useEventSource(enabled: boolean, callbacks: UseEventSourceCallbacks) {
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  useEffect(() => {
    if (!enabled) return;

    const es = new EventSource('/api/events');

    es.onmessage = (e) => {
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

    return () => { es.close(); };
  }, [enabled]);
}
