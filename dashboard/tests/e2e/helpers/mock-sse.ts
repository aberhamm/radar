import type { Page, Route } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

// Playwright test runner sets cwd to the project root (dashboard/).
// Use process.cwd() to resolve fixture paths portably.
const FIXTURES_DIR = path.resolve(process.cwd(), 'tests', 'fixtures');
const SSE_EVENTS_PATH = path.join(FIXTURES_DIR, 'sse-events.json');

interface SSEEvent {
  type?: string;
  action?: string;
  step?: number;
  result?: unknown;
  [key: string]: unknown;
}

/**
 * Load the scripted SSE events from the fixture file.
 */
function loadEvents(): SSEEvent[] {
  const raw = fs.readFileSync(SSE_EVENTS_PATH, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Format a single event as an SSE `data:` line.
 * The run_complete event has its result nested differently —
 * it wraps the result under `type: 'run_complete'` at the top level.
 */
function formatSSELine(event: SSEEvent): string {
  if (event.type === 'run_complete') {
    // The real server sends: data: { type: 'run_complete', result: { scorecard, metrics, terminationReason } }
    return `data: ${JSON.stringify({ type: 'run_complete', result: event.result })}\n\n`;
  }
  if (event.type === 'status') {
    return `data: ${JSON.stringify({ type: 'status', step: event.step, action: event.action, result: event.result, timestamp: event.timestamp })}\n\n`;
  }
  // For tool_call and finding events, send the raw event object
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Set up Playwright route handlers that intercept the dashboard's API
 * endpoints with mocked responses for E2E testing.
 *
 * Intercepts:
 * - POST /api/run → JSON { ok: true, runId: "mock-run-001" }
 * - GET /api/events → text/event-stream replaying scripted events
 * - GET /api/session → JSON with idle status (prevents reconnect interference)
 */
export async function setupMockRoutes(page: Page): Promise<void> {
  const events = loadEvents();

  // Mock POST /api/run — returns success immediately
  await page.route('**/api/run', async (route: Route) => {
    const method = route.request().method();
    if (method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          runId: 'mock-run-001',
          repoName: 'mock-repo',
          goal: 'audit-generic',
          budget: 45,
          goalCount: 1,
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock GET /api/events — replays SSE events with delay
  await page.route('**/api/events', async (route: Route) => {
    const method = route.request().method();
    if (method !== 'GET') {
      await route.continue();
      return;
    }

    // Build the full SSE body upfront with delays simulated via chunked delivery
    // Playwright route.fulfill doesn't support streaming, so we send all events at once.
    // The 30ms delay is conceptual — in tests the events arrive instantly but the UI
    // processes them asynchronously which simulates the streaming effect.
    let body = '';
    for (const event of events) {
      body += formatSSELine(event);
    }

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body,
    });
  });

  // Mock GET /api/session — returns idle status so UI doesn't auto-reconnect
  await page.route('**/api/session', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'idle',
        history: [],
        hasMore: false,
      }),
    });
  });

  // Mock GET /api/repos — returns empty cached repos
  await page.route('**/api/repos', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ repos: [] }),
    });
  });

  // Mock POST /api/detect-roots — returns no monorepo roots
  await page.route('**/api/detect-roots', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ roots: [], isMonorepo: false }),
    });
  });
}

/**
 * Set up mock routes that simulate an error during the SSE stream.
 * Sends 3 normal events then a run_error event.
 */
export async function setupMockRoutesWithError(page: Page): Promise<void> {
  const events = loadEvents();
  const errorEvents = events.slice(0, 3); // First 3 tool_call events

  // Mock POST /api/run — returns success
  await page.route('**/api/run', async (route: Route) => {
    const method = route.request().method();
    if (method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          runId: 'mock-run-error-001',
          repoName: 'mock-repo',
          goal: 'audit-generic',
          budget: 45,
          goalCount: 1,
        }),
      });
    } else {
      await route.continue();
    }
  });

  // Mock GET /api/events — sends 3 events then an error
  await page.route('**/api/events', async (route: Route) => {
    const method = route.request().method();
    if (method !== 'GET') {
      await route.continue();
      return;
    }

    let body = '';
    for (const event of errorEvents) {
      body += formatSSELine(event);
    }
    // Append error event
    body += `data: ${JSON.stringify({ type: 'run_error', error: 'Model connection timeout after 30s' })}\n\n`;

    await route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
      body,
    });
  });

  // Mock GET /api/session
  await page.route('**/api/session', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'idle',
        history: [],
        hasMore: false,
      }),
    });
  });

  // Mock GET /api/repos
  await page.route('**/api/repos', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ repos: [] }),
    });
  });

  // Mock POST /api/detect-roots
  await page.route('**/api/detect-roots', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ roots: [], isMonorepo: false }),
    });
  });
}
