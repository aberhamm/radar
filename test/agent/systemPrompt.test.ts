import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  loadRule,
  listRuleFiles,
  validateRules,
} from '../../src/agent/systemPrompt.js';

describe('loadRule', () => {
  it('loads core.md', () => {
    const content = loadRule('core.md');
    expect(content).not.toBeNull();
    expect(content).toContain('Core investigation rules');
  });

  it('returns null for non-existent file', () => {
    expect(loadRule('does-not-exist.md')).toBeNull();
  });
});

describe('buildSystemPrompt', () => {
  it('assembles core + goal for unknown platform', () => {
    const prompt = buildSystemPrompt('onboarding', 'unknown');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('Onboarding brief rules');
    expect(prompt).not.toContain('Sitecore');
    expect(prompt).not.toContain('Optimizely');
  });

  it('includes platform rules for sitecore', () => {
    const prompt = buildSystemPrompt('audit', 'sitecore');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('Sitecore-specific investigation rules');
    expect(prompt).toContain('Architecture audit rules');
  });

  it('includes platform rules for optimizely', () => {
    const prompt = buildSystemPrompt('migration', 'optimizely');
    expect(prompt).toContain('Optimizely-specific investigation rules');
    expect(prompt).toContain('Migration scout rules');
  });

  it('joins sections with markdown separator', () => {
    const prompt = buildSystemPrompt('onboarding', 'sitecore');
    expect(prompt).toContain('\n\n---\n\n');
  });
});

describe('listRuleFiles', () => {
  it('returns all markdown rule files', () => {
    const files = listRuleFiles();
    expect(files).toContain('core.md');
    expect(files).toContain('platform-sitecore.md');
    expect(files).toContain('platform-optimizely.md');
    expect(files).toContain('goal-onboarding.md');
    expect(files).toContain('goal-audit.md');
    expect(files).toContain('goal-migration.md');
    expect(files).toContain('goal-security-review.md');
    expect(files.length).toBe(7);
  });
});

describe('security-review goal', () => {
  it('goal-security-review.md loads without error', () => {
    const content = loadRule('goal-security-review.md');
    expect(content).not.toBeNull();
    expect(content).toContain('Security Review Goal');
  });

  it('buildSystemPrompt includes security-review rules', () => {
    const prompt = buildSystemPrompt('security-review', 'unknown');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('Security Review Goal');
  });

  it('validateRules passes for security-review with unknown platform', () => {
    expect(validateRules('security-review', 'unknown')).toEqual([]);
  });
});

describe('validateRules', () => {
  it('returns empty array when all rules present', () => {
    expect(validateRules('onboarding', 'sitecore')).toEqual([]);
  });

  it('reports missing platform file for unknown platform name', () => {
    const missing = validateRules('onboarding', 'wordpress');
    expect(missing).toContain('platform-wordpress.md');
  });

  it('skips platform check for unknown', () => {
    expect(validateRules('audit', 'unknown')).toEqual([]);
  });
});
