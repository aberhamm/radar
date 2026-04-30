import { describe, it, expect } from 'vitest';
import {
  snippetMatchesContent,
  extractCodeWindow,
  extractKeyIdentifiers,
  findSnippetLine,
  verifyAndCorrectEvidence,
  verifyFindingEvidence,
} from '../../../src/tools/analysis/verifyEvidence.js';
import type { Evidence, Finding } from '../../../src/types/findings.js';
import path from 'node:path';

const FIXTURE_ROOT = path.resolve('test/fixtures/sitecore-minimal');

describe('snippetMatchesContent', () => {
  it('returns true for exact match', () => {
    const snippet = 'const x = 1;';
    const content = 'const x = 1;';
    expect(snippetMatchesContent(snippet, content)).toBe(true);
  });

  it('returns true for whitespace-normalized match', () => {
    const snippet = '  const x  =  1;';
    const content = 'const x = 1;\nconst y = 2;';
    expect(snippetMatchesContent(snippet, content)).toBe(true);
  });

  it('returns true when snippet is a substring of content', () => {
    const snippet = 'export const dynamic';
    const content = "import { notFound } from 'next/navigation';\n\nexport const dynamic = 'force-dynamic';";
    expect(snippetMatchesContent(snippet, content)).toBe(true);
  });

  it('returns false for completely different code', () => {
    const snippet = "const API_KEY = '[REDACTED]';";
    const content = "const apiKey = process.env.SITECORE_API_KEY;";
    expect(snippetMatchesContent(snippet, content)).toBe(false);
  });

  it('returns true for 60%+ line match', () => {
    const snippet = 'import React from "react";\nconst App = () => {};\nexport default App;';
    const content = 'import React from "react";\nimport { useState } from "react";\nconst App = () => {};\nexport default App;';
    expect(snippetMatchesContent(snippet, content)).toBe(true);
  });

  it('returns false for empty snippet', () => {
    expect(snippetMatchesContent('', 'some content')).toBe(false);
  });

  it('rejects snippet with hallucinated env var even when boilerplate lines match', () => {
    // The actual middleware.ts uses SITECORE_API_KEY, not SITECORE_EDITING_SECRET.
    // Boilerplate lines (imports, function sig) would pass the 60% threshold
    // but the identifier guard should catch the hallucinated env var.
    const snippet = [
      "import { NextResponse } from 'next/server';",
      "import type { NextRequest } from 'next/server';",
      'export function middleware(request: NextRequest) {',
      '  const secret = process.env.SITECORE_EDITING_SECRET;',
    ].join('\n');

    const actual = [
      "import { NextResponse } from 'next/server';",
      "import type { NextRequest } from 'next/server';",
      '',
      'export function middleware(request: NextRequest) {',
      '  const apiKey = process.env.SITECORE_API_KEY;',
      '  if (!apiKey) {',
      "    return NextResponse.redirect(new URL('/error', request.url));",
      '  }',
      '  return NextResponse.next();',
      '}',
    ].join('\n');

    expect(snippetMatchesContent(snippet, actual)).toBe(false);
  });

  it('accepts snippet where all identifiers exist in the actual file', () => {
    const snippet = [
      "import { NextResponse } from 'next/server';",
      'export function middleware(request: NextRequest) {',
      '  const apiKey = process.env.SITECORE_API_KEY;',
    ].join('\n');

    const actual = [
      "import { NextResponse } from 'next/server';",
      "import type { NextRequest } from 'next/server';",
      '',
      'export function middleware(request: NextRequest) {',
      '  const apiKey = process.env.SITECORE_API_KEY;',
    ].join('\n');

    expect(snippetMatchesContent(snippet, actual)).toBe(true);
  });
});

describe('extractKeyIdentifiers', () => {
  it('extracts UPPER_SNAKE_CASE identifiers', () => {
    const ids = extractKeyIdentifiers('process.env.SITECORE_API_KEY');
    expect(ids.has('SITECORE_API_KEY')).toBe(true);
  });

  it('ignores short identifiers (< 3 chars)', () => {
    const ids = extractKeyIdentifiers('const AB = 1; const ABC_DEF = 2;');
    expect(ids.has('AB')).toBe(false);
    expect(ids.has('ABC_DEF')).toBe(true);
  });

  it('returns empty set for no matches', () => {
    const ids = extractKeyIdentifiers('const x = 1;');
    expect(ids.size).toBe(0);
  });
});

