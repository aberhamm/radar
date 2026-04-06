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

  it('builds security-review prompt', () => {
    const prompt = buildGoalPrompt('security-review', '/tmp/repo', 50, 5);
    expect(prompt).toContain('/tmp/repo');
    expect(prompt).toContain('security');
    expect(prompt).toContain('record_finding');
    expect(prompt).toContain('assemble_output');
  });

  it('builds nextjs prompt', () => {
    const prompt = buildGoalPrompt('nextjs', '/tmp/repo', 50, 5);
    expect(prompt).toContain('/tmp/repo');
    expect(prompt).toContain('Next.js');
    expect(prompt).toContain('record_finding');
    expect(prompt).toContain('assemble_output');
  });

  it('nextjs prompt includes nextjs-specific category coverage', () => {
    const prompt = buildGoalPrompt('nextjs', '/tmp/repo', 50, 5);
    expect(prompt).toContain('routing');
    expect(prompt).toContain('data-fetching');
    expect(prompt).toContain('performance');
    // Should NOT include CMS-specific categories
    expect(prompt).not.toContain('cms-integration');
    expect(prompt).not.toContain('preview-editing');
  });

  it('builds accessibility prompt', () => {
    const prompt = buildGoalPrompt('accessibility', '/tmp/repo', 50, 5);
    expect(prompt).toContain('/tmp/repo');
    expect(prompt).toContain('WCAG');
    expect(prompt).toContain('accessibility');
    expect(prompt).toContain('record_finding');
    expect(prompt).toContain('assemble_output');
  });

  it('accessibility prompt includes a11y-specific category coverage', () => {
    const prompt = buildGoalPrompt('accessibility', '/tmp/repo', 50, 5);
    expect(prompt).toContain('accessibility');
    expect(prompt).toContain('forms');
    expect(prompt).toContain('aria');
    // Should NOT include CMS-specific categories
    expect(prompt).not.toContain('cms-integration');
    expect(prompt).not.toContain('deployment');
  });

  it('throws on unknown goal', () => {
    expect(() =>
      buildGoalPrompt('nonsense' as any, '/tmp', 50, 5),
    ).toThrow('Unknown goal type');
  });
});
