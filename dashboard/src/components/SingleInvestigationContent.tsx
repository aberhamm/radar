'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Scorecard, RunMetrics, StepEvent } from '@/lib/agentSession';
import { transformRunData, type TransformedRunData } from '@/lib/runTransform';
import { AnalysisView } from './AnalysisView';
import { EventsLoadingSkeleton } from './Skeleton';

interface SingleInvestigationContentProps {
  runId?: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  events: StepEvent[];
  findings?: unknown[];
  investigationRunData?: TransformedRunData;
}

export function SingleInvestigationContent({
  runId,
  scorecard,
  metrics,
  events,
  findings,
  investigationRunData,
}: SingleInvestigationContentProps) {
  const [lazyRunData, setLazyRunData] = useState<TransformedRunData | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const eventsFailed = useRef(false);
  const [replayAnimated, setReplayAnimated] = useState(false);

  const resolvedRunData = investigationRunData ?? lazyRunData;

  const buildRunData = useCallback((evts: StepEvent[]) => {
    return transformRunData(evts, {
      scorecard,
      metrics,
      terminationReason: 'completed',
      briefMarkdown: '',
      outputPaths: [],
      state: { findings: findings ?? [] },
    });
  }, [scorecard, metrics, findings]);

  // Use prop events directly when available — avoids unnecessary API call
  useEffect(() => {
    if (resolvedRunData) return;
    if (events && events.length > 0) {
      setLazyRunData(buildRunData(events));
    }
  }, [resolvedRunData, events, buildRunData]);

  // Fallback: fetch pre-computed rundata (fast), then raw events if unavailable
  const fetchEvents = useCallback(() => {
    if (resolvedRunData || eventsLoading || eventsFailed.current || !runId || runId.startsWith('__')) return;
    if (events && events.length > 0) return;
    setEventsLoading(true);
    fetch(`/api/history/${encodeURIComponent(runId)}/rundata`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.data !== null) { setLazyRunData(d as TransformedRunData); return; }
        return fetch(`/api/history/${encodeURIComponent(runId)}/events`)
          .then(r2 => { if (!r2.ok) throw new Error(`HTTP ${r2.status}`); return r2.json(); })
          .then(data => {
            if (data.events) setLazyRunData(buildRunData(data.events));
            else eventsFailed.current = true;
          });
      })
      .catch(err => {
        console.warn('[events] Failed to load:', err);
        eventsFailed.current = true;
      })
      .finally(() => setEventsLoading(false));
  }, [resolvedRunData, eventsLoading, runId, events, buildRunData]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  return (
    <div data-component="SingleInvestigationContent" className="flex-1 flex flex-col overflow-hidden">
      {eventsLoading ? (
        <div className="p-6"><EventsLoadingSkeleton /></div>
      ) : resolvedRunData ? (
        <AnalysisView
          runData={resolvedRunData}
          viewMode={replayAnimated ? 'replay' : 'instant'}
          onStartReplay={() => setReplayAnimated(true)}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-sm text-tertiary-label">No investigation events available.</p>
        </div>
      )}
    </div>
  );
}
