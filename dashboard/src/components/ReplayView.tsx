'use client';

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

  const pct = total > 0 ? (position / total) * 100 : 0;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Event stream */}
        <div style={{ flex: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <EventStream
            events={events}
            onNewEvent={() => {}}
            onBudgetPaused={() => {}}
            onRunComplete={() => {}}
            onRunError={() => {}}
            readonly
          />
        </div>

        {/* Stats panel */}
        <div style={{ flex: 1, minWidth: 180, maxWidth: 240 }}>
          <StatsPanel
            events={events}
            toolCalls={events.filter(e => e.type === 'tool_call' || e.type === 'finding').length}
            budget={result.metrics?.toolCalls ?? 45}
            startedAt={startedAt}
          />
        </div>
      </div>

      {/* Replay controls bar */}
      <div style={{
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        {/* Play/pause */}
        <button
          onClick={done ? reset : playing ? pause : play}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 10px',
            fontSize: 12,
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            minWidth: 60,
          }}
        >
          {done ? '↺ Reset' : playing ? '⏸ Pause' : '▶ Play'}
        </button>

        {/* Progress bar */}
        <div
          style={{
            flex: 1,
            height: 6,
            background: 'var(--bg-elevated)',
            borderRadius: 3,
            cursor: 'pointer',
            position: 'relative',
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            seek(Math.round(ratio * total));
          }}
        >
          <div style={{
            width: `${pct}%`,
            height: '100%',
            background: done ? 'var(--success)' : 'var(--accent)',
            borderRadius: 3,
            transition: playing ? 'none' : 'width 0.15s ease',
          }} />
        </div>

        {/* Position */}
        <span style={{
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          minWidth: 60,
          textAlign: 'center',
        }}>
          {position} / {total}
        </span>

        {/* Speed selector */}
        <div style={{ display: 'flex', gap: 2 }}>
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              style={{
                background: speed === s ? 'var(--accent)' : 'var(--bg-elevated)',
                color: speed === s ? '#000' : 'var(--text-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 3,
                padding: '2px 6px',
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                fontWeight: speed === s ? 700 : 400,
                cursor: 'pointer',
              }}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Skip to end */}
        <button
          onClick={skipToEnd}
          style={{
            background: 'none',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 11,
            color: 'var(--text-muted)',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
          }}
        >
          Skip ⏭
        </button>

        {/* View report button (when done or anytime) */}
        <button
          onClick={onViewReport}
          style={{
            background: done ? 'var(--accent)' : 'var(--bg-elevated)',
            color: done ? '#000' : 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '4px 12px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          View Report
        </button>
      </div>
    </div>
  );
}
