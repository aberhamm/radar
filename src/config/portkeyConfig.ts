/**
 * Shared Portkey gateway configuration.
 * Single source of truth for connection details used by both Pi Agent (via piModel.ts)
 * and the direct brief writer (goalBriefWriter.ts).
 */

export interface PortkeyConfig {
  apiKey: string;
  baseUrl: string;
  provider: string;
  agentModelId: string;
  fastModelId: string;
  headers: Record<string, string>;
}

export function getPortkeyConfig(overrides?: Partial<PortkeyConfig>): PortkeyConfig {
  const apiKey = overrides?.apiKey ?? process.env.PORTKEY_API_KEY;
  const baseUrl = overrides?.baseUrl ?? process.env.PORTKEY_BASE_URL;
  const provider = overrides?.provider ?? process.env.PORTKEY_PROVIDER ?? '@aws-bedrock-use2';
  const agentModelId = overrides?.agentModelId ?? process.env.AGENT_MODEL ?? 'us.anthropic.claude-sonnet-4-6';
  const fastModelId = overrides?.fastModelId ?? process.env.FAST_MODEL ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

  if (!apiKey) throw new Error('PORTKEY_API_KEY is required. Set it in .env or pass as override.');
  if (!baseUrl) throw new Error('PORTKEY_BASE_URL is required. Set it in .env or pass as override.');

  return {
    apiKey,
    baseUrl,
    provider,
    agentModelId,
    fastModelId,
    headers: {
      'x-portkey-api-key': apiKey,
      'x-portkey-provider': provider,
      'Content-Type': 'application/json',
    },
  };
}
