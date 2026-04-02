import { describe, it, expect } from 'vitest';
import {
  snippetMatchesContent,
  extractCodeWindow,
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
