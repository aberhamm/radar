'use client';

import type { StepEvent } from '@/lib/agentSession';
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
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-[3] flex flex-col overflow-hidden">
          <EventStream
            events={events}
            onNewEvent={onNewEvent}
            onBudgetPaused={onBudgetPaused}
            onRunComplete={onRunComplete}
            onRunError={onRunError}
          />
        </div>
        <div className="flex-1 min-w-[200px] max-w-[260px]">
          <StatsPanel
            events={events}
            toolCalls={toolCalls}
            budget={budget}
            startedAt={startedAt}
          />
        </div>
      </div>

      {/* Status bar */}
      <div className="bg-surface-translucent backdrop-blur-sm shadow-[inset_0_1px_0_0_rgb(0_0_0/0.04)] px-4 py-2 flex items-center gap-4 font-mono text-xs text-tertiary-label shrink-0">
        <span className={`flex items-center gap-1.5 font-medium ${status === 'budget_paused' ? 'text-warning' : 'text-success'}`}>
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              background: status === 'budget_paused' ? '#ff9500' : '#34c759',
              animation: status !== 'budget_paused' ? 'pulse-dot 2s ease-in-out infinite' : undefined,
            }}
          />
          {status === 'budget_paused' ? 'PAUSED' : 'RUNNING'}
        </span>
        <span>{toolCalls} / {budget} calls</span>
        <span>{events.length} steps</span>
      </div>

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
