'use client';

import { useEffect, useState } from 'react';
import type { StepEvent, Severity } from '@/lib/agentSession';

interface StatsPanelProps {
  events: StepEvent[];
  toolCalls: number;
  budget: number;
  startedAt: Date | null;
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#f85149';
    case 'high': return '#f85149';
    case 'medium': return '#e3b341';
    case 'low': return '#3fb950';
    case 'info': return '#8b949e';
    default: return '#8b949e';
  }
}

export function StatsPanel({ events, toolCalls, budget, startedAt }: StatsPanelProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt.getTime());
    }, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  // Derive stats from events
  const findingEvents = events.filter(e => e.type === 'finding');
  const severityCounts: Record<string, number> = {};
  for (const ev of findingEvents) {
    // Try to parse severity from result
    let sev = 'info';
    try {
      const result = JSON.parse(ev.result ?? '{}');
      if (result.severity) sev = result.severity;
    } catch {
      // Try to find [Severity] pattern in result
      const match = (ev.result ?? '').match(/\[(critical|high|medium|low|info)\]/i);
      if (match) sev = match[1].toLowerCase();
    }
    severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
  }

  // Detect model switch
  const switchEvent = events.find(e => e.type === 'model_switch');
  const modelSwitched = !!switchEvent;

  const elapsedS = Math.floor(elapsed / 1000);
  const elapsedStr = elapsedS < 60
    ? `${elapsedS}s`
    : `${Math.floor(elapsedS / 60)}m ${elapsedS % 60}s`;

  const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

  return (
    <aside style={{
      background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border)',
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 20,
      overflowY: 'auto',
      width: '100%',
    }}>
      <Section title="Findings">
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
          {findingEvents.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {severityOrder.filter(s => severityCounts[s]).map(s => (
            <div key={s} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: severityColor(s) }}>{s}</span>
              <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                {severityCounts[s]}
              </span>
            </div>
          ))}
          {findingEvents.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>none yet</span>
          )}
        </div>
      </Section>

      <Section title="Tool Calls">
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
          {toolCalls} <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>/ {budget}</span>
        </div>
        <div style={{
          height: 4,
          background: 'var(--bg-elevated)',
          borderRadius: 2,
          marginTop: 8,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${Math.min(100, (toolCalls / budget) * 100)}%`,
            height: '100%',
            background: toolCalls / budget > 0.8 ? 'var(--error)' : toolCalls / budget > 0.6 ? 'var(--warning)' : 'var(--accent)',
            transition: 'width 0.3s ease',
          }} />
        </div>
      </Section>

      <Section title="Model">
        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
          {modelSwitched ? (
            <>
              <div style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>Sonnet</div>
              <div style={{ color: '#58a6ff' }}>Haiku (fast)</div>
            </>
          ) : (
            <div style={{ color: 'var(--text-primary)' }}>Sonnet</div>
          )}
        </div>
      </Section>

      <Section title="Elapsed">
        <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
          {elapsedStr}
        </div>
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: 'var(--text-muted)',
        fontWeight: 600,
        marginBottom: 8,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}
