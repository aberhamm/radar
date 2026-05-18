/**
 * RunTimeline — structured post-hoc analysis of a completed agent run.
 *
 * Built from StepEvent[] after all phases complete. Used for debugging,
 * dashboard visualization, and performance analysis.
 */

export type TimelineEntryType = 'llm_turn' | 'tool_call' | 'compression' | 'retry' | 'idle';

export interface TimelineEntry {
  type: TimelineEntryType;
  startMs: number;
  durationMs: number;
  label: string;
  details?: Record<string, unknown>;
}

export type TimelinePhaseLabel = 'investigation' | 'writing' | 'assembly' | 'verification';

export interface TimelinePhase {
  label: TimelinePhaseLabel;
  startMs: number;
  endMs: number;
  durationMs: number;
  toolCalls: number;
  entries: TimelineEntry[];
}

export interface TimelineBreakdown {
  llmMs: number;
  toolMs: number;
  compressionMs: number;
  retryMs: number;
  idleMs: number;
}

export interface RunTimeline {
  totalDurationMs: number;
  phases: TimelinePhase[];
  breakdown: TimelineBreakdown;
  entryCount: number;
}
