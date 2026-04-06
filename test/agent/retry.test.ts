import { describe, it, expect, vi } from 'vitest';
import { withRetry, isMaxOutputTokensError, classifyError, computeDelay } from '../../src/agent/retry.js';

/* ── classifyError ── */

describe('classifyError', () => {
  it('classifies 429 as retryable with 8 max retries', () => {
    const c = classifyError(Object.assign(new Error('rate limited'), { status: 429 }));
    expect(c.retryable).toBe(true);
    expect(c.statusCode).toBe(429);
    expect(c.maxRetries).toBe(8);
  });

  it('classifies 529 as retryable with 3 max retries', () => {
    const c = classifyError(new Error('HTTP 529 Overloaded'));
    expect(c.retryable).toBe(true);
    expect(c.statusCode).toBe(529);
    expect(c.maxRetries).toBe(3);
  });

  it('classifies 502/503 as retryable with 5 max retries', () => {
    expect(classifyError(new Error('502 Bad Gateway')).maxRetries).toBe(5);
    expect(classifyError(new Error('503 Service Unavailable')).maxRetries).toBe(5);
  });

  it('classifies unknown 5xx as retryable with default limit', () => {
    const c = classifyError(Object.assign(new Error('server error'), { status: 500 }));
    expect(c.retryable).toBe(true);
    expect(c.maxRetries).toBe(3);
  });

  it('classifies ECONNRESET as stale connection', () => {
    const c = classifyError(Object.assign(new Error('connection reset'), { code: 'ECONNRESET' }));
    expect(c.retryable).toBe(true);
    expect(c.staleConnection).toBe(true);
    expect(c.connectionError).toBe(true);
    expect(c.maxRetries).toBe(5);
  });

  it('classifies EPIPE as stale connection', () => {
    const c = classifyError(new Error('write EPIPE'));
    expect(c.staleConnection).toBe(true);
  });

  it('classifies ECONNREFUSED as retryable non-stale', () => {
    const c = classifyError(new Error('connect ECONNREFUSED'));
    expect(c.retryable).toBe(true);
    expect(c.staleConnection).toBe(false);
    expect(c.connectionError).toBe(true);
  });

  it('classifies fetch failed as retryable connection error', () => {
    const c = classifyError(new Error('fetch failed'));
    expect(c.retryable).toBe(true);
    expect(c.connectionError).toBe(true);
  });

  it('classifies 401 as non-retryable', () => {
    const c = classifyError(Object.assign(new Error('unauthorized'), { status: 401 }));
    expect(c.retryable).toBe(false);
  });

  it('classifies random error as non-retryable', () => {
    const c = classifyError(new Error('Invalid API key'));
    expect(c.retryable).toBe(false);
    expect(c.maxRetries).toBe(0);
  });

  it('extracts Retry-After from headers object', () => {
    const err = Object.assign(new Error('rate limited'), {
      status: 429,
      headers: { 'retry-after': '5' },
    });
    const c = classifyError(err);
    expect(c.retryAfterMs).toBe(5000);
  });

  it('extracts Retry-After from Headers with .get()', () => {
    const headers = new Map([['retry-after', '10']]);
    const err = Object.assign(new Error('rate limited'), {
      status: 429,
      headers: { get: (k: string) => headers.get(k) },
    });
    const c = classifyError(err);
    expect(c.retryAfterMs).toBe(10_000);
  });

  it('extracts status from .statusCode property', () => {
    const c = classifyError(Object.assign(new Error('fail'), { statusCode: 503 }));
    expect(c.statusCode).toBe(503);
    expect(c.retryable).toBe(true);
  });

  it('extracts connection code from nested cause', () => {
    const err = Object.assign(new Error('fail'), {
      cause: { code: 'ETIMEDOUT' },
    });
    const c = classifyError(err);
    expect(c.retryable).toBe(true);
    expect(c.connectionError).toBe(true);
  });
});

/* ── computeDelay ── */

