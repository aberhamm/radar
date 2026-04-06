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

  // --- Expanded patterns ---

  it('redacts AWS access key IDs (AKIA...)', () => {
    const input = 'aws_key = AKIAIOSFODNN7EXAMPLE';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts ASIA temporary credentials', () => {
    const input = 'key: ASIAJEXAMPLEXEG2JICEA';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('ASIAJEXAMPLEXEG2JICEA');
  });

  it('redacts MongoDB connection strings', () => {
    const input = 'MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/db';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('user:pass');
  });

  it('redacts PostgreSQL connection strings', () => {
    const input = 'DATABASE_URL=postgres://admin:secret@db.host:5432/mydb';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('admin:secret');
  });

  it('redacts Redis connection strings', () => {
    const input = 'REDIS_URL=redis://default:mypassword@redis.example.com:6379';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('mypassword');
  });

  it('redacts JDBC connection strings', () => {
    const input = 'jdbc:mysql://user:password@localhost:3306/mydb';
    const result = redactSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('user:password');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
    const result = redactSecrets(input);
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('redacts PEM private keys', () => {
    const input = '-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBALRiMLAH\n-----END RSA PRIVATE KEY-----';
    const result = redactSecrets(input);
    expect(result).toBe('[REDACTED]');
  });

  it('redacts OPENSSH private keys', () => {
    const input = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----';
    const result = redactSecrets(input);
    expect(result).toBe('[REDACTED]');
  });

  it('does NOT redact short strings that happen to start with AKIA', () => {
    // AKIA + less than 12 chars should not match
    const input = 'AKIA1234';
    const result = redactSecrets(input);
    expect(result).toBe('AKIA1234');
  });
});
