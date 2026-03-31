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
});
