/**
 * Core finding types — the unit of agent output during investigation.
 */

export type FindingCategory =
  | 'stack'
  | 'cms-integration'
  | 'preview-editing'
  | 'configuration'
  | 'security'
  | 'architecture'
  | 'dependencies'
  | 'deployment'
  | 'routing'
  | 'data-fetching'
  | 'nextjs';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Evidence {
  filePath: string;
  lineNumber?: number;
  snippet?: string;
  description: string;
}

export interface DocRef {
  url: string;
  title: string;
  relevance: string;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: Severity;
  title: string;
  description: string;
  evidence: Evidence[];
  tags: string[];
  investigationNote?: string;
  documentationRefs?: DocRef[];
}
