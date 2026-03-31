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
 * Record a finding into the agent state. Returns the finding ID
 * and updated total count. This is the only tool that mutates state.
 */
export function recordFinding(
  state: AgentState,
  input: RecordFindingInput,
): RecordFindingOutput {
  if (!input.finding.id || !input.finding.category || !input.finding.severity) {
    throw new Error('Finding requires id, category, and severity');
  }

  state.findings.push(input.finding);

  return {
    findingId: input.finding.id,
    totalFindings: state.findings.length,
  };
}
