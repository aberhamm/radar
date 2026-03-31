import { describe, it, expect } from 'vitest';
import { renderBrief } from '../../src/output/brief.js';
import { computeScorecard } from '../../src/output/scorecard.js';

describe('renderBrief', () => {
  it('renders a markdown brief with all sections', () => {
    const scorecard = computeScorecard('test-repo', 'onboarding', []);
    const sections = {
      project_overview: '## Project Overview\n\nThis is a test project.',
      stack_and_architecture: '## Stack and Architecture\n\nNext.js 14 + Sitecore.',
    };

    const md = renderBrief(scorecard, sections, [], [], 15, 50);

    expect(md).toContain('# Project Onboarding Brief: test-repo');
    expect(md).toContain('15 / 50 tool calls');
    expect(md).toContain('## Project Overview');
    expect(md).toContain('## Architecture Scorecard');
    expect(md).toContain('🟢');
  });

  it('renders investigation log if present', () => {
    const scorecard = computeScorecard('test-repo', 'audit', []);
    const log = [
      { step: 1, action: 'list_directory', reasoning: 'Check structure', result: '23 entries' },
    ];

    const md = renderBrief(scorecard, {}, log, [], 5, 50);

    expect(md).toContain('## Investigation Log');
    expect(md).toContain('list_directory');
  });
});
