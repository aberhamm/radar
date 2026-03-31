/**
 * Model configuration — which model handles which role.
 *
 * agent: main investigation loop (reasoning, tool selection, analysis)
 * fast: lightweight tasks (file triage, narrative generation, finding dedup)
 */

export interface ModelConfig {
  agent: string;
  fast: string;
}

export function loadModelConfig(): ModelConfig {
  return {
    agent: process.env.AGENT_MODEL ?? 'us.anthropic.claude-sonnet-4-6',
    fast: process.env.FAST_MODEL ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  };
}
