import type { FetchUrlInput, FetchUrlOutput } from '../../types/tools.js';

const DEFAULT_MAX_LENGTH = 15_000;
const TIMEOUT_MS = 10_000;

/**
 * Fetch and extract text content from a documentation URL.
 * Strips HTML tags and returns plain text, truncated to maxLength.
 *
 * Implementation note: v1 uses a simple HTML-to-text approach.
 * For better extraction (handling navigation, footers, ads), a
 * readability library like @mozilla/readability could be added later.
 */
export async function fetchUrl(input: FetchUrlInput): Promise<FetchUrlOutput> {
  const { url, maxLength = DEFAULT_MAX_LENGTH } = input;

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, title: '', content: 'Error: Invalid URL', truncated: false };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { url, title: '', content: 'Error: Only HTTP(S) URLs supported', truncated: false };
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'repo-audit-delivery-agent/1.0 (documentation fetcher)',
        Accept: 'text/html, text/plain, application/json',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });

    if (!response.ok) {
      return {
        url,
        title: '',
        content: `Error: HTTP ${response.status} ${response.statusText}`,
        truncated: false,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();

    // JSON content — return formatted
    if (contentType.includes('application/json')) {
      const content = body.slice(0, maxLength);
      return {
        url,
        title: extractJsonTitle(body),
        content,
        truncated: body.length > maxLength,
      };
    }

    // Plain text — return as-is
    if (contentType.includes('text/plain')) {
      const content = body.slice(0, maxLength);
      return { url, title: '', content, truncated: body.length > maxLength };
    }

    // HTML — extract text
    const title = extractHtmlTitle(body);
    const text = htmlToText(body);
    const truncated = text.length > maxLength;
    const content = truncated ? text.slice(0, maxLength) + '\n\n[Content truncated]' : text;

    return { url, title, content, truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { url, title: '', content: `Error: ${message}`, truncated: false };
  }
}

/**
 * Extract title from HTML.
 */
function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : '';
}

/**
 * Try to extract a title from JSON (common patterns).
 */
function extractJsonTitle(json: string): string {
  try {
    const parsed = JSON.parse(json);
    return parsed.name ?? parsed.title ?? '';
  } catch {
    return '';
  }
}

/**
 * Convert HTML to readable plain text.
 * Strips tags, scripts, styles, and normalizes whitespace.
 */
function htmlToText(html: string): string {
  let text = html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');

  // Convert common elements to text equivalents
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<li[^>]*>/gi, '- ');
  text = text.replace(/<\/li>/gi, '\n');

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeHtmlEntities(text);

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

/**
 * Decode common HTML entities.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}
