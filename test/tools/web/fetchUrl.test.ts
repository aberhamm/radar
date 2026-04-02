import { describe, it, expect } from 'vitest';
import { fetchUrl } from '../../../src/tools/web/fetchUrl.js';

describe('fetchUrl', () => {
  it('rejects non-HTTP URLs', async () => {
    const result = await fetchUrl({ url: 'ftp://example.com' });
    expect(result.content).toContain('Only HTTP(S) URLs supported');
  });

  it('handles invalid URLs gracefully', async () => {
    const result = await fetchUrl({ url: 'not a url' });
    expect(result.content).toContain('Invalid URL');
  });

  it('fetches a real URL and extracts content', async () => {
    const result = await fetchUrl({
      url: 'https://registry.npmjs.org/next/latest',
      maxLength: 5000,
    });
    // npm registry returns JSON
    expect(result.content).toBeTruthy();
    expect(result.url).toBe('https://registry.npmjs.org/next/latest');
  }, 15_000);

  it('rewrites GitHub blob URLs to raw content', async () => {
    const result = await fetchUrl({
      url: 'https://github.com/Sitecore/jss/blob/main/CHANGELOG.md',
      maxLength: 1000,
    });
    // Should get raw markdown, not HTML
    expect(result.content).not.toContain('<html');
    expect(result.content).toBeTruthy();
    // Original URL preserved in response
    expect(result.url).toBe('https://github.com/Sitecore/jss/blob/main/CHANGELOG.md');
  }, 15_000);

  it('rewrites npmjs.com URLs to registry API', async () => {
    const result = await fetchUrl({
      url: 'https://www.npmjs.com/package/next',
      maxLength: 2000,
    });
    // Should get JSON from registry, not a 403
    expect(result.content).not.toContain('Error: HTTP 403');
    expect(result.content).toBeTruthy();
  }, 15_000);

  it('fetches nextjs.org with browser headers', async () => {
    const result = await fetchUrl({
      url: 'https://nextjs.org/docs/app/building-your-application/upgrading',
      maxLength: 2000,
    });
    expect(result.content).not.toContain('Error: HTTP 403');
    expect(result.title).toBeTruthy();
  }, 15_000);
});
