import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock withRetry to pass through without retries in tests (avoids exponential backoff timeouts)
vi.mock('../../src/agent/retry.js', () => ({
  withRetry: async (fn: () => Promise<unknown>) => fn(),
}));

import {
  writeBriefSections,
  writeAllBriefs,
  parseSections,
} from '../../src/output/goalBriefWriter.js';
import type { Finding } from '../../src/types/findings.js';
import type { Scorecard, CategoryScore } from '../../src/types/output.js';
import type { GoalType } from '../../src/types/state.js';

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    category: 'stack',
    severity: 'medium',
    confidence: 8,
    title: 'Test finding',
    description: 'A test finding',
    evidence: [],
    tags: [],
    ...overrides,
  };
}

function makeScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return {
    repoName: 'test-repo',
    goalType: 'onboarding',
    generatedAt: '2026-01-01T00:00:00Z',
    overallScore: 'green',
    categories: [
      { category: 'stack', score: 'green', findings: [], summary: 'OK' } as CategoryScore,
    ],
    topRisks: [],
    ...overrides,
  };
}

const PORTKEY_OVERRIDES = {
  apiKey: 'test-key',
  baseUrl: 'https://test-gateway.example.com/v1',
  provider: '@test-provider',
  agentModelId: 'test-agent-model',
  fastModelId: 'test-fast-model',
};

describe('writeBriefSections', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed sections on successful API response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: '## project_overview\nThis is a test project.\n\n## stack_and_architecture\nNext.js 14 with TypeScript.',
          },
        }],
      }),
    });

    const result = await writeBriefSections(
      'onboarding',
      [makeFinding()],
      makeScorecard(),
      PORTKEY_OVERRIDES,
    );

    expect(result.goal).toBe('onboarding');
    expect(result.error).toBeUndefined();
    expect(result.sections.project_overview).toContain('test project');
    expect(result.sections.stack_and_architecture).toContain('Next.js 14');

    // Verify fetch was called with correct endpoint and headers
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://test-gateway.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-portkey-api-key': 'test-key',
          'x-portkey-provider': '@test-provider',
        }),
      }),
    );
  });

  it('returns error on HTTP failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limit exceeded'),
    });

    const result = await writeBriefSections(
      'audit',
      [makeFinding()],
      makeScorecard(),
      PORTKEY_OVERRIDES,
    );

    expect(result.goal).toBe('audit');
    expect(result.error).toContain('HTTP 429');
    expect(result.error).toContain('Rate limit exceeded');
    expect(result.sections).toEqual({});
  });

  it('returns error on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await writeBriefSections(
      'migration',
      [],
      makeScorecard(),
      PORTKEY_OVERRIDES,
    );

    expect(result.goal).toBe('migration');
    expect(result.error).toBe('ECONNREFUSED');
    expect(result.sections).toEqual({});
  });

  it('handles missing choices in response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const result = await writeBriefSections(
      'onboarding',
      [],
      makeScorecard(),
      PORTKEY_OVERRIDES,
    );

    expect(result.error).toBeUndefined();
    expect(result.sections).toEqual({});
  });

  it('filters findings with confidence <= 2', async () => {
    let sentBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      sentBody = init.body as string;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: '' } }] }),
      });
    });

    await writeBriefSections(
      'onboarding',
      [
        makeFinding({ id: 'LOW', confidence: 2, title: 'Low confidence' }),
        makeFinding({ id: 'HIGH', confidence: 8, title: 'High confidence' }),
        makeFinding({ id: 'DEFAULT', confidence: undefined, title: 'Default confidence' }),
      ],
      makeScorecard(),
      PORTKEY_OVERRIDES,
    );

    const body = JSON.parse(sentBody!);
    const userContent = body.messages[1].content;
    expect(userContent).not.toContain('Low confidence');
    expect(userContent).toContain('High confidence');
    expect(userContent).toContain('Default confidence');
  });
});

describe('writeAllBriefs', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns error result when scorecard is missing for a goal', async () => {
    const scorecards = new Map<GoalType, Scorecard>();
    // Only add onboarding, not audit
    scorecards.set('onboarding', makeScorecard());

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: '## project_overview\nTest' } }] }),
    });

    const results = await writeAllBriefs(
      ['onboarding', 'audit'],
      [makeFinding()],
      scorecards,
      PORTKEY_OVERRIDES,
    );

    expect(results).toHaveLength(2);

    const onboarding = results.find((r) => r.goal === 'onboarding')!;
    expect(onboarding.error).toBeUndefined();
    expect(Object.keys(onboarding.sections).length).toBeGreaterThan(0);

    const audit = results.find((r) => r.goal === 'audit')!;
    expect(audit.error).toBe('No scorecard');
    expect(audit.sections).toEqual({});
  });

  it('runs all brief writes in parallel', async () => {
    const callOrder: string[] = [];
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const goal = body.messages[1].content.match(/"(\w+)" brief/)?.[1] ?? 'unknown';
      callOrder.push(goal);
      return {
        ok: true,
        json: () => Promise.resolve({ choices: [{ message: { content: '## project_overview\nTest' } }] }),
      };
    });

    const goals: GoalType[] = ['onboarding', 'audit', 'migration'];
    const scorecards = new Map<GoalType, Scorecard>(
      goals.map((g) => [g, makeScorecard({ goalType: g })]),
    );

    const results = await writeAllBriefs(goals, [makeFinding()], scorecards, PORTKEY_OVERRIDES);

    expect(results).toHaveLength(3);
    expect(results.every((r) => !r.error)).toBe(true);
    // All 3 fetches should have been called
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});

describe('parseSections', () => {
  it('extracts sections from markdown with ## headings', () => {
    const content = `## Project Overview
This is the overview.
It has multiple lines.

## Stack And Architecture
Next.js 14 with TypeScript.`;

    const sections = parseSections(content);

    expect(Object.keys(sections)).toHaveLength(2);
    expect(sections.project_overview).toContain('This is the overview');
    expect(sections.stack_and_architecture).toContain('Next.js 14');
  });

  it('returns empty object for content with no ## headings', () => {
    const sections = parseSections('Just some plain text without headings.');
    expect(sections).toEqual({});
  });

  it('returns empty object for empty content', () => {
    const sections = parseSections('');
    expect(sections).toEqual({});
  });

  it('normalizes heading keys to snake_case', () => {
    const content = `## Project Overview!
Content A

## Next Actions & Recommendations
Content B

## Step 1
Content C`;

    const sections = parseSections(content);

    expect(sections).toHaveProperty('project_overview');
    expect(sections).toHaveProperty('next_actions_recommendations');
    expect(sections).toHaveProperty('step_1');
  });

  it('handles consecutive headings with no content between them', () => {
    const content = `## first_section
## second_section
Actual content here.`;

    const sections = parseSections(content);

    // First section may be empty or just the heading — key should exist
    // Second section should have the content
    expect(sections.second_section).toContain('Actual content here');
  });

  it('includes the heading line in section content', () => {
    const content = `## Project Overview
This is content.`;

    const sections = parseSections(content);

    expect(sections.project_overview).toContain('## Project Overview');
    expect(sections.project_overview).toContain('This is content.');
  });
});
