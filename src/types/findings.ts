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
  | 'nextjs'
  | 'performance'
  | 'accessibility'
  | 'forms'
  | 'aria';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Evidence {
  filePath: string;
  lineNumber?: number;
  snippet: string;
  description: string;
  /** Agent's original snippet before auto-correction (set when verification corrects it) */
  originalSnippet?: string;
  /** Whether evidence was verified against the actual file */
  verified?: boolean;
  /** Granular verification outcome */
  verificationStatus?: 'verified' | 'corrected' | 'unverifiable';
  /** Actual source code from the file around the referenced line (5-line window). Set by verification. */
  sourceContext?: string;
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
  /** Confidence 1-10. 9-10: verified in code. 7-8: pattern match. 5-6: needs confirmation. 3-4: speculative. */
  confidence?: number;
  title: string;
  description: string;
  evidence: Evidence[];
  tags: string[];
  investigationNote?: string;
  documentationRefs?: DocRef[];
  /** Notes from post-investigation verification pass */
  verificationNotes?: string[];
  /** SHA-256 fingerprint for cross-run trend tracking: sha256(category + filePath + normalizedTitle) */
  fingerprint?: string;
}
