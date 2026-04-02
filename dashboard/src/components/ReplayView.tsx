'use client';

import { useEffect, useRef } from 'react';
import type { StepEvent, RunResult } from '@/lib/agentSession';
import { useReplay, type ReplaySpeed } from '@/lib/useReplay';
import { EventStream } from './EventStream';
import { StatsPanel } from './StatsPanel';

interface ReplayViewProps {
  sourceEvents: StepEvent[];
  result: RunResult;
  repoName: string;
  goal: string;
  startedAt: Date;
  onViewReport: () => void;
}

const SPEED_OPTIONS: ReplaySpeed[] = [1, 2, 5, 10];

export function ReplayView({ sourceEvents, result, repoName, goal, startedAt, onViewReport }: ReplayViewProps) {
  const { state, play, pause, seek, setSpeed, reset, skipToEnd } = useReplay(sourceEvents);
  const { events, playing, position, total, speed, done } = state;

  // Auto-skip to end on mount so all events are visible immediately
  const didInit = useRef(false);
  useEffect(() => {
    if (!didInit.current && sourceEvents.length > 0) {
      didInit.current = true;
      skipToEnd();
    }
  }, [sourceEvents, skipToEnd]);

  // Compute completed duration instead of live timer
  const durationMs = result.metrics?.durationMs ?? 0;
  const durationS = Math.floor(durationMs / 1000);
  const durationStr = durationS < 60
    ? `${durationS}s`
    : `${Math.floor(durationS / 60)}m ${durationS % 60}s`;

  const pct = total > 0 ? (position / total) * 100 : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-[3] flex flex-col overflow-hidden">
          <EventStream
            events={events}
            onNewEvent={() => {}}
            onBudgetPaused={() => {}}
            onRunComplete={() => {}}
            onRunError={() => {}}
            readonly
          />
        </div>
        <div className="flex-1 min-w-[200px] max-w-[260px]">
          <StatsPanel
            events={events}
            toolCalls={events.filter(e => e.type === 'tool_call' || e.type === 'finding').length}
            budget={result.metrics?.toolCalls ?? 45}
            startedAt={null}
            fixedElapsed={durationStr}
          />
        </div>
      </div>

      {/* Replay controls */}
      <div className="bg-surface-translucent backdrop-blur-sm shadow-[inset_0_1px_0_0_rgb(0_0_0/0.04)] px-4 py-2.5 flex items-center gap-3 shrink-0">
        <button
          onClick={done ? reset : playing ? pause : play}
          className="w-8 h-8 flex items-center justify-center bg-elevated rounded-lg cursor-pointer hover:bg-[#e8e8ed] transition-colors"
          title={done ? 'Reset' : playing ? 'Pause' : 'Play'}
        >
          {done ? (
            <svg className="w-4 h-4 text-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          ) : playing ? (
            <svg className="w-4 h-4 text-label" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="w-4 h-4 text-label" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </button>

        {/* Elapsed at position */}
        <span className="text-[11px] font-mono text-tertiary-label min-w-[32px] text-right tabular-nums">
          {position}
        </span>

        {/* Progress bar with scrubber */}
        <div
          className="flex-1 h-4 flex items-center cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seek(Math.round(ratio * total));
          }}
        >
          <div className="w-full h-1.5 bg-elevated rounded-full relative">
            <div
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: done ? '#34c759' : '#0071e3',
                transition: playing ? 'none' : 'width 0.15s ease',
              }}
            />
            {/* Scrubber handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-tint shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                left: `${pct}%`,
                marginLeft: '-6px',
                background: done ? '#34c759' : '#0071e3',
              }}
            />
          </div>
        </div>

        {/* Total */}
        <span className="text-[11px] font-mono text-tertiary-label min-w-[32px] tabular-nums">
          {total}
        </span>

        {/* Speed selector */}
        <div className="bg-elevated rounded-md p-0.5 flex gap-0.5">
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-all ${
                speed === s
                  ? 'bg-surface text-label shadow-sm font-bold'
                  : 'text-tertiary-label hover:text-secondary-label'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <button
          onClick={skipToEnd}
          className="w-8 h-8 flex items-center justify-center text-tertiary-label hover:text-secondary-label cursor-pointer transition-colors"
          title="Skip to end"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="4,4 14,12 4,20" /><rect x="16" y="4" width="3" height="16" rx="1" />
          </svg>
        </button>

        <button
          onClick={onViewReport}
          className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer transition-all ${
            done
              ? 'bg-tint text-white hover:bg-[#0077ed]'
              : 'bg-elevated text-secondary-label hover:text-label'
          }`}
        >
          View Report
        </button>
      </div>
    </div>
  );
}
