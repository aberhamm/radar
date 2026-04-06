import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Mock node:fs so the route doesn't touch the real filesystem.
// We use vi.hoisted() to create stable references before vi.mock hoisting.
// ---------------------------------------------------------------------------

const { mockExistsSync, mockReadFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    },
  };
});

// Import the route handler after mocks are established
import { GET } from '../../dashboard/src/app/api/rules/route.js';

// ---------------------------------------------------------------------------
// Helper to build a NextRequest with query params
// ---------------------------------------------------------------------------

function makeRequest(url: string): NextRequest {
  return new NextRequest(new URL(url));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rule content for a valid goal', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation((filePath: string) => {
      const p = String(filePath);
      if (p.endsWith('core.md')) return '# Core rules';
      if (p.endsWith('goal-onboarding.md')) return '# Onboarding rules';
      return '';
    });

    const response = await GET(makeRequest('http://localhost/api/rules?goal=onboarding'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      'core.md': '# Core rules',
      'goal-onboarding.md': '# Onboarding rules',
    });
  });

  it('returns 400 for an invalid goal (path traversal attempt)', async () => {
    const response = await GET(
      makeRequest('http://localhost/api/rules?goal=../../../etc/passwd'),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: 'Invalid goal' });
  });

  it('returns 400 for a goal not in the allowlist', async () => {
    const response = await GET(
      makeRequest('http://localhost/api/rules?goal=arbitrary-value'),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: 'Invalid goal' });
  });

  it('defaults to onboarding when no goal parameter is provided', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('# Default content');

    const response = await GET(makeRequest('http://localhost/api/rules'));

    expect(response.status).toBe(200);
    const body = await response.json();
    // Should have requested goal-onboarding.md (the default)
    expect(body).toHaveProperty('goal-onboarding.md');
    expect(body).toHaveProperty('core.md');
  });

  it('returns partial result when only some rule files exist', async () => {
    mockExistsSync.mockImplementation((filePath: string) => {
      return String(filePath).endsWith('core.md');
    });
    mockReadFileSync.mockReturnValue('# Core only');

    const response = await GET(makeRequest('http://localhost/api/rules?goal=audit'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('core.md');
    expect(body).not.toHaveProperty('goal-audit.md');
  });

  it('accepts all goals in the allowlist', async () => {
    const allowedGoals = [
      'onboarding', 'audit', 'migration',
      'component-map', 'ci-check', 'security-review',
      'nextjs', 'accessibility',
    ];

    mockExistsSync.mockReturnValue(false);

    for (const goal of allowedGoals) {
      const response = await GET(makeRequest(`http://localhost/api/rules?goal=${goal}`));
      expect(response.status).toBe(200);
    }
  });
});
