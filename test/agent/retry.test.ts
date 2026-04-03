import { describe, it, expect } from 'vitest';
import { withRetry, isMaxOutputTokensError } from '../../src/agent/retry.js';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('retries on 429 error and succeeds', async () => {
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

  it('throws after max retries exhausted', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new Error('HTTP 529 Overloaded');
    }, { maxRetries: 2, baseDelay: 10 })).rejects.toThrow('529');
    expect(calls).toBe(3); // initial + 2 retries
  });

  it('calls onRetry callback', async () => {
    const retries: number[] = [];
    let calls = 0;
    await withRetry(async () => {
      calls++;
      if (calls < 2) throw new Error('HTTP 429');
      return 'ok';
    }, {
      baseDelay: 10,
      onRetry: (attempt) => retries.push(attempt),
    });
    expect(retries).toEqual([1]);
  });
});

describe('isMaxOutputTokensError', () => {
  it('detects max_output_tokens error', () => {
    expect(isMaxOutputTokensError(new Error('max_output_tokens exceeded'))).toBe(true);
  });

  it('returns false for other errors', () => {
    expect(isMaxOutputTokensError(new Error('network timeout'))).toBe(false);
  });
});
