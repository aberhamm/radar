import type { Finding } from '../../types/findings.js';
import type { AgentState } from '../../types/state.js';

export interface RecordFindingInput {
  finding: Finding;
}

export interface RecordFindingOutput {
  findingId: string;
  totalFindings: number;
}

/**
 * Extract the finding object from LLM-provided input.
 * Handles multiple argument shapes:
 * - { finding: { id, category, ... } }  — correct per schema
 * - { id, category, ... }                — flat (no wrapper)
 * - { finding: { finding: { ... } } }    — double-nested
 */
function extractFinding(input: Record<string, unknown>): Finding {
  let candidate = input.finding as Record<string, unknown> | undefined;

  // If finding is itself wrapped in another finding key (double-nesting)
  if (candidate && typeof candidate === 'object' && 'finding' in candidate && !('id' in candidate)) {
    candidate = candidate.finding as Record<string, unknown>;
  }

  // If input.finding exists and has the required fields, use it
  if (candidate && typeof candidate === 'object' && candidate.id && candidate.category && candidate.severity) {
    return candidate as unknown as Finding;
  }

  // Fallback: fields may be at top level
  if (input.id && input.category && input.severity) {
    return input as unknown as Finding;
  }

  // Provide diagnostic info for debugging
  const candidateKeys = candidate ? Object.keys(candidate) : [];
  const topKeys = Object.keys(input);
  throw new Error(
    `Finding requires id, category, and severity. ` +
    `finding keys: [${candidateKeys.join(', ')}], top keys: [${topKeys.join(', ')}]`,
  );
}

/**
 * Record a finding into the agent state. Returns the finding ID
 * and updated total count. This is the only tool that mutates state.
 */
export function recordFinding(
  state: AgentState,
  input: RecordFindingInput,
): RecordFindingOutput {
  const finding = extractFinding(input as unknown as Record<string, unknown>);

  state.findings.push(finding);

  return {
    findingId: finding.id,
    totalFindings: state.findings.length,
  };
}
