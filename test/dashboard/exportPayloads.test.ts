import { describe, it, expect } from 'vitest';
import {
  buildAiFixPrompt,
  buildBulkAiFixPrompt,
  buildJiraPayload,
  buildBulkJiraPayload,
  buildAdoPayload,
  buildBulkAdoPayload,
} from '../../dashboard/src/lib/exportPayloads';
import type { Finding } from '../../dashboard/src/lib/runTransform';

const makeFinding = (overrides?: Partial<Finding>): Finding => ({
  id: 'f-001',
  severity: 'high' as const,
  category: 'security',
  title: 'Hardcoded API key',
  evidenceFiles: ['src/config.ts'],
  evidence: [{
    filePath: 'src/config.ts',
    lineNumber: 42,
    snippet: 'const API_KEY = "sk-1234"',
    description: 'API key is hardcoded',
  }],
  note: 'The API key is hardcoded in the source file.',
  tags: ['secrets', 'api'],
  ...overrides,
});

describe('exportPayloads', () => {
  describe('buildAiFixPrompt', () => {
    it('includes title, severity, category, and instructions', () => {
      const result = buildAiFixPrompt(makeFinding());
      expect(result).toContain('## Fix: Hardcoded API key');
      expect(result).toContain('**Severity:** high');
      expect(result).toContain('**Category:** security');
      expect(result).toContain('### Instructions');
      expect(result).toContain('src/config.ts:42');
      expect(result).toContain('sk-1234');
    });

    it('uses evidenceFiles when no evidence snippets', () => {
      const f = makeFinding({ evidence: [], evidenceFiles: ['a.ts', 'b.ts'] });
      const result = buildAiFixPrompt(f);
      expect(result).toContain('`a.ts`');
      expect(result).toContain('`b.ts`');
    });

    it('includes note as problem description', () => {
      const result = buildAiFixPrompt(makeFinding());
      expect(result).toContain('### Problem');
      expect(result).toContain('hardcoded in the source file');
    });
  });

  describe('buildBulkAiFixPrompt', () => {
    it('combines multiple findings into one prompt', () => {
      const findings = [
        makeFinding({ id: 'f-001', title: 'Issue A' }),
        makeFinding({ id: 'f-002', title: 'Issue B', severity: 'critical' as const }),
      ];
      const result = buildBulkAiFixPrompt(findings);
      expect(result).toContain('# Fix 2 Findings');
      expect(result).toContain('## 1. Issue A');
      expect(result).toContain('## 2. Issue B');
      expect(result).toContain('**Severity:** critical');
    });
  });

  describe('buildJiraPayload', () => {
    it('produces valid Jira issue fields', () => {
      const payload = buildJiraPayload(makeFinding());
      expect(payload.fields.project.key).toBe('RADAR');
      expect(payload.fields.issuetype.name).toBe('Bug');
      expect(payload.fields.summary).toBe('[HIGH] Hardcoded API key');
      expect(payload.fields.priority.name).toBe('High');
      expect(payload.fields.labels).toContain('radar');
      expect(payload.fields.labels).toContain('severity-high');
      expect(payload.fields.labels).toContain('security');
    });

    it('accepts custom project key', () => {
      const payload = buildJiraPayload(makeFinding(), 'MYPROJ');
      expect(payload.fields.project.key).toBe('MYPROJ');
    });

    it('maps severity to Jira priority', () => {
      expect(buildJiraPayload(makeFinding({ severity: 'critical' as const })).fields.priority.name).toBe('Highest');
      expect(buildJiraPayload(makeFinding({ severity: 'low' as const })).fields.priority.name).toBe('Low');
      expect(buildJiraPayload(makeFinding({ severity: 'info' as const })).fields.priority.name).toBe('Lowest');
    });
  });

  describe('buildBulkJiraPayload', () => {
    it('wraps multiple findings in issueUpdates array', () => {
      const findings = [makeFinding({ id: 'a' }), makeFinding({ id: 'b' })];
      const result = buildBulkJiraPayload(findings);
      expect(result.issueUpdates).toHaveLength(2);
      expect(result.issueUpdates[0].fields.summary).toContain('Hardcoded API key');
    });
  });

  describe('buildAdoPayload', () => {
    it('produces ADO work item patch operations', () => {
      const ops = buildAdoPayload(makeFinding());
      const titleOp = ops.find(o => o.path === '/fields/System.Title');
      const sevOp = ops.find(o => o.path === '/fields/Microsoft.VSTS.Common.Severity');
      const tagsOp = ops.find(o => o.path === '/fields/System.Tags');
      expect(titleOp?.value).toBe('[HIGH] Hardcoded API key');
      expect(sevOp?.value).toBe('2 - High');
      expect(tagsOp?.value).toContain('radar');
      expect(ops.every(o => o.op === 'add')).toBe(true);
    });

    it('maps severity to ADO severity levels', () => {
      const critOps = buildAdoPayload(makeFinding({ severity: 'critical' as const }));
      expect(critOps.find(o => o.path.includes('Severity'))?.value).toBe('1 - Critical');
    });
  });

  describe('buildBulkAdoPayload', () => {
    it('returns array of patch operation arrays', () => {
      const result = buildBulkAdoPayload([makeFinding(), makeFinding({ id: 'f-002' })]);
      expect(result).toHaveLength(2);
      expect(Array.isArray(result[0])).toBe(true);
    });
  });
});
