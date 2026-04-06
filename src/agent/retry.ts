/**
 * Retry with exponential backoff for transient API errors.
 *
 * Per-error-type retry limits, Retry-After header respect,
 * stale connection detection, and exponential backoff with jitter.
 *
 * Ported from Claude Code CLI's withRetry pattern (2026-04-06).
 */

/* ---------- constants ---------- */

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 32_000;

/**
 * Per-status retry ceilings.
 * 429 (rate limit) gets the most patience — the server explicitly asked us to wait.
 * 529 (overloaded) gets few retries — repeated 529s usually mean sustained capacity issues.
 */
const STATUS_RETRY_LIMITS: Record<number, number> = {
  429: 8,   // rate limit — usually transient, honour Retry-After
  529: 3,   // overloaded — bail quickly, unlikely to clear fast
  502: 5,   // bad gateway
  503: 5,   // service unavailable
  408: 5,   // request timeout
};
const CONNECTION_RETRY_LIMIT = 5;
const DEFAULT_RETRY_LIMIT = 3;

/** Connection error codes that indicate a stale/broken socket. */
const STALE_CONNECTION_CODES = new Set(['ECONNRESET', 'EPIPE']);

/** All connection error codes worth retrying. */
const RETRYABLE_CONNECTION_CODES = new Set([
  'ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT',
  'ENOTFOUND', 'EAI_AGAIN', 'NETWORK',
]);

/* ---------- error classification ---------- */

export interface ErrorClassification {
  /** Whether the error is retryable at all. */
  retryable: boolean;
  /** HTTP status code, if any. */
  statusCode?: number;
  /** Maximum retries for this error type. */
  maxRetries: number;
  /** Retry-After delay from headers (ms), if present. */
  retryAfterMs?: number;
  /** True when the error indicates a stale TCP connection (ECONNRESET/EPIPE). */
  staleConnection: boolean;
  /** True when this is a connection-level error (not HTTP). */
  connectionError: boolean;
}

/**
 * Extract an HTTP status code from an error.
 * Checks `.status` property first, then falls back to message parsing.
 */
function extractStatusCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.status === 'number') return obj.status;
    if (typeof obj.statusCode === 'number') return obj.statusCode;
  }
  if (error instanceof Error) {
    const match = error.message.match(/\b([2-5]\d{2})\b/);
    if (match) return parseInt(match[1], 10);
  }
  return undefined;
}

/**
 * Extract Retry-After header value as milliseconds.
 * Checks `.headers` on the error object (common in SDK error types).
 */
function extractRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const obj = error as Record<string, unknown>;

  // Try .headers as a plain object
  let retryAfter: string | undefined;
  if (typeof obj.headers === 'object' && obj.headers !== null) {
    const headers = obj.headers as Record<string, unknown>;
    if (typeof headers['retry-after'] === 'string') {
      retryAfter = headers['retry-after'];
    }
    // Headers object with .get() method (fetch-style)
    if (!retryAfter && typeof (headers as { get?: (k: string) => string }).get === 'function') {
      const val = (headers as { get: (k: string) => string }).get('retry-after');
      if (typeof val === 'string') retryAfter = val;
    }
  }

  if (!retryAfter) return undefined;

  const seconds = parseFloat(retryAfter);
  if (!isNaN(seconds) && seconds > 0) {
    return Math.ceil(seconds * 1000);
  }
  return undefined;
}

/**
 * Extract a connection error code (e.g. ECONNRESET) from an error.
 */
function extractConnectionCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.code === 'string') return obj.code;
    // Check nested cause
    if (typeof obj.cause === 'object' && obj.cause !== null) {
      const cause = obj.cause as Record<string, unknown>;
      if (typeof cause.code === 'string') return cause.code;
    }
  }
  if (error instanceof Error) {
    const msg = error.message;
    for (const code of RETRYABLE_CONNECTION_CODES) {
      if (msg.includes(code)) return code;
    }
    if (msg.includes('fetch failed') || msg.includes('network')) return 'NETWORK';
  }
  return undefined;
}

/**
 * Classify an error for retry decision-making.
 */
