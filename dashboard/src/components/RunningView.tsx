'use client';

import type { StepEvent } from '@agent/agent/runner';
import { EventStream } from './EventStream';
import { StatsPanel } from './StatsPanel';
import { BudgetPausedView } from './BudgetPausedView';

interface RunningViewProps {
  events: StepEvent[];
  status: 'running' | 'budget_paused';
  toolCalls: number;
  budget: number;
  startedAt: Date | null;
  budgetPausedData: { findings: number; toolCalls: number; budget: number } | null;
  onNewEvent: (event: StepEvent) => void;
  onBudgetPaused: (data: { findings: number; toolCalls: number; budget: number }) => void;
  onBudgetDecision: (extend: boolean) => void;
  onRunComplete: (data: { scorecard: unknown; metrics: unknown; terminationReason: string }) => void;
  onRunError: (error: string) => void;
}

export function RunningView({
  events,
  status,
  toolCalls,
  budget,
  startedAt,
  budgetPausedData,
  onNewEvent,
  onBudgetPaused,
  onBudgetDecision,
  onRunComplete,
  onRunError,
}: RunningViewProps) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Main split */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Event stream — 75% */}
        <div style={{ flex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <EventStream
            events={events}
            onNewEvent={onNewEvent}
            onBudgetPaused={onBudgetPaused}
            onRunComplete={onRunComplete}
            onRunError={onRunError}
          />
        </div>

        {/* Stats panel — 25% */}
        <div style={{ flex: 1, minWidth: 180, maxWidth: 240 }}>
          <StatsPanel
            events={events}
            toolCalls={toolCalls}
            budget={budget}
            startedAt={startedAt}
          />
        </div>
      </div>

      {/* Status bar */}
      <div style={{
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        padding: '6px 16px',
        fontSize: 11,
        color: 'var(--text-muted)',
        display: 'flex',
        gap: 16,
        fontFamily: 'var(--font-mono)',
      }}>
        <span style={{ color: status === 'budget_paused' ? 'var(--warning)' : 'var(--success)' }}>
          ● {status === 'budget_paused' ? 'PAUSED' : 'RUNNING'}
        </span>
        <span>{toolCalls} / {budget} calls</span>
        <span>{events.length} steps</span>
      </div>

      {/* Budget paused overlay */}
      {status === 'budget_paused' && budgetPausedData && (
        <BudgetPausedView
          findings={budgetPausedData.findings}
          toolCalls={budgetPausedData.toolCalls}
          budget={budgetPausedData.budget}
          onDecision={onBudgetDecision}
        />
      )}
    </div>
  );
}
