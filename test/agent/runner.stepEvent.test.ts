/**
 * Tests for StepEvent interface and model_switch event type.
 */
import { describe, it, expect } from 'vitest';
import type { StepEvent } from '../../src/agent/runner.js';

describe('StepEvent interface', () => {
  it('accepts model_switch as a valid event type', () => {
    const event: StepEvent = {
      step: 1,
      action: 'model_switch',
      type: 'model_switch',
      result: 'Switched to fast model.',
    };
    expect(event.type).toBe('model_switch');
  });

  it('accepts batchId as an optional field', () => {
    const event: StepEvent = {
      step: 1,
      action: 'list_directory',
      type: 'tool_call',
      batchId: 'abc-123',
    };
    expect(event.batchId).toBe('abc-123');
  });

  it('model_switch type is distinct from budget_warning', () => {
    const modelSwitch: StepEvent = {
      step: 1,
      action: 'model_switch',
      type: 'model_switch',
    };
    const budgetWarning: StepEvent = {
      step: 2,
      action: 'budget_extended',
      type: 'budget_warning',
    };
    expect(modelSwitch.type).not.toBe(budgetWarning.type);
    expect(modelSwitch.type).toBe('model_switch');
    expect(budgetWarning.type).toBe('budget_warning');
  });

  it('batchId groups parallel tool calls from same turn', () => {
    const batchId = 'turn-batch-uuid';
    const call1: StepEvent = { step: 1, action: 'list_directory', type: 'tool_call', batchId };
    const call2: StepEvent = { step: 2, action: 'parse_package_json', type: 'tool_call', batchId };
    expect(call1.batchId).toBe(call2.batchId);
  });
});
