/**
 * Build a RunTimeline from completed StepEvents.
 *
 * Pure function — no side effects, no LLM calls. Operates post-hoc on
 * the event array persisted during the run. Detects phase boundaries
 * from model_switch and assemble_output events.
 */

import type { StepEvent } from '../agent/runnerTypes.js';
import type {
  RunTimeline,
  TimelinePhase,
  TimelinePhaseLabel,
  TimelineEntry,
  TimelineBreakdown,
} from '../types/timeline.js';

function detectPhaseLabel(event: StepEvent, modelSwitched: boolean, assembled: boolean): TimelinePhaseLabel {
  if (assembled) return 'verification';
  if (event.type === 'assemble_output') return 'assembly';
  if (modelSwitched) return 'writing';
  return 'investigation';
}

export function buildTimeline(events: StepEvent[]): RunTimeline {
  if (events.length === 0) {
    return { totalDurationMs: 0, phases: [], breakdown: { llmMs: 0, toolMs: 0, compressionMs: 0, retryMs: 0, idleMs: 0 }, entryCount: 0 };
  }

  const breakdown: TimelineBreakdown = { llmMs: 0, toolMs: 0, compressionMs: 0, retryMs: 0, idleMs: 0 };
  const phases: TimelinePhase[] = [];
  let currentPhaseLabel: TimelinePhaseLabel = 'investigation';
  let currentPhase: TimelinePhase = { label: currentPhaseLabel, startMs: 0, endMs: 0, durationMs: 0, toolCalls: 0, entries: [] };
  let modelSwitched = false;
  let assembled = false;
  let runStartMs = 0;
  let lastEventMs = 0;

  const firstTimestamp = events.find(e => e.timestamp)?.timestamp;
  if (firstTimestamp) {
    runStartMs = new Date(firstTimestamp).getTime();
    currentPhase.startMs = runStartMs;
  }

  for (const event of events) {
    const eventMs = event.timestamp ? new Date(event.timestamp).getTime() : lastEventMs;
    lastEventMs = eventMs;
    const offsetMs = eventMs - runStartMs;

    if (event.type === 'model_switch') modelSwitched = true;
    if (event.type === 'assemble_output') assembled = true;

    const phaseLabel = detectPhaseLabel(event, modelSwitched, assembled);

    if (phaseLabel !== currentPhaseLabel) {
      currentPhase.endMs = eventMs;
      currentPhase.durationMs = currentPhase.endMs - currentPhase.startMs;
      phases.push(currentPhase);
      currentPhaseLabel = phaseLabel;
      currentPhase = { label: phaseLabel, startMs: eventMs, endMs: eventMs, durationMs: 0, toolCalls: 0, entries: [] };
    }

    if (event.type === 'tool_call' || event.type === 'finding') {
      currentPhase.toolCalls++;
      const dur = event.durationMs ?? 0;
      breakdown.toolMs += dur;
      currentPhase.entries.push({
        type: 'tool_call',
        startMs: offsetMs,
        durationMs: dur,
        label: event.action,
        details: event.stateSnapshot ? { ...event.stateSnapshot } : undefined,
      });
    }

    if (event.llmDurationMs) {
      breakdown.llmMs += event.llmDurationMs;
      currentPhase.entries.push({
        type: 'llm_turn',
        startMs: offsetMs - event.llmDurationMs,
        durationMs: event.llmDurationMs,
        label: `turn ${event.step}`,
      });
    }

    if (event.compressionMs) {
      breakdown.compressionMs += event.compressionMs;
      currentPhase.entries.push({
        type: 'compression',
        startMs: offsetMs,
        durationMs: event.compressionMs,
        label: 'context_compression',
      });
    }

    if (event.idleMs && event.idleMs > 0) {
      breakdown.idleMs += event.idleMs;
    }

    if (event.action === 'retry') {
      const retryMs = event.durationMs ?? 0;
      breakdown.retryMs += retryMs;
      currentPhase.entries.push({
        type: 'retry',
        startMs: offsetMs,
        durationMs: retryMs,
        label: 'api_retry',
      });
    }
  }

  currentPhase.endMs = lastEventMs;
  currentPhase.durationMs = currentPhase.endMs - currentPhase.startMs;
  phases.push(currentPhase);

  const totalDurationMs = lastEventMs - runStartMs;
  const entryCount = phases.reduce((sum, p) => sum + p.entries.length, 0);

  return { totalDurationMs, phases, breakdown, entryCount };
}
