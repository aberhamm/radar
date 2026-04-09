import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendWebhook } from '../../src/ci/webhook.js';

describe('sendWebhook', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const payload = {
    repo: 'test-repo',
    score: 'green',
    findings: 3,
    newFindings: 1,
    resolvedFindings: 0,
    durationMs: 5000,
    estimatedCostUsd: 0.05,
  };

  it('sends POST with payload to valid URL', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await sendWebhook('https://hooks.slack.com/services/test', payload);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/test',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('blocks SSRF attempts to internal domains', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    globalThis.fetch = vi.fn();

    await sendWebhook('http://localhost:8080/webhook', payload);
    await sendWebhook('http://169.254.169.254/metadata', payload);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('blocks private IP addresses', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    globalThis.fetch = vi.fn();

    await sendWebhook('http://10.0.0.1/webhook', payload);
    await sendWebhook('http://192.168.1.1/webhook', payload);

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('handles fetch timeout gracefully', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    // Should not throw
    await sendWebhook('https://hooks.slack.com/services/test', payload);
  });

  it('handles network errors gracefully', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    // Should not throw
    await sendWebhook('https://hooks.slack.com/services/test', payload);
  });
});
