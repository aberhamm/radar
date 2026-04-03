/**
 * Domain blocklist preflight for fetch_url.
 *
 * Prevents SSRF by blocking requests to internal/private addresses
 * before any network I/O occurs.
 */

const BLOCKED_DOMAINS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  '169.254.169.254',       // AWS EC2 metadata
  'metadata.google.internal', // GCP metadata
]);

const BLOCKED_TLDS = ['.local', '.internal'];

/**
 * Returns an error message if the domain is blocked, or null if safe.
 */
export function isDomainBlocked(url: string): string | null {
  try {
    const { hostname, protocol } = new URL(url);

    // Only allow http/https
    if (protocol !== 'http:' && protocol !== 'https:') {
      return `Blocked protocol: ${protocol}`;
    }

    // Exact match blocklist
    if (BLOCKED_DOMAINS.has(hostname)) {
      return `Blocked domain: ${hostname}`;
    }

    // TLD blocklist
    for (const tld of BLOCKED_TLDS) {
      if (hostname.endsWith(tld)) {
        return `Blocked TLD: ${tld}`;
      }
    }

    // Private IP ranges
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(hostname)) {
      return `Blocked private IP: ${hostname}`;
    }

    return null;
  } catch {
    return 'Invalid URL';
  }
}
