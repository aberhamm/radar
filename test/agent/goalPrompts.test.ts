import { describe, it, expect } from 'vitest';
import { buildGoalPrompt } from '../../src/agent/goalPrompts.js';

describe('buildGoalPrompt', () => {
  it('builds onboarding prompt with repo path and budgets', () => {
    const prompt = buildGoalPrompt('onboarding', '/tmp/repo', 50, 5);
    expect(prompt).toContain('/tmp/repo');
    expect(prompt).toContain('onboarding brief');
    expect(prompt).toContain('50 calls');
    expect(prompt).toContain('5 searches');
    expect(prompt).toContain('record_finding');
    expect(prompt).toContain('assemble_output');
  });

  it('builds audit prompt', () => {
    const prompt = buildGoalPrompt('audit', '/tmp/repo', 50, 5);
    expect(prompt).toContain('architecture audit');
    expect(prompt).toContain('scorecard');
  });

  it('builds migration prompt', () => {
    const prompt = buildGoalPrompt('migration', '/tmp/repo', 50, 5);
    expect(prompt).toContain('migration');
    expect(prompt).toContain('hotspots');
  });

  it('throws on unknown goal', () => {
    expect(() =>
      buildGoalPrompt('nonsense' as any, '/tmp', 50, 5),
    ).toThrow('Unknown goal type');
  });
});
