import { describe, it, expect } from 'vitest';
import { getApprovedSources, getApprovedDomains } from '../../../src/tools/web/approvedSources.js';

describe('getApprovedSources', () => {
  it('returns all sources when no platform filter', () => {
    const sources = getApprovedSources();
    // 3 sitecore + 3 optimizely + 11 shared = 17 total
    expect(sources.length).toBe(17);
  });

  it('includes newly added documentation domains', () => {
    const domains = getApprovedDomains();
    expect(domains).toContain('typescriptlang.org');
    expect(domains).toContain('tailwindcss.com');
    expect(domains).toContain('graphql.org');
    expect(domains).toContain('developer.mozilla.org');
    expect(domains).toContain('stackoverflow.com');
  });

  it('filters by sitecore platform', () => {
    const sources = getApprovedSources('sitecore');
    const domains = sources.map((s) => s.domain);
    expect(domains).toContain('doc.sitecore.com');
    expect(domains).toContain('nextjs.org');
    expect(domains).not.toContain('docs.developers.optimizely.com');
  });

  it('filters by optimizely platform', () => {
    const sources = getApprovedSources('optimizely');
    const domains = sources.map((s) => s.domain);
    expect(domains).toContain('docs.developers.optimizely.com');
    expect(domains).toContain('nextjs.org');
    expect(domains).not.toContain('doc.sitecore.com');
  });
});

describe('getApprovedDomains', () => {
  it('returns domain strings', () => {
    const domains = getApprovedDomains();
    expect(domains).toContain('nextjs.org');
    expect(domains.every((d) => typeof d === 'string')).toBe(true);
  });
});
