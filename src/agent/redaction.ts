/**
 * Secret redaction — strips sensitive values from tool output before LLM context.
 *
 * This is defense-in-depth for known repos. Not a security boundary for
 * untrusted production use — regex-based redaction can be bypassed.
 * Real protection requires output validation at the LLM layer.
 */

const SECRET_PATTERNS = [
  // Key=value patterns: API_KEY=sk-abc123, secret="abc", password: "xyz"
  // Requires the key name to contain a secret-related word AND a meaningful value
  /\b(api[_-]?key|secret[_-]?key?|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key|client[_-]?secret)\s*[=:]\s*["']?([^\s"',\n]{4,})["']?/gi,
  // Common env var patterns: STRIPE_SECRET_KEY=sk_live_xxx
  // Matches ALL_CAPS env vars that contain SECRET, KEY, TOKEN, PASSWORD, etc.
  /\b([A-Z][A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*["']?([^\s"',\n]{4,})["']?/g,
];

/** Values that look like placeholders — don't redact these. */
const PLACEHOLDER_RE = /your[_-]?(?:api[_-]?)?key|example|placeholder|xxx+|<[^>]+>|\bhere\b/i;

/**
 * Redact secret values from a string.
 * Only replaces the VALUE part, keeps the key name for context.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    // Reset lastIndex since we reuse the same RegExp objects across calls
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match, _key, value) => {
      // Don't redact obvious placeholders
      if (PLACEHOLDER_RE.test(value)) {
        return match;
      }
      return match.replace(value, '[REDACTED]');
    });
  }
  return result;
}