describe('findSnippetLine', () => {
  const content = [
    "import { NextResponse } from 'next/server';",
    '',
    'export function middleware(request) {',
    '  const apiKey = process.env.SITECORE_API_KEY;',
    '  return NextResponse.next();',
    '}',
  ].join('\n');

  it('finds single-line snippet at correct line', () => {
    expect(findSnippetLine('const apiKey = process.env.SITECORE_API_KEY;', content)).toBe(4);
  });

  it('finds multi-line snippet at correct start line', () => {
    const snippet = 'export function middleware(request) {\n  const apiKey = process.env.SITECORE_API_KEY;';
    expect(findSnippetLine(snippet, content)).toBe(3);
  });

  it('returns undefined when snippet not found', () => {
    expect(findSnippetLine('const x = nonexistent();', content)).toBeUndefined();
  });
});

describe('extractCodeWindow', () => {
  const content = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10';

  it('returns lines around lineNumber', () => {
    const window = extractCodeWindow(content, 5, 2);
    expect(window).toBe('line3\nline4\nline5\nline6\nline7');
  });

  it('returns first lines when no lineNumber', () => {
    const window = extractCodeWindow(content, undefined, 3);
    expect(window).toContain('line1');
    expect(window).toContain('line7');
  });

  it('handles lineNumber at start of file', () => {
    const window = extractCodeWindow(content, 1, 2);
    expect(window).toContain('line1');
    expect(window).toContain('line2');
    expect(window).toContain('line3');
  });

  it('handles lineNumber at end of file', () => {
    const window = extractCodeWindow(content, 10, 2);
    expect(window).toContain('line10');
    expect(window).toContain('line9');
  });
});

describe('verifyAndCorrectEvidence', () => {
  it('returns verified when snippet matches file content', async () => {
    const ev: Evidence = {
      filePath: 'src/middleware.ts',
      lineNumber: 5,
      snippet: 'const apiKey = process.env.SITECORE_API_KEY;',
      description: 'Reads API key from env',
    };
    const result = await verifyAndCorrectEvidence(FIXTURE_ROOT, ev);
    expect(result.status).toBe('verified');
    expect(result.evidence.verified).toBe(true);
    expect(result.evidence.verificationStatus).toBe('verified');
  });

  it('returns corrected when snippet does not match', async () => {
    const ev: Evidence = {
      filePath: 'src/middleware.ts',
      lineNumber: 4,
      snippet: "const API_KEY = '[REDACTED]';",
      description: 'Hardcoded key',
    };
    const result = await verifyAndCorrectEvidence(FIXTURE_ROOT, ev);
    expect(result.status).toBe('corrected');
    expect(result.evidence.originalSnippet).toBe("const API_KEY = '[REDACTED]';");
    expect(result.evidence.snippet).toContain('process.env.SITECORE_API_KEY');
    expect(result.evidence.verificationStatus).toBe('corrected');
  });

  it('auto-corrects line number when snippet is found at different location', async () => {
    const ev: Evidence = {
      filePath: 'src/middleware.ts',
      lineNumber: 1, // wrong — actual line is 5
      snippet: 'const apiKey = process.env.SITECORE_API_KEY;',
      description: 'Reads API key from env',
    };
    const result = await verifyAndCorrectEvidence(FIXTURE_ROOT, ev);
    expect(result.status).toBe('verified');
    expect(result.evidence.lineNumber).toBe(5);
    expect(result.note).toContain('line corrected from 1');
  });

  it('rejects snippet with hallucinated env var name', async () => {
    // Agent claims SITECORE_EDITING_SECRET but file has SITECORE_API_KEY
    const ev: Evidence = {
      filePath: 'src/middleware.ts',
      lineNumber: 5,
      snippet: 'const secret = process.env.SITECORE_EDITING_SECRET;',
      description: 'Validates editing secret',
    };
    const result = await verifyAndCorrectEvidence(FIXTURE_ROOT, ev);
    // Should be corrected (not verified), because the env var name is wrong
    expect(result.status).toBe('corrected');
    expect(result.evidence.verificationStatus).toBe('corrected');
    expect(result.evidence.snippet).toContain('SITECORE_API_KEY');
  });

  it('corrects snippet to right location using identifier search instead of wrong lineNumber', async () => {
    // Simulates the Shopify API bug: agent hallucinates snippet at line 1 but the
    // real constant is deeper in the file. The correction should search for key
    // identifiers from the hallucinated snippet to find the right location.
    const ev: Evidence = {
      filePath: 'src/middleware.ts',
      lineNumber: 1, // wrong line — actual use of SITECORE_API_KEY is at line 5
      snippet: "const key = process.env.SITECORE_API_KEY || 'fallback';", // hallucinated variant
      description: 'Reads from env',
    };
    const result = await verifyAndCorrectEvidence(FIXTURE_ROOT, ev);
    expect(result.status).toBe('corrected');
    // The corrected snippet should contain the real code around SITECORE_API_KEY (line 5),
    // NOT from line 1 (import statement).
    expect(result.evidence.snippet).toContain('SITECORE_API_KEY');
    expect(result.evidence.lineNumber).toBe(5);
  });

  it('returns rejected when file does not exist', async () => {
    const ev: Evidence = {
      filePath: 'src/nonexistent.ts',
      lineNumber: 1,
      snippet: 'anything',
      description: 'Ghost file',
    };
    const result = await verifyAndCorrectEvidence(FIXTURE_ROOT, ev);
    expect(result.status).toBe('rejected');
    expect(result.note).toContain('not found');
  });
});

