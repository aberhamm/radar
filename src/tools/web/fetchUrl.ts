import type { FetchUrlInput, FetchUrlOutput } from '../../types/tools.js';
import { fetchCache } from './fetchCache.js';
import { isDomainBlocked } from './domainBlocklist.js';

const DEFAULT_MAX_LENGTH = 15_000;
const TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10MB — abort to prevent OOM
const MAX_REDIRECTS = 10;

/**
 * Browser-like request headers.
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
  // GitHub blob URLs → raw.githubusercontent.com
  const ghBlobMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (ghBlobMatch) {
    return {
      url: `https://raw.githubusercontent.com/${ghBlobMatch[1]}/${ghBlobMatch[2]}/${ghBlobMatch[3]}`,
      headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
    };
  }

  // npmjs.com package pages → registry API
  const npmMatch = url.match(/^https?:\/\/(?:www\.)?npmjs\.com\/package\/([^/]+)\/?$/);
  if (npmMatch) {
    return {
      url: `https://registry.npmjs.org/${npmMatch[1]}/latest`,
      headers: { 'Accept': 'application/json' },
    };
  }

  return { url, headers: BROWSER_HEADERS };
}

/**
 * Follow redirects manually with safety checks.
 * Cross-host redirects return the redirect URL instead of following (SSRF protection).
 */
async function safeFetch(
  url: string,
  headers: Record<string, string>,
): Promise<{ response: Response; redirectedTo?: string }> {
  let currentUrl = url;
  const originalHost = new URL(url).host;

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'manual',
    });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response };
    }

    const location = response.headers.get('location');
    if (!location) return { response };

    const nextUrl = new URL(location, currentUrl);

    // Cross-host redirect: stop and report
    if (nextUrl.host !== originalHost) {
      return { response, redirectedTo: nextUrl.href };
    }

    currentUrl = nextUrl.href;
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
}

// --- Turndown (lazy-loaded) ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let turndownInstance: any = null;

async function htmlToMarkdown(html: string): Promise<string> {
  try {
    if (!turndownInstance) {
      const { default: TurndownService } = await import('turndown');
      turndownInstance = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
      });
      turndownInstance.remove(['script', 'style', 'nav', 'footer', 'header', 'aside']);
    }
    return turndownInstance.turndown(html);
  } catch {
    // Fallback to regex-based stripping if Turndown fails
    return htmlToText(html);
  }
}

/**
 * Fetch and extract content from a documentation URL.
 *
 * Features: LRU caching, HTML→Markdown via Turndown, redirect safety,
 * domain blocklist, URL rewriting for GitHub/npm.
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

  // Domain blocklist check (SSRF protection)
  const blocked = isDomainBlocked(originalUrl);
  if (blocked) {
    return { url: originalUrl, title: '', content: `Error: ${blocked}`, truncated: false };
  }

  // Cache check
  const cached = fetchCache.get(originalUrl);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  const rewritten = rewriteUrl(originalUrl);

  try {
    const { response, redirectedTo } = await safeFetch(rewritten.url, rewritten.headers);

    // Cross-host redirect — return the redirect URL without following
    if (redirectedTo) {
      const result: FetchUrlOutput = {
        url: originalUrl,
        title: '',
        content: `Redirected to different host: ${redirectedTo}. Fetch that URL directly if needed.`,
        truncated: false,
      };
      return result;
    }

    // Check Content-Length before reading body
    const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10);
    if (contentLength > MAX_RESPONSE_BYTES) {
      return {
        url: originalUrl,
        title: '',
        content: `Error: Response too large (${Math.round(contentLength / 1024 / 1024)}MB, limit ${MAX_RESPONSE_BYTES / 1024 / 1024}MB). Aborted to prevent memory issues.`,
        truncated: true,
      };
    }

    if (!response.ok) {
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

    let result: FetchUrlOutput;

    // JSON content
    if (contentType.includes('application/json')) {
      const content = body.slice(0, maxLength);
      result = {
        url: originalUrl,
        title: extractJsonTitle(body),
        content,
        truncated: body.length > maxLength,
      };
    }
    // Plain text or markdown
    else if (contentType.includes('text/plain') || rewritten.url.includes('raw.githubusercontent.com')) {
      const content = body.slice(0, maxLength);
      const truncated = body.length > maxLength;
      result = {
        url: originalUrl,
        title: '',
        content: truncated ? content + '\n\n[Content truncated]' : content,
        truncated,
      };
    }
    // HTML → Markdown via Turndown
    else {
      const title = extractHtmlTitle(body);
      const markdown = await htmlToMarkdown(body);
      const truncated = markdown.length > maxLength;
      const content = truncated ? markdown.slice(0, maxLength) + '\n\n[Content truncated]' : markdown;
      result = { url: originalUrl, title, content, truncated };
    }

    // Store in cache
    fetchCache.set(originalUrl, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { url: originalUrl, title: '', content: `Error: ${message}`, truncated: false };
  }
}

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : '';
}

function extractJsonTitle(json: string): string {
  try {
    const parsed = JSON.parse(json);
    return parsed.name ?? parsed.title ?? '';
  } catch {
    return '';
  }
}

/**
 * Fallback HTML→text conversion (regex-based).
 * Used when Turndown is not available.
 */
function htmlToText(html: string): string {
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');
  text = text.replace(/<li[^>]*>/gi, '- ');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = decodeHtmlEntities(text);
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  return text;
}

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
