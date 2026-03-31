import type { AgentState } from '../types/state.js';
import type { Scorecard, RunMetrics } from '../types/output.js';

/**
 * Full JSON export of an agent run — enables diffing, debugging, auditing.
 */
export interface FullExport {
  metadata: {
    version: string;
    generatedAt: string;
    goalType: string;
    repoName: string;
    repoSource: string;
  };
  scorecard: Scorecard;
  findings: AgentState['findings'];
  investigationLog: AgentState['investigationLog'];
  fetchedDocs: AgentState['fetchedDocs'];
  resolvedVersions: AgentState['resolvedVersions'];
  stackProfile: AgentState['stackProfile'];
  sections: Record<string, string>;
  metrics: RunMetrics;
}

/**
 * Build the full JSON export from agent state and computed outputs.
 */
export function buildFullExport(
  state: AgentState,
  scorecard: Scorecard,
  sections: Record<string, string>,
  metrics: RunMetrics,
): FullExport {
  return {
    metadata: {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      goalType: state.goal,
      repoName: state.repo.name,
      repoSource: state.repo.source,
    },
    scorecard,
    findings: state.findings,
    investigationLog: state.investigationLog,
    fetchedDocs: state.fetchedDocs,
    resolvedVersions: state.resolvedVersions,
    stackProfile: state.stackProfile,
    sections,
    metrics,
  };
}

/**
 * Serialize the export to a JSON string with stable key ordering.
 */
export function serializeExport(exportData: FullExport): string {
  return JSON.stringify(exportData, null, 2);
}
