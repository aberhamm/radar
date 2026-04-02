import type { FetchUrlInput, FetchUrlOutput } from '../../types/tools.js';

const DEFAULT_MAX_LENGTH = 15_000;
const TIMEOUT_MS = 10_000;

/**
 * Browser-like request headers.
 *
 * Most documentation sites check User-Agent + standard browser headers.
 * Node.js fetch has a distinct TLS fingerprint that some sites (Cloudflare)
 * can detect, but proper headers handle ~90% of cases. For the remaining
 * sites, we rewrite URLs to API endpoints that don't need browser TLS
 * (e.g. raw.githubusercontent.com, registry.npmjs.org).
 */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
};

/**
 * Rewrite known URLs to their API/raw equivalents that bypass
 * Cloudflare/bot detection and return cleaner content.
 */
function rewriteUrl(url: string): { url: string; headers: Record<string, string> } {
  const parsed = new URL(url);

  // GitHub blob URLs → raw.githubusercontent.com (pure markdown, no HTML parsing needed)
  // e.g. github.com/Sitecore/jss/blob/main/CHANGELOG.md → raw.githubusercontent.com/Sitecore/jss/main/CHANGELOG.md
  const ghBlobMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (ghBlobMatch) {
    return {
      url: `https://raw.githubusercontent.com/${ghBlobMatch[1]}/${ghBlobMatch[2]}/${ghBlobMatch[3]}`,
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
    };
  }

  // npmjs.com package pages → registry API (JSON, no Cloudflare)
  // e.g. npmjs.com/package/next → registry.npmjs.org/next/latest
  const npmMatch = url.match(/^https?:\/\/(?:www\.)?npmjs\.com\/package\/([^/]+)\/?$/);
  if (npmMatch) {
    return {
      url: `https://registry.npmjs.org/${npmMatch[1]}/latest`,
      headers: { 'Accept': 'application/json' },
    };
  }

  // Default: use full browser headers
  return { url, headers: BROWSER_HEADERS };
}

/**
 * Fetch and extract text content from a documentation URL.
 * Strips HTML tags and returns plain text, truncated to maxLength.
 *
 * Uses browser-like headers to avoid bot detection on documentation sites.
 * Rewrites known URLs (GitHub blob, npmjs.com) to API endpoints that
 * return cleaner content and bypass Cloudflare TLS fingerprinting.
 */
export async function fetchUrl(input: FetchUrlInput): Promise<FetchUrlOutput> {
  const { url: originalUrl, maxLength = DEFAULT_MAX_LENGTH } = input;

  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(originalUrl);
  } catch {
    return { url: originalUrl, title: '', content: 'Error: Invalid URL', truncated: false };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { url: originalUrl, title: '', content: 'Error: Only HTTP(S) URLs supported', truncated: false };
  }

  const rewritten = rewriteUrl(originalUrl);

  try {
    const response = await fetch(rewritten.url, {
      headers: rewritten.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });

    if (!response.ok) {
      // If we got a 403 with browser headers, note it may be TLS fingerprinting
      const hint = response.status === 403
        ? ' (site may use TLS fingerprinting to block non-browser requests)'
        : '';
      return {
        url: originalUrl,
        title: '',
        content: `Error: HTTP ${response.status} ${response.statusText}${hint}`,
        truncated: false,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();

    // JSON content — return formatted
    if (contentType.includes('application/json')) {
      const content = body.slice(0, maxLength);
      return {
        url: originalUrl,
        title: extractJsonTitle(body),
        content,
        truncated: body.length > maxLength,
      };
    }

    // Plain text or markdown — return as-is
    if (contentType.includes('text/plain') || rewritten.url.includes('raw.githubusercontent.com')) {
      const content = body.slice(0, maxLength);
      const truncated = body.length > maxLength;
      return {
        url: originalUrl,
        title: '',
        content: truncated ? content + '\n\n[Content truncated]' : content,
        truncated,
      };
    }

    // HTML — extract text
    const title = extractHtmlTitle(body);
    const text = htmlToText(body);
    const truncated = text.length > maxLength;
    const content = truncated ? text.slice(0, maxLength) + '\n\n[Content truncated]' : text;

    return { url: originalUrl, title, content, truncated };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { url: originalUrl, title: '', content: `Error: ${message}`, truncated: false };
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
