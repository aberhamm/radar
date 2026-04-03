/**
 * Retry with exponential backoff for transient API errors.
 *
 * Handles 429 (rate limit), 529 (overloaded), and connection errors.
 * On max_output_tokens errors, can optionally retry with a fallback model.
 */

const RETRYABLE_STATUS_CODES = new Set([429, 529, 502, 503]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  // HTTP status codes
  for (const code of RETRYABLE_STATUS_CODES) {
    if (msg.includes(String(code))) return true;
  }
  // Connection errors
  if (msg.includes('econnreset') || msg.includes('econnrefused') || msg.includes('etimedout')) return true;
  if (msg.includes('fetch failed') || msg.includes('network')) return true;
  return false;
}

export function isMaxOutputTokensError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('max_output_tokens') || msg.includes('max_tokens') || msg.includes('output token');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry on transient errors.
 * Uses exponential backoff with jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const baseDelay = options.baseDelay ?? BASE_DELAY_MS;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt >= maxRetries || !isRetryableError(error)) {
        throw lastError;
      }

      // Exponential backoff with jitter: base * 2^attempt * (0.5-1.5)
      const jitter = 0.5 + Math.random();
      const delayMs = Math.min(baseDelay * Math.pow(2, attempt) * jitter, 30_000);

      options.onRetry?.(attempt + 1, lastError, delayMs);
      await delay(delayMs);
    }
  }

  throw lastError ?? new Error('Retry exhausted');
}
