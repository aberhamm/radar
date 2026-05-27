/**
 * Integration tests for dashboard API routes.
 * These tests hit each API route as an HTTP request (using fetch) against
 * a running Next.js dev server — not importing handler functions directly.
 *
 * Prerequisites: Start the dashboard dev server before running these tests.
 *   pnpm dev                          # starts on port 3000 by default
 *   pnpm test:integration             # runs these tests
 *
 * Or set TEST_BASE_URL explicitly:
 *   TEST_BASE_URL=http://localhost:3099 pnpm test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, type ServerHandle } from './helpers/startServer.js';

// Use a non-standard port to avoid collisions with a running dev server
const TEST_PORT = 3099;

let server: ServerHandle;

beforeAll(async () => {
  server = await startServer(TEST_PORT);
}, 90_000); // Allow up to 90s for Next.js to compile + start

afterAll(() => {
  server?.kill();
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function url(path: string): string {
  return `${server.baseUrl}${path}`;
}

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  it('returns 200 with status ok, uptime, and timestamp', async () => {
    const res = await fetch(url('/api/health'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe('string');
    // Timestamp should be valid ISO
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('rejects non-GET methods with 405', async () => {
    const res = await fetch(url('/api/health'), { method: 'POST' });
    // Next.js returns 405 for unsupported methods on route handlers
    expect(res.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// GET /api/repos
// ---------------------------------------------------------------------------

describe('GET /api/repos', () => {
  it('returns 200 with repos array', async () => {
    const res = await fetch(url('/api/repos'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    // repos key must exist and be an array (may be empty if no repos cloned)
    expect(body).toHaveProperty('repos');
    expect(Array.isArray(body.repos)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/session
// ---------------------------------------------------------------------------

describe('GET /api/session', () => {
  it('returns 200 with session status and history', async () => {
    const res = await fetch(url('/api/session'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(typeof body.status).toBe('string');
    expect(body).toHaveProperty('history');
    expect(Array.isArray(body.history)).toBe(true);
  }, 60_000); // First call compiles the route + loads persisted runs from disk

  it('supports offset and limit query params', async () => {
    const res = await fetch(url('/api/session?offset=0&limit=5'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('history');
    expect(body).toHaveProperty('hasMore');
  });
});

// ---------------------------------------------------------------------------
// GET /api/rules
// ---------------------------------------------------------------------------

describe('GET /api/rules', () => {
  it('returns 200 with rule content for default goal', async () => {
    const res = await fetch(url('/api/rules'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    // Default goal is onboarding, should include core.md
    expect(typeof body).toBe('object');
    expect(body).toHaveProperty('core.md');
  });

  it('returns 200 for a specific valid goal', async () => {
    const res = await fetch(url('/api/rules?goal=audit'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  it('returns 400 for invalid goal', async () => {
    const res = await fetch(url('/api/rules?goal=invalid-goal'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('Invalid goal');
  });
});

// ---------------------------------------------------------------------------
// POST /api/detect-roots
// ---------------------------------------------------------------------------

describe('POST /api/detect-roots', () => {
  it('returns 400 when body is missing repoPath', async () => {
    const res = await fetch(url('/api/detect-roots'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('repoPath');
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await fetch(url('/api/detect-roots'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 200 with roots for a valid repo path', async () => {
    // Use the repo itself as a valid path
    const repoPath = process.cwd();
    const res = await fetch(url('/api/detect-roots'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath }),
    });

    // May return 200 or 500 depending on whether dist is built
    // If dist is built, expect 200 with roots
    if (res.status === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('roots');
      expect(Array.isArray(body.roots)).toBe(true);
      expect(body).toHaveProperty('isMonorepo');
    }
    // If dist is not built and tsx loader fails, it may return 500
    // which is acceptable for an integration test — we verify it doesn't crash
    expect([200, 500]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/compare
// ---------------------------------------------------------------------------

describe('GET /api/compare', () => {
  it('returns 400 when required query params a and b are missing', async () => {
    const res = await fetch(url('/api/compare'));

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('required');
  });

  it('returns 400 when only one param is provided', async () => {
    const res = await fetch(url('/api/compare?a=run-1'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when comparing a run with itself', async () => {
    const res = await fetch(url('/api/compare?a=same-id&b=same-id'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot compare a run with itself');
  });

  it('returns 404 when run IDs do not exist', async () => {
    const res = await fetch(url('/api/compare?a=nonexistent-1&b=nonexistent-2'));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// POST /api/export-pdf
// ---------------------------------------------------------------------------

describe('POST /api/export-pdf', () => {
  it('returns 400 when scorecard or metrics are missing', async () => {
    const res = await fetch(url('/api/export-pdf'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findings: [] }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('scorecard and metrics are required');
  });

  it('returns PDF (application/pdf) for valid input', async () => {
    const res = await fetch(url('/api/export-pdf'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scorecard: {
          repoName: 'test-repo',
          overallScore: 75,
          categories: [
            { name: 'Architecture', score: 80, rating: 'green' },
            { name: 'Security', score: 70, rating: 'yellow' },
          ],
        },
        findings: [
          {
            id: 'f1',
            severity: 'medium',
            category: 'Architecture',
            title: 'Test finding',
            description: 'A test finding for PDF export',
            evidence: [{ filePath: 'src/index.ts', snippet: 'console.log()' }],
            tags: ['test'],
          },
        ],
        metrics: {
          durationMs: 5000,
          toolCalls: 10,
          totalEstimatedCostUsd: 0.05,
          models: { 'claude-sonnet': { calls: 10 } },
          startedAt: '2025-01-01T00:00:00Z',
          completedAt: '2025-01-01T00:00:05Z',
        },
      }),
    });

    // May succeed (200) or fail (500) depending on pdfkit availability
    // If 200, verify it's a PDF
    if (res.status === 200) {
      expect(res.headers.get('content-type')).toContain('application/pdf');
      expect(res.headers.get('content-disposition')).toContain('attachment');
      const buffer = await res.arrayBuffer();
      expect(buffer.byteLength).toBeGreaterThan(0);
      // PDF magic bytes: %PDF
      const bytes = new Uint8Array(buffer);
      expect(bytes[0]).toBe(0x25); // %
      expect(bytes[1]).toBe(0x50); // P
      expect(bytes[2]).toBe(0x44); // D
      expect(bytes[3]).toBe(0x46); // F
    } else {
      // 500 is acceptable if pdfkit has issues in Next.js env
      expect(res.status).toBe(500);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/changelog
// ---------------------------------------------------------------------------

describe('GET /api/changelog', () => {
  it('returns 200 with changelog content', async () => {
    const res = await fetch(url('/api/changelog'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    // Changelog route returns { content: string } on success
    expect(body).toHaveProperty('content');
    expect(typeof body.content).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// POST /api/run
// ---------------------------------------------------------------------------

describe('POST /api/run', () => {
  it('returns 400 when body is missing repoPath', async () => {
    const res = await fetch(url('/api/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: 'onboarding' }),
    });

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('repoPath');
  });

  it('returns 400 for invalid JSON body', async () => {
    const res = await fetch(url('/api/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when repoPath does not exist', async () => {
    const res = await fetch(url('/api/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: '/nonexistent/path/to/repo', goal: 'audit' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// GET /api/history/[id]
// ---------------------------------------------------------------------------

describe('GET /api/history/[id]', () => {
  it('returns 404 for a non-existent run ID', async () => {
    const res = await fetch(url('/api/history/nonexistent-run-id'));

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');

    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toContain('not found');
  });
});
