import { describe, it, expect } from 'vitest';
import { isDomainBlocked } from '../../../src/tools/web/domainBlocklist.js';

describe('isDomainBlocked', () => {
  it('blocks localhost', () => {
    expect(isDomainBlocked('http://localhost:3000/api')).toContain('Blocked domain');
  });

  it('blocks 127.0.0.1', () => {
    expect(isDomainBlocked('http://127.0.0.1/admin')).toContain('Blocked domain');
  });

  it('blocks IPv6 localhost', () => {
    // URL constructor parses [::1] as hostname "::1" (brackets stripped)
    expect(isDomainBlocked('http://[::1]/api')).not.toBeNull();
  });

  it('blocks AWS metadata endpoint', () => {
    expect(isDomainBlocked('http://169.254.169.254/latest/meta-data')).toContain('Blocked domain');
  });

  it('blocks GCP metadata endpoint', () => {
    expect(isDomainBlocked('http://metadata.google.internal/v1')).toContain('Blocked');
  });

  it('blocks .local TLD', () => {
    expect(isDomainBlocked('http://myservice.local/api')).toContain('Blocked TLD');
  });

  it('blocks .internal TLD', () => {
    expect(isDomainBlocked('http://api.internal/health')).toContain('Blocked TLD');
  });

  it('blocks private 10.x.x.x range', () => {
    expect(isDomainBlocked('http://10.0.0.1/api')).toContain('Blocked private IP');
  });

  it('blocks private 172.16-31.x.x range', () => {
    expect(isDomainBlocked('http://172.16.0.1/api')).toContain('Blocked private IP');
    expect(isDomainBlocked('http://172.31.255.255/api')).toContain('Blocked private IP');
  });

  it('blocks private 192.168.x.x range', () => {
    expect(isDomainBlocked('http://192.168.1.1/admin')).toContain('Blocked private IP');
  });

  it('allows public domains', () => {
    expect(isDomainBlocked('https://nextjs.org/docs')).toBeNull();
    expect(isDomainBlocked('https://doc.sitecore.com/xmc')).toBeNull();
    expect(isDomainBlocked('https://developer.mozilla.org/en-US')).toBeNull();
  });

  it('blocks non-http protocols', () => {
    expect(isDomainBlocked('ftp://files.example.com/data')).toContain('Blocked protocol');
    expect(isDomainBlocked('file:///etc/passwd')).toContain('Blocked protocol');
  });

  it('returns error for invalid URLs', () => {
    expect(isDomainBlocked('not-a-url')).toBe('Invalid URL');
  });

  it('allows 172.x outside 16-31 range', () => {
    expect(isDomainBlocked('http://172.15.0.1/api')).toBeNull();
    expect(isDomainBlocked('http://172.32.0.1/api')).toBeNull();
  });
});
