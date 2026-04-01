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
    expect(md).toContain('15 tool calls');
    expect(md).toContain('repo-audit-delivery-agent');
    expect(md).toContain('## Project Overview');
    expect(md).toContain('## Architecture Scorecard');
    expect(md).toContain('🟢');
  });

  it('normalizes variant section keys from LLM', () => {
    const scorecard = computeScorecard('test-repo', 'onboarding', []);
    // LLM uses variant keys — should still render
    const sections = {
      key_files_table: '## Key Files\n\n| Path | Purpose |\n|---|---|',
      environment_and_configuration: '## Environment\n\nNeeds .env setup.',
      questions_for_client: '## Questions\n\n1. What is the deploy target?',
      suggested_next_actions: '## Next Actions\n\n1. Add tests.',
    };

    const md = renderBrief(scorecard, sections, [], [], 10, 50);

    expect(md).toContain('## Key Files');
    expect(md).toContain('## Environment');
    expect(md).toContain('## Questions');
    expect(md).toContain('## Next Actions');
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