describe('computeDelay', () => {
  it('uses Retry-After when present and reasonable', () => {
    const delay = computeDelay(0, 5000);
    // 5000ms + up to 10% jitter
    expect(delay).toBeGreaterThanOrEqual(5000);
    expect(delay).toBeLessThanOrEqual(5600);
  });

  it('ignores Retry-After over 2 minutes', () => {
    const delay = computeDelay(0, 200_000);
    // Falls back to exponential: 500ms * 2^0 + jitter
    expect(delay).toBeLessThan(700);
  });

  it('exponential backoff increases with attempt', () => {
    const d0 = computeDelay(0);
    const d3 = computeDelay(3);
    expect(d3).toBeGreaterThan(d0);
  });

  it('caps at maxDelay', () => {
    const delay = computeDelay(20); // 500 * 2^20 would be huge
    expect(delay).toBeLessThanOrEqual(32_000 * 1.25 + 1); // max + max jitter
  });
});

/* ── withRetry ── */

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('retries on 429 and succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) throw new Error('HTTP 429 Too Many Requests');
      return 'ok';
    }, { baseDelay: 10 });
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('retries on connection errors', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      if (calls === 1) throw new Error('fetch failed: ECONNRESET');
      return 'ok';
    }, { baseDelay: 10 });
    expect(result).toBe('ok');
  });

  it('throws non-retryable errors immediately', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('Invalid API key');
    }, { baseDelay: 10 })).rejects.toThrow('Invalid API key');
    expect(calls).toBe(1);
  });

  it('respects per-error-type retry limits (529 → 3)', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('HTTP 529 Overloaded');
    }, { baseDelay: 1 })).rejects.toThrow('529');
    expect(calls).toBe(4); // initial + 3 retries
  });

  it('respects caller maxRetries cap over per-error limit', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('HTTP 429 Rate Limited');
    }, { maxRetries: 2, baseDelay: 1 })).rejects.toThrow('429');
    expect(calls).toBe(3); // initial + 2 retries (not 8)
  });

  it('calls onRetry with classification', async () => {
    const classifications: Array<{ statusCode?: number; maxRetries: number }> = [];
    let calls = 0;
    await withRetry(async () => {
      calls++;
      if (calls < 2) throw Object.assign(new Error('rate limited'), { status: 429 });
      return 'ok';
    }, {
      baseDelay: 1,
      onRetry: (_attempt, _error, _delay, classification) => {
        classifications.push({
          statusCode: classification.statusCode,
          maxRetries: classification.maxRetries,
        });
      },
    });
    expect(classifications).toEqual([{ statusCode: 429, maxRetries: 8 }]);
  });

  it('calls onStaleConnection on ECONNRESET', async () => {
    const staleCallbackFn = vi.fn();
    let calls = 0;
    await withRetry(async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('reset'), { code: 'ECONNRESET' });
      return 'ok';
    }, {
      baseDelay: 1,
      onStaleConnection: staleCallbackFn,
    });
    expect(staleCallbackFn).toHaveBeenCalledOnce();
  });

  it('honours Retry-After header on 429', async () => {
    let calls = 0;
    const delays: number[] = [];
    await withRetry(async () => {
      calls++;
      if (calls === 1) {
        throw Object.assign(new Error('rate limited'), {
          status: 429,
          headers: { 'retry-after': '1' },
        });
      }
      return 'ok';
    }, {
      onRetry: (_attempt, _error, delayMs) => {
        delays.push(delayMs);
      },
    });
    // Should be ~1000ms + up to 10% jitter
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(delays[0]).toBeLessThanOrEqual(1200);
  });
});

/* ── isMaxOutputTokensError ── */

describe('isMaxOutputTokensError', () => {
  it('detects max_output_tokens error', () => {
    expect(isMaxOutputTokensError(new Error('max_output_tokens exceeded'))).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isMaxOutputTokensError(new Error('network timeout'))).toBe(false);
  });
});
