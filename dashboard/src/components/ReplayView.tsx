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
      <div className="bg-white/80 backdrop-blur-sm shadow-[inset_0_1px_0_0_rgb(0_0_0/0.04)] px-4 py-2 flex items-center gap-2.5 shrink-0">
        <button
          onClick={done ? reset : playing ? pause : play}
          className="bg-elevated rounded-md px-2.5 py-1 text-xs font-mono text-label cursor-pointer hover:bg-[#e8e8ed] transition-colors min-w-[64px] text-center font-medium"
        >
          {done ? '↺ Reset' : playing ? '⏸ Pause' : '▶ Play'}
        </button>

        {/* Progress bar */}
        <div
          className="flex-1 h-1.5 bg-elevated rounded-full cursor-pointer relative"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seek(Math.round(ratio * total));
          }}
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: done ? '#34c759' : '#0071e3',
              transition: playing ? 'none' : 'width 0.15s ease',
            }}
          />
        </div>

        <span className="text-[11px] font-mono text-tertiary-label min-w-[60px] text-center">
          {position} / {total}
        </span>

        {/* Speed selector — segmented control */}
        <div className="bg-elevated rounded-md p-0.5 flex gap-0.5">
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono cursor-pointer transition-all ${
                speed === s
                  ? 'bg-white text-label shadow-sm font-bold'
                  : 'text-tertiary-label hover:text-secondary-label'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <button
          onClick={skipToEnd}
          className="text-tertiary-label hover:text-secondary-label rounded-lg px-2 py-1.5 text-[11px] font-mono cursor-pointer transition-colors"
        >
          Skip ⏭
        </button>

        <button
          onClick={onViewReport}
          className={`rounded-md px-3 py-1 text-xs font-medium cursor-pointer transition-all ${
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
