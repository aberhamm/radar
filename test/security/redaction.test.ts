import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../../src/agent/redaction.js';

describe('redactSecrets', () => {
  it('redacts API_KEY=sk-abc123def456', () => {
    const input = 'API_KEY=sk-abc123def456';
    const result = redactSecrets(input);
    expect(result).toBe('API_KEY=[REDACTED]');
  });

  it('redacts password: "hunter2"', () => {
    const input = 'password: "hunter2"';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('hunter2');
  });

  it('does NOT redact const key = items[0] (value too short/generic)', () => {
    // items[0] contains brackets — the pattern won't match since value must be 4+ non-space chars
    // and the key name "key" alone doesn't satisfy the all-caps env var pattern
    const input = 'const key = items[0]';
    const result = redactSecrets(input);
    expect(result).toBe('const key = items[0]');
  });

  it('does NOT redact api_key = "your-api-key-here" (placeholder)', () => {
    const input = 'api_key = "your-api-key-here"';
    const result = redactSecrets(input);
    expect(result).toBe('api_key = "your-api-key-here"');
  });

  it('does NOT redact NEXT_PUBLIC_SITE_URL=https://example.com (not a secret pattern)', () => {
    const input = 'NEXT_PUBLIC_SITE_URL=https://example.com';
    const result = redactSecrets(input);
    expect(result).toBe('NEXT_PUBLIC_SITE_URL=https://example.com');
  });

  it('redacts STRIPE_SECRET_KEY=sk_live_abc123', () => {
    const input = 'STRIPE_SECRET_KEY=sk_live_abc123';
    const result = redactSecrets(input);
    expect(result).toBe('STRIPE_SECRET_KEY=[REDACTED]');
  });

  it('redacts access_token=eyJhbGciOiJSUzI1NiJ9', () => {
    const input = 'access_token=eyJhbGciOiJSUzI1NiJ9';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('eyJhbGciOiJSUzI1NiJ9');
  });

  it('does NOT redact placeholder values with xxx', () => {
    const input = 'API_KEY=xxxxxxxxxxxxxxxx';
    const result = redactSecrets(input);
    expect(result).toBe('API_KEY=xxxxxxxxxxxxxxxx');
  });

  it('keeps the key name intact when redacting', () => {
    const input = 'GITHUB_TOKEN=ghp_realtoken123456';
    const result = redactSecrets(input);
    expect(result).toContain('GITHUB_TOKEN=');
    expect(result).toContain('[REDACTED]');
  });

  it('does NOT redact <placeholder> style values', () => {
    const input = 'client_secret=<your-client-secret>';
    const result = redactSecrets(input);
    expect(result).toBe('client_secret=<your-client-secret>');
  });
});
