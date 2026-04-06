/**
 * Secret redaction — strips sensitive values from tool output before LLM context.
 *
 * This is defense-in-depth for known repos. Not a security boundary for
 * untrusted production use — regex-based redaction can be bypassed.
 * Real protection requires output validation at the LLM layer.
 */

/**
 * Key=value patterns: the value (group 2) gets redacted, key name stays.
 * Placeholder check applies to the value portion.
 */
const KEY_VALUE_PATTERNS = [
  // API_KEY=sk-abc123, secret="abc", password: "xyz"
  /\b(api[_-]?key|secret[_-]?key?|access[_-]?token|auth[_-]?token|password|passwd|private[_-]?key|client[_-]?secret)\s*[=:]\s*["']?([^\s"',\n]{4,})["']?/gi,
  // STRIPE_SECRET_KEY=sk_live_xxx (ALL_CAPS env vars with secret-related words)
  /\b([A-Z][A-Z0-9_]*(?:SECRET|KEY|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)\s*=\s*["']?([^\s"',\n]{4,})["']?/g,
  // Bearer tokens: keep "Bearer " prefix, redact the token value
  /([Bb]earer\s+)([A-Za-z0-9\-_\.]{20,})/g,
];

/**
 * Whole-match patterns: the entire match gets replaced with [REDACTED].
 * No key/value split — the whole thing is sensitive.
 */
const WHOLE_MATCH_PATTERNS = [
  // AWS access key IDs (always start with AKIA, ASIA, AROA, or AIDA)
  /\b(A(?:KIA|SIA|ROA|IDA)[A-Z0-9]{12,})\b/g,
  // Connection strings: jdbc://, mongodb://, postgres://, mysql://, redis://, amqp://
  /((?:jdbc|mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|rediss|amqp|amqps):\/\/[^\s"',\n]{4,})/gi,
  // PEM private keys (BEGIN RSA/EC/DSA/OPENSSH PRIVATE KEY)
  /(-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----)/g,
];

/** Values that look like placeholders — don't redact these. */
const PLACEHOLDER_RE = /your[_-]?(?:api[_-]?)?key|example|placeholder|xxx+|<[^>]+>|\bhere\b/i;

/**
 * Redact secret values from a string.
 * Key-value patterns keep the key name for context, replacing only the value.
 * Whole-match patterns replace the entire match with [REDACTED].
 */
export function redactSecrets(text: string): string {
  let result = text;

  // Key-value patterns: redact value portion, keep key
  for (const pattern of KEY_VALUE_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match, _key, value) => {
      if (PLACEHOLDER_RE.test(value)) return match;
      return match.replace(value, '[REDACTED]');
    });
  }

  // Whole-match patterns: replace entire match
  for (const pattern of WHOLE_MATCH_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, '[REDACTED]');
  }

  return result;
}