describe('verifyFindingEvidence', () => {
  it('marks all evidence verified when snippets match', async () => {
    const finding: Finding = {
      id: 'TEST-001',
      category: 'security',
      severity: 'high',
      title: 'Test',
      description: 'Test finding',
      evidence: [{
        filePath: 'src/middleware.ts',
        lineNumber: 5,
        snippet: 'const apiKey = process.env.SITECORE_API_KEY;',
        description: 'Reads from env',
      }],
      tags: [],
    };
    const { finding: verified, allUnverifiable } = await verifyFindingEvidence(FIXTURE_ROOT, finding);
    expect(allUnverifiable).toBe(false);
    expect(verified.evidence[0].verificationStatus).toBe('verified');
  });

  it('returns allUnverifiable when all files missing', async () => {
    const finding: Finding = {
      id: 'TEST-002',
      category: 'security',
      severity: 'critical',
      title: 'Ghost finding',
      description: 'All evidence is fake',
      evidence: [{
        filePath: 'src/ghost1.ts',
        lineNumber: 1,
        snippet: 'fake code',
        description: 'Does not exist',
      }, {
        filePath: 'src/ghost2.ts',
        lineNumber: 1,
        snippet: 'more fake code',
        description: 'Also does not exist',
      }],
      tags: [],
    };
    const { allUnverifiable } = await verifyFindingEvidence(FIXTURE_ROOT, finding);
    expect(allUnverifiable).toBe(true);
  });

  it('returns allUnverifiable false when finding has no evidence', async () => {
    const finding: Finding = {
      id: 'TEST-003',
      category: 'stack',
      severity: 'info',
      title: 'No evidence finding',
      description: 'Has no evidence items',
      evidence: [],
      tags: [],
    };
    const { allUnverifiable } = await verifyFindingEvidence(FIXTURE_ROOT, finding);
    expect(allUnverifiable).toBe(false);
  });

  it('preserves corrected status when post-loop re-verifies an already-corrected snippet', async () => {
    // Record-time sets originalSnippet + verificationStatus='corrected'.
    // Post-loop pass should NOT overwrite to 'verified' just because the
    // corrected snippet matches the file (it was extracted from there).
    const finding: Finding = {
      id: 'TEST-CORRECTED-PRESERVE',
      category: 'configuration',
      severity: 'high',
      title: 'Previously corrected',
      description: 'Snippet was auto-corrected',
      evidence: [{
        filePath: 'src/middleware.ts',
        lineNumber: 5,
        snippet: 'const apiKey = process.env.SITECORE_API_KEY;',
        originalSnippet: 'const secret = process.env.SITECORE_EDITING_SECRET;',
        description: 'Was corrected',
      }],
      tags: [],
    };
    const { finding: verified } = await verifyFindingEvidence(FIXTURE_ROOT, finding);
    expect(verified.evidence[0].verificationStatus).toBe('corrected');
  });

  it('auto-corrects mismatched snippets and adds verificationNotes', async () => {
    const finding: Finding = {
      id: 'TEST-004',
      category: 'security',
      severity: 'high',
      title: 'Mismatched snippet',
      description: 'Snippet is wrong',
      evidence: [{
        filePath: 'src/middleware.ts',
        lineNumber: 4,
        snippet: "const HARDCODED = 'secret';",
        description: 'Wrong snippet',
      }],
      tags: [],
    };
    const { finding: verified } = await verifyFindingEvidence(FIXTURE_ROOT, finding);
    expect(verified.evidence[0].verificationStatus).toBe('corrected');
    expect(verified.evidence[0].originalSnippet).toBe("const HARDCODED = 'secret';");
    expect(verified.verificationNotes).toBeDefined();
    expect(verified.verificationNotes!.length).toBeGreaterThan(0);
  });
});
