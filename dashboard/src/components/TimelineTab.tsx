'use client';

import { useState, useEffect, useCallback } from 'react';
import type { RunMetrics, StepEvent, RunDiagnostics } from '@/lib/agentSession';
import { PhaseBar } from './timeline/PhaseBar';
import { TimeBreakdownChart } from './timeline/TimeBreakdownChart';
import { EfficiencyScorecard } from './timeline/EfficiencyScorecard';
import { InvestigationCurve } from './timeline/InvestigationCurve';

interface TimelineData {
  timeline: {
    totalDurationMs: number;
    phases: { label: string; durationMs: number; toolCalls: number }[];
    breakdown: { llmMs: number; toolMs: number; compressionMs: number; retryMs: number; idleMs: number };
    entryCount: number;
  } | null;
  diagnostics: RunDiagnostics | null;
}

interface SnapshotPoint {
  step: number;
  findingsCount: number;
  filesReadCount: number;
  toolCallsUsed: number;
}

function extractSnapshots(events: StepEvent[]): SnapshotPoint[] {
  return events
    .filter(e => e.stateSnapshot != null)
    .map(e => ({
      step: e.step,
      findingsCount: e.stateSnapshot!.findingsCount,
      filesReadCount: e.stateSnapshot!.filesReadCount,
      toolCallsUsed: e.stateSnapshot!.toolCallsUsed,
    }));
}

export function TimelineTab({ runId, metrics, events }: { runId: string; metrics: RunMetrics; events?: StepEvent[] }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchTimeline = useCallback(() => {
    if (data || loading || !runId || runId.startsWith('__')) return;
    setLoading(true);
    fetch(`/api/history/${encodeURIComponent(runId)}/timeline`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: TimelineData) => setData(d))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [data, loading, runId]);

  useEffect(() => { fetchTimeline(); }, [fetchTimeline]);

  const snapshots = events ? extractSnapshots(events) : [];
  const diagnostics = data?.diagnostics ?? metrics.diagnostics ?? null;

  if (loading) {
    return (
      <div className="py-5 space-y-4">
        <div className="h-10 bg-elevated rounded-lg animate-pulse" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-elevated rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-8 bg-elevated rounded-lg animate-pulse" />
        <div className="h-[160px] bg-elevated rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error || (!data?.timeline && !diagnostics && snapshots.length === 0)) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="text-center">
          <p className="text-sm text-tertiary-label mb-2">Timeline data not available for this run</p>
          {error && (
            <button
              onClick={() => { setError(false); setData(null); fetchTimeline(); }}
              className="text-xs text-tint hover:underline"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const timeline = data?.timeline;

  return (
    <div data-component="TimelineTab" className="py-5 space-y-6">
      {timeline && (
        <>
          <PhaseBar phases={timeline.phases} totalDurationMs={timeline.totalDurationMs} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TimeBreakdownChart breakdown={timeline.breakdown} />
            {diagnostics && <EfficiencyScorecard diagnostics={diagnostics} />}
          </div>
        </>
      )}

      {!timeline && diagnostics && (
        <EfficiencyScorecard diagnostics={diagnostics} />
      )}

      <InvestigationCurve snapshots={snapshots} />
    </div>
  );
}
