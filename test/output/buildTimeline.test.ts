import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../../src/output/buildTimeline.js';
import type { StepEvent } from '../../src/agent/runnerTypes.js';

function makeEvent(overrides: Partial<StepEvent>): StepEvent {
  return { step: 1, action: 'read_file', ...overrides };
}

describe('buildTimeline', () => {
  it('returns empty timeline for no events', () => {
    const result = buildTimeline([]);
    expect(result.totalDurationMs).toBe(0);
    expect(result.phases).toEqual([]);
    expect(result.entryCount).toBe(0);
    expect(result.breakdown).toEqual({ llmMs: 0, toolMs: 0, compressionMs: 0, retryMs: 0, idleMs: 0 });
  });

  it('creates a single investigation phase for basic tool calls', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: StepEvent[] = [
      makeEvent({ step: 1, action: 'read_file', type: 'tool_call', timestamp: t0.toISOString(), durationMs: 100 }),
      makeEvent({ step: 2, action: 'glob_files', type: 'tool_call', timestamp: new Date(t0.getTime() + 500).toISOString(), durationMs: 50 }),
    ];

    const result = buildTimeline(events);
    expect(result.phases.length).toBe(1);
    expect(result.phases[0].label).toBe('investigation');
    expect(result.phases[0].toolCalls).toBe(2);
    expect(result.breakdown.toolMs).toBe(150);
  });

  it('detects writing phase after model_switch', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: StepEvent[] = [
      makeEvent({ step: 1, action: 'read_file', type: 'tool_call', timestamp: t0.toISOString(), durationMs: 100 }),
      makeEvent({ step: 2, action: 'switch_to_fast_model', type: 'model_switch', timestamp: new Date(t0.getTime() + 1000).toISOString() }),
      makeEvent({ step: 3, action: 'record_finding', type: 'tool_call', timestamp: new Date(t0.getTime() + 2000).toISOString(), durationMs: 80 }),
    ];

    const result = buildTimeline(events);
    expect(result.phases.length).toBe(2);
    expect(result.phases[0].label).toBe('investigation');
    expect(result.phases[1].label).toBe('writing');
    expect(result.phases[1].toolCalls).toBe(1);
  });

  it('detects verification phase after assemble_output', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: StepEvent[] = [
      makeEvent({ step: 1, action: 'read_file', type: 'tool_call', timestamp: t0.toISOString(), durationMs: 50 }),
      makeEvent({ step: 2, action: 'switch_to_fast_model', type: 'model_switch', timestamp: new Date(t0.getTime() + 500).toISOString() }),
      makeEvent({ step: 3, action: 'assemble_output', type: 'assemble_output', timestamp: new Date(t0.getTime() + 1000).toISOString() }),
      makeEvent({ step: 4, action: 'verify', type: 'tool_call', timestamp: new Date(t0.getTime() + 2000).toISOString(), durationMs: 30 }),
    ];

    const result = buildTimeline(events);
    const labels = result.phases.map(p => p.label);
    expect(labels).toEqual(['investigation', 'writing', 'verification']);
  });

  it('accumulates LLM duration from llmDurationMs field', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: StepEvent[] = [
      makeEvent({ step: 1, action: 'read_file', type: 'tool_call', timestamp: t0.toISOString(), durationMs: 100, llmDurationMs: 800 }),
      makeEvent({ step: 2, action: 'glob_files', type: 'tool_call', timestamp: new Date(t0.getTime() + 1000).toISOString(), durationMs: 50, llmDurationMs: 600 }),
    ];

    const result = buildTimeline(events);
    expect(result.breakdown.llmMs).toBe(1400);
  });

  it('accumulates compression time', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: StepEvent[] = [
      makeEvent({ step: 1, action: 'read_file', type: 'tool_call', timestamp: t0.toISOString(), compressionMs: 200 }),
      makeEvent({ step: 2, action: 'read_file', type: 'tool_call', timestamp: new Date(t0.getTime() + 500).toISOString(), compressionMs: 150 }),
    ];

    const result = buildTimeline(events);
    expect(result.breakdown.compressionMs).toBe(350);
  });

  it('tracks retry events in breakdown', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: StepEvent[] = [
      makeEvent({ step: 1, action: 'retry', type: 'tool_call', timestamp: t0.toISOString(), durationMs: 3000 }),
      makeEvent({ step: 2, action: 'read_file', type: 'tool_call', timestamp: new Date(t0.getTime() + 4000).toISOString(), durationMs: 100 }),
    ];

    const result = buildTimeline(events);
    expect(result.breakdown.retryMs).toBe(3000);
    expect(result.breakdown.toolMs).toBe(3100);
  });

  it('computes totalDurationMs from first to last event', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: StepEvent[] = [
      makeEvent({ step: 1, action: 'read_file', type: 'tool_call', timestamp: t0.toISOString() }),
      makeEvent({ step: 2, action: 'read_file', type: 'tool_call', timestamp: new Date(t0.getTime() + 5000).toISOString() }),
    ];

    const result = buildTimeline(events);
    expect(result.totalDurationMs).toBe(5000);
  });

  it('counts entries across all phases', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    const events: StepEvent[] = [
      makeEvent({ step: 1, action: 'read_file', type: 'tool_call', timestamp: t0.toISOString(), durationMs: 50, llmDurationMs: 300 }),
      makeEvent({ step: 2, action: 'switch_to_fast_model', type: 'model_switch', timestamp: new Date(t0.getTime() + 1000).toISOString() }),
      makeEvent({ step: 3, action: 'record_finding', type: 'finding', timestamp: new Date(t0.getTime() + 2000).toISOString(), durationMs: 40 }),
    ];

    const result = buildTimeline(events);
    expect(result.entryCount).toBe(3);
  });
});
