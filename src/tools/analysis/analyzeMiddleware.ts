import fs from 'node:fs';
import path from 'node:path';
import type { AnalyzeMiddlewareInput, AnalyzeMiddlewareOutput } from '../../types/tools.js';

const MIDDLEWARE_FILES = ['middleware.ts', 'middleware.js', 'src/middleware.ts', 'src/middleware.js'];

const PURPOSE_PATTERNS: Array<{ pattern: RegExp; purpose: string }> = [
  { pattern: /auth|session|token|login|jwt/i, purpose: 'auth' },
  { pattern: /redirect/i, purpose: 'redirects' },
  { pattern: /i18n|locale|language|intl/i, purpose: 'i18n' },
  { pattern: /multisite|site-?resolver|SiteResolver/i, purpose: 'multisite' },
  { pattern: /header|csp|cors|security/i, purpose: 'headers' },
  { pattern: /rewrite/i, purpose: 'rewrites' },
  { pattern: /geolocation|geo/i, purpose: 'geolocation' },
  { pattern: /rate.?limit/i, purpose: 'rate-limiting' },
];

/**
 * Parse middleware.ts/js and identify its purpose, matchers, and imports.
 * Deterministic — reads and analyzes file content, no LLM.
 */
export async function analyzeMiddleware(
  repoRoot: string,
  input: AnalyzeMiddlewareInput,
): Promise<AnalyzeMiddlewareOutput> {
  const basePath = path.resolve(repoRoot, input.repoPath);

  // Find middleware file
  let middlewarePath: string | undefined;
  for (const candidate of MIDDLEWARE_FILES) {
    const full = path.join(basePath, candidate);
    if (fs.existsSync(full)) {
      middlewarePath = full;
      break;
    }
  }

  if (!middlewarePath) {
    return { exists: false, detectedPurposes: [], imports: [] };
  }

  const content = fs.readFileSync(middlewarePath, 'utf-8');
  const relativePath = path.relative(repoRoot, middlewarePath).replace(/\\/g, '/');

  // Extract matchers from config export
  const matchers: string[] = [];
  const matcherRegex = /matcher\s*:\s*(\[[\s\S]*?\]|['"][^'"]+['"])/g;
  let match: RegExpExecArray | null;
  while ((match = matcherRegex.exec(content)) !== null) {
    const raw = match[1];
    // Array of strings
    const stringsInArray = raw.matchAll(/['"]([^'"]+)['"]/g);
    for (const s of stringsInArray) {
      matchers.push(s[1]);
    }
  }

  // Detect purposes
  const detectedPurposes: string[] = [];
  for (const { pattern, purpose } of PURPOSE_PATTERNS) {
    if (pattern.test(content)) {
      detectedPurposes.push(purpose);
    }
  }

  // Extract imports
  const imports: string[] = [];
  const importRegex = /(?:import\s+.*?\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1] || match[2]);
  }

  return {
    exists: true,
    path: relativePath,
    matchers: matchers.length > 0 ? matchers : undefined,
    detectedPurposes,
    imports,
  };
}
