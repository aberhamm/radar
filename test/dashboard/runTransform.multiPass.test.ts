import { describe, it, expect } from 'vitest';
import { transformRunData } from '../../dashboard/src/lib/runTransform.js';

const emptyResult = { state: { findings: [] } } as any;

describe('runTransform — multi-pass event handling', () => {
  it('captures investigation turns from multiple switch_to_fast_model events', () => {
    const events = [
      { step: 1, type: 'text_response', reasoning: 'Pass 1 investigation', timestamp: '2026-04-10T10:00:00Z' },
      { step: 2, type: 'tool_call', action: 'list_directory', args: '{"path":"."}', timestamp: '2026-04-10T10:00:01Z' },
      { step: 5, type: 'tool_call', action: 'switch_to_fast_model', timestamp: '2026-04-10T10:00:02Z' },
      { step: 6, type: 'tool_call', action: 'record_finding', args: '{}', timestamp: '2026-04-10T10:00:03Z' },
      { step: 7, type: 'text_response', reasoning: 'Pass 2 investigation', timestamp: '2026-04-10T10:00:10Z' },
      { step: 8, type: 'tool_call', action: 'parse_package_json', args: '{"path":"package.json"}', timestamp: '2026-04-10T10:00:11Z' },
      { step: 12, type: 'tool_call', action: 'switch_to_fast_model', timestamp: '2026-04-10T10:00:12Z' },
      { step: 8, type: 'tool_call', action: 'record_finding', args: '{}', timestamp: '2026-04-10T10:00:13Z' },
    ] as any[];

    const result = transformRunData(events, emptyResult);

    // Should have: pass1 investigation turn, switch turn, pass2 investigation turn, switch turn
    const switchTurns = result.analysisTurns.filter(t => t.activities.some(a => a.label === 'switch_to_fast_model'));
    expect(switchTurns).toHaveLength(2);
    expect(switchTurns[0].activities[0].detail).toContain('tool calls used');
    expect(switchTurns[1].activities[0].detail).toContain('tool calls used');

    const investigationTurns = result.analysisTurns.filter(t => !t.activities.some(a => a.label === 'switch_to_fast_model'));
    expect(investigationTurns).toHaveLength(2);
    expect(investigationTurns[0].reasoning).toBe('Pass 1 investigation');
    expect(investigationTurns[1].reasoning).toBe('Pass 2 investigation');
  });

  it('creates a separator turn for pass_boundary events', () => {
    const events = [
      { step: 1, type: 'text_response', reasoning: 'Audit investigation', timestamp: '2026-04-10T10:00:00Z' },
      { step: 2, type: 'tool_call', action: 'list_directory', args: '{"path":"."}', timestamp: '2026-04-10T10:00:01Z' },
      { step: 3, action: 'pass_boundary', result: 'security-review', timestamp: '2026-04-10T10:00:05Z' },
      { step: 4, type: 'text_response', reasoning: 'Security investigation', timestamp: '2026-04-10T10:00:06Z' },
      { step: 5, type: 'tool_call', action: 'check_gitignore', args: '{"path":"."}', timestamp: '2026-04-10T10:00:07Z' },
    ] as any[];

    const result = transformRunData(events, emptyResult);

    // Should have: audit turn, pass_boundary separator, security turn
    expect(result.analysisTurns).toHaveLength(3);

    const separator = result.analysisTurns[1];
    expect(separator.reasoning).toBe('Starting security-review investigation pass.');
    expect(separator.activities[0].label).toBe('pass_boundary');
    expect(separator.activities[0].detail).toBe('security-review');
    expect(separator.categoriesCovered).toEqual([]);

    // Investigation resumes after pass boundary (not stuck in writing phase)
    expect(result.analysisTurns[2].reasoning).toBe('Security investigation');
    expect(result.analysisTurns[2].activities[0].label).toBe('check_gitignore');
  });

  it('includes all events as investigation turns when no switch event exists', () => {
    const events = [
      { step: 1, type: 'text_response', reasoning: 'Looking around', timestamp: '2026-04-10T10:00:00Z' },
      { step: 2, type: 'tool_call', action: 'list_directory', args: '{"path":"."}', timestamp: '2026-04-10T10:00:01Z' },
      { step: 3, type: 'text_response', reasoning: 'Digging deeper', timestamp: '2026-04-10T10:00:02Z' },
      { step: 4, type: 'tool_call', action: 'parse_package_json', args: '{"path":"package.json"}', timestamp: '2026-04-10T10:00:03Z' },
      { step: 5, type: 'tool_call', action: 'record_finding', args: '{}', timestamp: '2026-04-10T10:00:04Z' },
      { step: 6, type: 'tool_call', action: 'assemble_output', args: '{}', timestamp: '2026-04-10T10:00:05Z' },
    ] as any[];

    const result = transformRunData(events, emptyResult);

    // Without a switch, inWritingPhase is never set, so record_finding and assemble_output
    // are included as regular tool calls (graceful fallback)
    expect(result.analysisTurns).toHaveLength(2);
    expect(result.analysisTurns[0].reasoning).toBe('Looking around');
    expect(result.analysisTurns[1].reasoning).toBe('Digging deeper');
    // record_finding and assemble_output appear as activities in the second turn
    const allLabels = result.analysisTurns[1].activities.map(a => a.label);
    expect(allLabels).toContain('parse_package_json');
    expect(allLabels).toContain('record_finding');
    expect(allLabels).toContain('assemble_output');

    // No switch turn should exist
    const switchTurns = result.analysisTurns.filter(t => t.activities.some(a => a.label === 'switch_to_fast_model'));
    expect(switchTurns).toHaveLength(0);
  });

  it('backward compat: single switch still splits investigation from writing', () => {
    const events = [
      { step: 1, type: 'text_response', reasoning: 'Single-goal audit', timestamp: '2026-04-10T10:00:00Z' },
      { step: 2, type: 'tool_call', action: 'parse_package_json', args: '{"path":"package.json"}', timestamp: '2026-04-10T10:00:01Z' },
      { step: 3, type: 'tool_call', action: 'analyze_env_usage', args: '{"path":"src"}', timestamp: '2026-04-10T10:00:02Z' },
      { step: 8, type: 'tool_call', action: 'switch_to_fast_model', timestamp: '2026-04-10T10:00:03Z' },
      { step: 5, type: 'tool_call', action: 'record_finding', args: '{}', timestamp: '2026-04-10T10:00:04Z' },
      { step: 6, type: 'tool_call', action: 'record_finding', args: '{}', timestamp: '2026-04-10T10:00:05Z' },
      { step: 7, type: 'tool_call', action: 'assemble_output', args: '{}', timestamp: '2026-04-10T10:00:06Z' },
    ] as any[];

    const result = transformRunData(events, emptyResult);

    // Investigation turn + switch turn only; writing events skipped
    expect(result.analysisTurns).toHaveLength(2);
    expect(result.analysisTurns[0].reasoning).toBe('Single-goal audit');
    expect(result.analysisTurns[0].activities).toHaveLength(2);
    expect(result.analysisTurns[0].activities[0].label).toBe('parse_package_json');
    expect(result.analysisTurns[0].activities[1].label).toBe('analyze_env_usage');

    // Switch turn is present
    const switchTurn = result.analysisTurns[1];
    expect(switchTurn.activities[0].label).toBe('switch_to_fast_model');
    expect(switchTurn.activities[0].detail).toContain('tool calls used');

    // No record_finding or assemble_output turns
    const allLabels = result.analysisTurns.flatMap(t => t.activities.map(a => a.label));
    expect(allLabels).not.toContain('record_finding');
    expect(allLabels).not.toContain('assemble_output');
  });
});
