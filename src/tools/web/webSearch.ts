import type { WebSearchInput, WebSearchOutput, SearchResult } from '../../types/tools.js';

/**
 * Search the web for documentation, changelogs, migration guides, and known issues.
 *
 * Implementation note: This tool is designed to be called by the agent during
 * investigation. In v1, it uses a simple fetch-based approach against a search API.
 * The provider can be swapped (e.g. to Brave Search, Google Custom Search, or Bing)
 * via environment configuration.
 *
 * If no search API is configured, returns empty results — the agent will rely on
 * its reference knowledge base and fetch_url for direct documentation access.
 */
export async function webSearch(input: WebSearchInput): Promise<WebSearchOutput> {
  const { query, siteFilter, maxResults = 5 } = input;

  const apiKey = process.env.SEARCH_API_KEY;
  const searchEngine = process.env.SEARCH_ENGINE ?? 'none';

  if (!apiKey || searchEngine === 'none') {
    // No search API configured — return empty.
    // The agent can still use fetch_url to access known documentation URLs.
    return { results: [] };
  }

  try {
    const results = await performSearch(searchEngine, apiKey, query, siteFilter, maxResults);
    return { results };
  } catch {
    return { results: [] };
  }
}

async function performSearch(
  engine: string,
  apiKey: string,
  query: string,
  siteFilter: string | undefined,
  maxResults: number,
): Promise<SearchResult[]> {
  const fullQuery = siteFilter ? `site:${siteFilter} ${query}` : query;

  if (engine === 'brave') {
    return searchBrave(apiKey, fullQuery, maxResults);
  }

  // Add more engines here as needed (google-cse, bing, etc.)
  return [];
}

async function searchBrave(
  apiKey: string,
  query: string,
  maxResults: number,
): Promise<SearchResult[]> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) return [];

  const data = (await response.json()) as {
    web?: { results?: Array<{ title: string; url: string; description: string }> };
  };

  return (data.web?.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }));
}
