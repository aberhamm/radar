import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Finding } from '../../src/types/findings.js';
import {
  renderIssueTitle,
  renderIssueBody,
  fingerprintLabel,
  issueLabels,
  severityPassesThreshold,
  createIssuesFromFindings,
  type CreateIssuesConfig,
} from '../../src/ci/githubIssues.js';

// ── Helpers ────────────────────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F-001',
    category: 'security',
    severity: 'high',
    title: 'Exposed API Key',
    description: 'API key found in source code',
    evidence: [{
      filePath: 'src/config.ts',
      lineNumber: 42,
      snippet: 'const key = "sk_live_abc123"',
      description: 'Hardcoded API key in config',
      verificationStatus: 'verified',
    }],
    tags: ['security', 'api-key'],
    fingerprint: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    ...overrides,
  };
}

function mockFetch(responses: Array<{ ok: boolean; status: number; data?: unknown }>) {
  let callIndex = 0;
  globalThis.fetch = vi.fn().mockImplementation(() => {
    const r = responses[callIndex++] ?? { ok: false, status: 500 };
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      statusText: r.ok ? 'OK' : 'Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve(r.data),
      text: () => Promise.resolve(JSON.stringify(r.data ?? '')),
    });
  });
}

function baseConfig(overrides: Partial<CreateIssuesConfig> = {}): CreateIssuesConfig {
  return {
    owner: 'aberhamm',
    repo: 'xmcloud-starter-js',
    token: 'ghp_test123',
    findings: [makeFinding()],
    severityThreshold: 'medium',
    apiBase: 'https://api.github.com',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('renderIssueTitle', () => {
  it('formats severity prefix and title', () => {
    const title = renderIssueTitle(makeFinding());
    expect(title).toBe('[HIGH] Exposed API Key');
  });

  it('truncates long titles to 256 chars', () => {
    const longTitle = 'A'.repeat(300);
    const title = renderIssueTitle(makeFinding({ title: longTitle }));
    expect(title.length).toBeLessThanOrEqual(256);
    expect(title).toContain('[HIGH]');
    expect(title).toContain('...');
  });
});

describe('renderIssueBody', () => {
  it('includes finding details', () => {
    const body = renderIssueBody(makeFinding());
    expect(body).toContain('## Exposed API Key');
    expect(body).toContain('**Severity:** `high`');
    expect(body).toContain('**Category:** `security`');
    expect(body).toContain('### Description');
    expect(body).toContain('API key found in source code');
    expect(body).toContain('### Evidence');
    expect(body).toContain('`src/config.ts:42`');
    expect(body).toContain('const key = "sk_live_abc123"');
    expect(body).toContain('`#security`');
    expect(body).toContain('Fingerprint:');
  });

  it('includes confidence when present', () => {
    const body = renderIssueBody(makeFinding({ confidence: 8 }));
    expect(body).toContain('**Confidence:** 8/10');
  });

  it('omits evidence section when empty', () => {
    const body = renderIssueBody(makeFinding({ evidence: [] }));
    expect(body).not.toContain('### Evidence');
  });

  it('omits tags section when empty', () => {
    const body = renderIssueBody(makeFinding({ tags: [] }));
    expect(body).not.toContain('### Tags');
  });
});

describe('fingerprintLabel', () => {
  it('returns radar:fp: prefix with first 12 hex chars', () => {
    const label = fingerprintLabel('a1b2c3d4e5f6a1b2c3d4e5f6abcdef');
    expect(label).toBe('radar:fp:a1b2c3d4e5f6');
  });

  it('stays under 50 chars', () => {
    const label = fingerprintLabel('a'.repeat(64));
    expect(label.length).toBeLessThanOrEqual(50);
  });
});

describe('issueLabels', () => {
  it('includes finding, severity, category, and fingerprint labels', () => {
    const labels = issueLabels(makeFinding());
    expect(labels).toContain('radar:finding');
    expect(labels).toContain('radar:high');
    expect(labels).toContain('radar:security');
    expect(labels.some(l => l.startsWith('radar:fp:'))).toBe(true);
  });
});

describe('severityPassesThreshold', () => {
  it('critical passes all thresholds', () => {
    expect(severityPassesThreshold('critical', 'critical')).toBe(true);
    expect(severityPassesThreshold('critical', 'high')).toBe(true);
    expect(severityPassesThreshold('critical', 'medium')).toBe(true);
    expect(severityPassesThreshold('critical', 'low')).toBe(true);
    expect(severityPassesThreshold('critical', 'info')).toBe(true);
  });

  it('info only passes info threshold', () => {
    expect(severityPassesThreshold('info', 'info')).toBe(true);
    expect(severityPassesThreshold('info', 'low')).toBe(false);
    expect(severityPassesThreshold('info', 'medium')).toBe(false);
  });

  it('medium passes medium, low, info but not high', () => {
    expect(severityPassesThreshold('medium', 'medium')).toBe(true);
    expect(severityPassesThreshold('medium', 'low')).toBe(true);
    expect(severityPassesThreshold('medium', 'high')).toBe(false);
  });
});

describe('createIssuesFromFindings', () => {
  it('creates issues for findings above severity threshold', async () => {
    // Mock: ensureLabel calls (4 labels) + dedup check (empty) + create issue
    const responses: Array<{ ok: boolean; status: number; data?: unknown }> = [];
    // Labels: radar:finding, radar:high, radar:security, radar:fp:...
    for (let i = 0; i < 4; i++) {
      responses.push({ ok: true, status: 201, data: {} });
    }
    // Dedup check: no existing issue
    responses.push({ ok: true, status: 200, data: [] });
    // Create issue
    responses.push({
      ok: true,
      status: 201,
      data: { html_url: 'https://github.com/aberhamm/xmcloud-starter-js/issues/1', number: 1 },
    });
    mockFetch(responses);

    const result = await createIssuesFromFindings(baseConfig());
    expect(result.summary.created).toBe(1);
    expect(result.results[0].status).toBe('created');
    expect(result.results[0].issueUrl).toContain('issues/1');
  });

  it('skips findings below severity threshold', async () => {
    const config = baseConfig({
      findings: [makeFinding({ severity: 'info' })],
      severityThreshold: 'medium',
    });

    const result = await createIssuesFromFindings(config);
    expect(result.summary.skippedSeverity).toBe(1);
    expect(result.results[0].status).toBe('skipped_severity');
    // No fetch calls needed — original fetch should not have been called
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });

  it('skips duplicates when existing issue found', async () => {
    const responses: Array<{ ok: boolean; status: number; data?: unknown }> = [];
    // Labels
    for (let i = 0; i < 4; i++) {
      responses.push({ ok: true, status: 201, data: {} });
    }
    // Dedup check: existing issue found
    responses.push({
      ok: true,
      status: 200,
      data: [{ html_url: 'https://github.com/aberhamm/xmcloud-starter-js/issues/5' }],
    });
    mockFetch(responses);

    const result = await createIssuesFromFindings(baseConfig());
    expect(result.summary.skippedDuplicate).toBe(1);
    expect(result.results[0].status).toBe('skipped_duplicate');
    expect(result.results[0].issueUrl).toContain('issues/5');
  });

  it('handles API errors gracefully', async () => {
    const responses: Array<{ ok: boolean; status: number; data?: unknown }> = [];
    // Labels
    for (let i = 0; i < 4; i++) {
      responses.push({ ok: true, status: 201, data: {} });
    }
    // Dedup check: no existing
    responses.push({ ok: true, status: 200, data: [] });
    // Create issue fails
    responses.push({ ok: false, status: 403, data: { message: 'Forbidden' } });
    mockFetch(responses);

    const result = await createIssuesFromFindings(baseConfig());
    expect(result.summary.errored).toBe(1);
    expect(result.results[0].status).toBe('error');
  });

  it('dry run checks dedup but does not create issues', async () => {
    // Dedup check only (no label creation, no issue creation)
    mockFetch([
      { ok: true, status: 200, data: [] }, // no existing issue
    ]);

    const config = baseConfig({ dryRun: true });
    const result = await createIssuesFromFindings(config);
    expect(result.summary.created).toBe(1);
    expect(result.results[0].status).toBe('created');
    // Only 1 fetch call (dedup check), no label or issue creation calls
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('handles multiple findings with mixed results', async () => {
    const findings = [
      makeFinding({ id: 'F-001', severity: 'critical', fingerprint: 'aaa' + '0'.repeat(61) }),
      makeFinding({ id: 'F-002', severity: 'high', fingerprint: 'bbb' + '0'.repeat(61) }),
      makeFinding({ id: 'F-003', severity: 'info', fingerprint: 'ccc' + '0'.repeat(61) }),
    ];

    const responses: Array<{ ok: boolean; status: number; data?: unknown }> = [];
    // Labels for 2 eligible findings — unique labels: radar:finding, radar:critical, radar:high, radar:security, radar:fp:aaa..., radar:fp:bbb...
    for (let i = 0; i < 6; i++) {
      responses.push({ ok: true, status: 201, data: {} });
    }
    // F-001 dedup check: no existing
    responses.push({ ok: true, status: 200, data: [] });
    // F-001 create
    responses.push({ ok: true, status: 201, data: { html_url: 'https://github.com/test/issues/1', number: 1 } });
    // F-002 dedup check: existing found
    responses.push({ ok: true, status: 200, data: [{ html_url: 'https://github.com/test/issues/99' }] });
    mockFetch(responses);

    const result = await createIssuesFromFindings(baseConfig({ findings }));
    expect(result.summary.created).toBe(1);
    expect(result.summary.skippedDuplicate).toBe(1);
    expect(result.summary.skippedSeverity).toBe(1);
    expect(result.results).toHaveLength(3);
  });

  it('treats 422 on label creation as success', async () => {
    const responses: Array<{ ok: boolean; status: number; data?: unknown }> = [];
    // Labels: all return 422 (already exist)
    for (let i = 0; i < 4; i++) {
      responses.push({ ok: false, status: 422, data: { message: 'Validation Failed' } });
    }
    // Dedup check: no existing
    responses.push({ ok: true, status: 200, data: [] });
    // Create issue
    responses.push({ ok: true, status: 201, data: { html_url: 'https://github.com/test/issues/1', number: 1 } });
    mockFetch(responses);

    const result = await createIssuesFromFindings(baseConfig());
    expect(result.summary.created).toBe(1);
  });
});
