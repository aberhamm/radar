import { describe, it, expect } from 'vitest';
import { webSearch } from '../../../src/tools/web/webSearch.js';

describe('webSearch', () => {
  it('returns empty results when no search API configured', async () => {
    // In test environment, SEARCH_API_KEY is not set
    const result = await webSearch({ query: 'Sitecore JSS migration guide' });
    expect(result.results).toEqual([]);
  });

  it('respects maxResults parameter without error', async () => {
    const result = await webSearch({ query: 'test', maxResults: 3 });
    expect(result.results.length).toBeLessThanOrEqual(3);
  });
});
