import { describe, it, expect } from 'vitest';
import { renderInvestigationHtml } from '../../src/output/investigationHtml.js';
import type { Scorecard } from '../../src/types/output.js';

const mockScorecard: Scorecard = {
  repoName: 'test-repo',
  goalType: 'onboarding',
  generatedAt: new Date().toISOString(),
  overallScore: 'yellow',
  categories: [
    { category: 'stack', score: 'green', findings: [{} as any, {} as any], summary: '' },
    { category: 'security', score: 'red', findings: [{} as any, {} as any, {} as any], summary: '' },
    { category: 'dependencies', score: 'yellow', findings: [{} as any], summary: '' },
  ],
  topRisks: [],
};

describe('renderInvestigationHtml', () => {
  it('produces valid HTML with doctype', () => {
    const html = renderInvestigationHtml({
      repoName: 'test-repo',
      entries: [],
      scorecard: mockScorecard,
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('</html>');
    expect(html).toContain('test-repo');
  });

  it('renders scorecard categories with colors', () => {
    const html = renderInvestigationHtml({
      repoName: 'test-repo',
      entries: [],
      scorecard: mockScorecard,
    });
    expect(html).toContain('stack');
    expect(html).toContain('GREEN');
    expect(html).toContain('RED');
    expect(html).toContain('YELLOW');
  });

  it('renders investigation steps as collapsible details', () => {
    const html = renderInvestigationHtml({
      repoName: 'test-repo',
      entries: [
        { step: 1, action: 'list_directory', reasoning: 'Start exploring', result: '{"entries":[]}' },
        { step: 2, action: 'record_finding', reasoning: 'Found an issue', result: 'recorded' },
      ],
      scorecard: mockScorecard,
    });
    expect(html).toContain('<details');
    expect(html).toContain('list_directory');
    expect(html).toContain('record_finding');
    expect(html).toContain('#1');
    expect(html).toContain('#2');
  });

  it('includes stats when provided', () => {
    const html = renderInvestigationHtml({
      repoName: 'test-repo',
      entries: [],
      scorecard: mockScorecard,
      toolCallCount: 42,
      findingCount: 11,
      totalDuration: '8m 23s',
    });
    expect(html).toContain('42');
    expect(html).toContain('11');
    expect(html).toContain('8m 23s');
  });

  it('escapes HTML in content', () => {
    const html = renderInvestigationHtml({
      repoName: '<script>alert("xss")</script>',
      entries: [
        { step: 1, action: 'read_file', reasoning: '<img src=x>', result: '&"quotes"' },
      ],
      scorecard: mockScorecard,
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
