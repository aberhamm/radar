import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { maskToken, deriveLabels, ciApiFetch } from '../../src/ci/utils.js';
import type { Finding } from '../../src/types/findings.js';

describe('maskToken', () => {
  it('masks all but last 4 characters', () => {
    expect(maskToken('ghp_abc123xyz789')).toBe('****z789');
  });

  it('masks token showing last 4 chars', () => {
    expect(maskToken('ghp_abcdefghijkl')).toBe('****ijkl');
  });

  it('masks short tokens entirely', () => {
    expect(maskToken('abc')).toBe('****');
    expect(maskToken('abcd')).toBe('****');
  });

  it('masks 5-char token showing last 4', () => {
    expect(maskToken('12345')).toBe('****2345');
  });
});

describe('deriveLabels', () => {
  function makeFinding(category: string, severity: string): Finding {
    return {
      id: 'F-001',
      category: category as any,
      severity: severity as any,
      title: 'Test',
      description: 'Test finding',
      evidence: [],
      tags: [],
    };
  }

  it('returns labels for findings with severity >= medium', () => {
    const findings = [
      makeFinding('security', 'high'),
      makeFinding('dependencies', 'medium'),
    ];
    const labels = deriveLabels(findings);
    expect(labels).toContain('radar:security-review-needed');
    expect(labels).toContain('radar:deps-outdated');
  });

  it('skips findings with severity < medium', () => {
    const findings = [makeFinding('security', 'low')];
    const labels = deriveLabels(findings);
    expect(labels).toHaveLength(0);
  });

  it('returns empty array for no findings', () => {
    expect(deriveLabels([])).toEqual([]);
  });

  it('deduplicates labels from same category', () => {
    const findings = [
      makeFinding('security', 'high'),
      makeFinding('security', 'critical'),
    ];
    const labels = deriveLabels(findings);
    expect(labels).toEqual(['radar:security-review-needed']);
  });

  it('uses custom label map', () => {
    const findings = [makeFinding('security', 'high')];
    const labels = deriveLabels(findings, { security: 'custom:sec' });
    expect(labels).toEqual(['custom:sec']);
  });
});

describe('ciApiFetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok:true with data for successful JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ id: 1 }),
    });

    const result = await ciApiFetch<{ id: number }>('https://api.example.com/test');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ id: 1 });
  });

  it('returns ok:false with error for non-OK response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: () => Promise.resolve('Resource not accessible'),
    });

    const result = await ciApiFetch('https://api.example.com/test');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.error).toBe('Resource not accessible');
  });

  it('returns ok:false with error for network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await ciApiFetch('https://api.example.com/test');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toBe('ECONNREFUSED');
  });

  it('sends JSON body when json option is provided', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({}),
    });

    await ciApiFetch('https://api.example.com/test', {
      method: 'POST',
      json: { body: 'test' },
    });

    const [, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(opts.body).toBe('{"body":"test"}');
    expect(opts.headers['Content-Type']).toBe('application/json');
  });
});
