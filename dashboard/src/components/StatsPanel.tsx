'use client';

import { useEffect, useState } from 'react';
import type { StepEvent, Severity } from '@/lib/agentSession';

interface StatsPanelProps {
  events: StepEvent[];
  toolCalls: number;
  budget: number;
  startedAt: Date | null;
  /** If provided, show this instead of a live timer */
  fixedElapsed?: string;
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'var(--color-danger)';
    case 'high': return 'var(--color-danger)';
    case 'medium': return 'var(--color-warning)';
    case 'low': return 'var(--color-success)';
    case 'info': return 'var(--color-tertiary-label)';
    default: return 'var(--color-tertiary-label)';
  }
}

export function StatsPanel({ events, toolCalls, budget, startedAt, fixedElapsed }: StatsPanelProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    setElapsed(Date.now() - startedAt.getTime());
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt.getTime());
    }, 5000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const findingEvents = events.filter(e => e.type === 'finding');
  const severityCounts: Record<string, number> = {};
  for (const ev of findingEvents) {
    let sev = 'info';
    if (ev.details?.severity && typeof ev.details.severity === 'string') {
      sev = ev.details.severity;
    } else {
      try {
        const result = JSON.parse(ev.result ?? '{}');
        if (result.severity) sev = result.severity;
      } catch {
        const match = (ev.result ?? '').match(/\[(critical|high|medium|low|info)\]/i);
        if (match) sev = match[1].toLowerCase();
      }
    }
    severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
  }

  const switchEvent = events.find(e => e.type === 'model_switch');
  const modelSwitched = !!switchEvent;

  const elapsedS = Math.floor(elapsed / 1000);
  const elapsedStr = elapsedS < 60
    ? `${elapsedS}s`
    : `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s`;

  const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
  const pct = Math.min(100, (toolCalls / budget) * 100);

  return (
    <aside data-component="StatsPanel" className="bg-surface border-l border-separator p-4 flex flex-col gap-5 overflow-y-auto w-full">
      <Section title="Findings">
        <div className="bg-elevated rounded-lg px-3 py-2 inline-block">
          <span className="text-3xl font-bold text-label font-mono tracking-tight">
            {findingEvents.length}
          </span>
        </div>
        <div className="flex flex-col gap-1.5 mt-3">
          {severityOrder.filter(s => severityCounts[s]).map(s => (
            <div key={s} className="flex justify-between items-center text-xs">
              <span className="font-medium capitalize" style={{ color: severityColor(s) }}>{s}</span>
              <span className="text-secondary-label font-mono">{severityCounts[s]}</span>
            </div>
          ))}
          {findingEvents.length === 0 && (
            <span className="text-xs text-tertiary-label">none yet</span>
          )}
        </div>
      </Section>

      <Section title="Tool Calls">
        <div className="text-xl font-bold font-mono text-label">
          {toolCalls} <span className="text-sm text-tertiary-label font-normal">/ {budget}</span>
        </div>
        <div className="h-2 bg-elevated rounded-full mt-3 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${pct}%`,
              background: pct > 80 ? 'var(--color-danger)' : pct > 60 ? 'var(--color-warning)' : 'var(--color-tint)',
            }}
          />
        </div>
      </Section>

      <Section title="Model">
        <div className="text-xs font-mono">
          {modelSwitched ? (
            <>
              <div className="text-quaternary-label line-through">Sonnet</div>
              <div className="text-tint font-medium">Haiku (fast)</div>
            </>
          ) : (
            <div className="text-label font-medium">Sonnet</div>
          )}
        </div>
      </Section>

      <Section title="Elapsed">
        <div className="text-xl font-bold font-mono text-label">
          {fixedElapsed ?? elapsedStr}
        </div>
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pb-5 border-b border-separator last:border-b-0 last:pb-0">
      <div className="text-[10px] uppercase tracking-widest text-tertiary-label font-semibold mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}
