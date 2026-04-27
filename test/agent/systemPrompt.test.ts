import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  loadRule,
  listRuleFiles,
  validateRules,
} from '../../src/agent/systemPrompt.js';

describe('loadRule', () => {
  it('loads core.md', async () => {
    const content = await loadRule('core.md');
    expect(content).not.toBeNull();
    expect(content).toContain('Core investigation rules');
  });

  it('returns null for non-existent file', async () => {
    expect(await loadRule('does-not-exist.md')).toBeNull();
  });
});

describe('buildSystemPrompt', () => {
  it('assembles core + goal for unknown platform', async () => {
    const prompt = await buildSystemPrompt('onboarding', 'unknown');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('Onboarding brief rules');
    expect(prompt).not.toContain('Sitecore');
    expect(prompt).not.toContain('Optimizely');
  });

  it('includes platform rules for sitecore', async () => {
    const prompt = await buildSystemPrompt('audit', 'sitecore');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('Sitecore-specific investigation rules');
    expect(prompt).toContain('Architecture Audit Rules');
  });

  it('includes platform rules for optimizely', async () => {
    const prompt = await buildSystemPrompt('migration', 'optimizely');
    expect(prompt).toContain('Optimizely-specific investigation rules');
    expect(prompt).toContain('Migration Scout Rules');
  });

  it('joins sections with markdown separator', async () => {
    const prompt = await buildSystemPrompt('onboarding', 'sitecore');
    expect(prompt).toContain('\n\n---\n\n');
  });
});

describe('listRuleFiles', () => {
  it('returns all markdown rule files', async () => {
    const files = await listRuleFiles();
    expect(files).toContain('core.md');
    expect(files).toContain('platform-sitecore.md');
    expect(files).toContain('platform-optimizely.md');
    expect(files).toContain('goal-onboarding.md');
    expect(files).toContain('goal-audit.md');
    expect(files).toContain('goal-migration.md');
    expect(files).toContain('goal-security-review.md');
    expect(files).toContain('goal-ci-check.md');
    expect(files).toContain('goal-nextjs.md');
    expect(files).toContain('goal-accessibility.md');
    expect(files).toContain('goal-component-map.md');
    expect(files).toContain('goal-universal.md');
    expect(files).toContain('goal-audit-generic.md');
    expect(files.length).toBe(13);
  });
});

describe('component-map goal', () => {
  it('goal-component-map.md loads without error', async () => {
    const content = await loadRule('goal-component-map.md');
    expect(content).not.toBeNull();
    expect(content).toContain('Component Map Rules');
  });

  it('buildSystemPrompt includes component-map rules', async () => {
    const prompt = await buildSystemPrompt('component-map', 'unknown');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('Component Map Rules');
  });

  it('validateRules passes for component-map with unknown platform', () => {
    expect(validateRules('component-map', 'unknown')).toEqual([]);
  });
});

describe('security-review goal', () => {
  it('goal-security-review.md loads without error', async () => {
    const content = await loadRule('goal-security-review.md');
    expect(content).not.toBeNull();
    expect(content).toContain('Security Review Goal');
  });

  it('buildSystemPrompt includes security-review rules', async () => {
    const prompt = await buildSystemPrompt('security-review', 'unknown');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('Security Review Goal');
  });

  it('validateRules passes for security-review with unknown platform', () => {
    expect(validateRules('security-review', 'unknown')).toEqual([]);
  });

  it('includes secrets archaeology patterns', async () => {
    const content = await loadRule('goal-security-review.md');
    expect(content).toContain('Secrets Archaeology');
    expect(content).toContain('AKIA');
    expect(content).toContain('ghp_');
    expect(content).toContain('xoxb-');
    expect(content).toContain('sk-');
    expect(content).toContain('Git History Scanning');
  });
});

describe('nextjs goal', () => {
  it('goal-nextjs.md loads without error', async () => {
    const content = await loadRule('goal-nextjs.md');
    expect(content).not.toBeNull();
    expect(content).toContain('Next.js Audit Rules');
  });

  it('buildSystemPrompt includes nextjs rules', async () => {
    const prompt = await buildSystemPrompt('nextjs', 'unknown');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('Next.js Audit Rules');
  });

  it('validateRules passes for nextjs with unknown platform', () => {
    expect(validateRules('nextjs', 'unknown')).toEqual([]);
  });
});

describe('accessibility goal', () => {
  it('goal-accessibility.md loads without error', async () => {
    const content = await loadRule('goal-accessibility.md');
    expect(content).not.toBeNull();
    expect(content).toContain('WCAG Accessibility Audit Rules');
  });

  it('buildSystemPrompt includes accessibility rules', async () => {
    const prompt = await buildSystemPrompt('accessibility', 'unknown');
    expect(prompt).toContain('Core investigation rules');
    expect(prompt).toContain('WCAG Accessibility Audit Rules');
  });

  it('validateRules passes for accessibility with unknown platform', () => {
    expect(validateRules('accessibility', 'unknown')).toEqual([]);
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