export function classifyError(error: unknown): ErrorClassification {
  const statusCode = extractStatusCode(error);
  const retryAfterMs = extractRetryAfterMs(error);
  const connCode = extractConnectionCode(error);

  // Connection-level errors (no HTTP status)
  if (connCode && !statusCode) {
    return {
      retryable: RETRYABLE_CONNECTION_CODES.has(connCode),
      maxRetries: CONNECTION_RETRY_LIMIT,
      retryAfterMs,
      staleConnection: STALE_CONNECTION_CODES.has(connCode),
      connectionError: true,
    };
  }

  // HTTP status errors
  if (statusCode) {
    const limit = STATUS_RETRY_LIMITS[statusCode];
    if (limit !== undefined) {
      return {
        retryable: true,
        statusCode,
        maxRetries: limit,
        retryAfterMs,
        staleConnection: false,
        connectionError: false,
      };
    }
    // 5xx not in the explicit map — still retryable with low limit
    if (statusCode >= 500) {
      return {
        retryable: true,
        statusCode,
        maxRetries: DEFAULT_RETRY_LIMIT,
        retryAfterMs,
        staleConnection: false,
        connectionError: false,
      };
    }
  }

  // Everything else: not retryable
  return {
    retryable: false,
    statusCode,
    maxRetries: 0,
    retryAfterMs,
    staleConnection: false,
    connectionError: false,
  };
}

/* ---------- backoff ---------- */

/**
 * Compute retry delay with exponential backoff + jitter.
 *
 * If Retry-After header is present and within bounds, use it.
 * Otherwise: 500ms * 2^attempt with 0-25% jitter, capped at 32s.
 */
export function computeDelay(
  attempt: number,
  retryAfterMs?: number,
  maxDelay = MAX_DELAY_MS,
): number {
  // Honour Retry-After if present and reasonable (≤ 2 minutes)
  if (retryAfterMs && retryAfterMs > 0 && retryAfterMs <= 120_000) {
    // Add small jitter (0-10%) to avoid thundering herd
    return Math.ceil(retryAfterMs * (1 + Math.random() * 0.1));
  }

  const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), maxDelay);
  const jitter = Math.random() * 0.25 * baseDelay;
  return Math.ceil(baseDelay + jitter);
}

/* ---------- public API ---------- */

export interface RetryOptions {
  /** Override max retries (caps per-error-type limits). */
  maxRetries?: number;
  /** Base delay in ms (default 500). */
  baseDelay?: number;
  /** Called before each retry sleep. */
  onRetry?: (
    attempt: number,
    error: Error,
    delayMs: number,
    classification: ErrorClassification,
  ) => void;
  /** Called when a stale connection is detected (ECONNRESET/EPIPE).
   *  Caller can use this to recreate HTTP clients. */
  onStaleConnection?: () => void;
}

export function isMaxOutputTokensError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('max_output_tokens') || msg.includes('max_tokens') || msg.includes('output token');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute an async function with retry on transient errors.
 *
 * Retry limits are per-error-type:
 *   429 → up to 8 retries (rate limit, usually clears)
 *   529 → up to 3 retries (overloaded, bail quickly)
 *   502/503 → up to 5 retries (gateway errors)
 *   Connection errors → up to 5 retries
 *   Other 5xx → up to 3 retries
 *
 * Honours Retry-After header when present (capped at 2 minutes).
 * Detects stale connections (ECONNRESET/EPIPE) and notifies caller.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const globalMax = options.maxRetries ?? Infinity; // per-error limits take precedence
  let lastError: Error | undefined;
  let consecutiveByType = new Map<string, number>(); // track consecutive errors per type

  for (let attempt = 0; ; attempt++) {
    try {
      const result = await fn();
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const classification = classifyError(error);

      // Effective max retries: min of per-error-type limit and caller's global cap
      const effectiveMax = Math.min(classification.maxRetries, globalMax);

      if (!classification.retryable || attempt >= effectiveMax) {
        throw lastError;
      }

      // Track consecutive errors by type key for future escalation
      const typeKey = classification.statusCode
        ? String(classification.statusCode)
        : classification.connectionError ? 'connection' : 'unknown';
      consecutiveByType.set(typeKey, (consecutiveByType.get(typeKey) ?? 0) + 1);

      // Notify caller of stale connection so they can recreate HTTP clients
      if (classification.staleConnection) {
        options.onStaleConnection?.();
      }

      const delayMs = computeDelay(attempt, classification.retryAfterMs);

      options.onRetry?.(attempt + 1, lastError, delayMs, classification);
      await sleep(delayMs);
    }
  }
}
