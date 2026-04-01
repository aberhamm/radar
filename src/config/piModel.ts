/**
 * Pi Model configuration for Portkey gateway.
 *
 * Builds a Pi-ai Model<'openai-completions'> that routes through the Portkey
 * gateway to Amazon Bedrock. Reads connection details from environment variables.
 */

import type { Model } from '@mariozechner/pi-ai';

export interface PiModelConfig {
  /** Portkey API key (required) */
  apiKey: string;
  /** Portkey gateway base URL */
  baseUrl: string;
  /** Portkey provider routing header */
  provider: string;
  /** Bedrock model ID */
  modelId: string;
}

/**
 * Build a Pi Model config from environment variables.
 * Returns the model and the API key separately (Pi passes keys via getApiKey, not in Model).
 */
export function buildPiModel(overrides?: Partial<PiModelConfig>): {
  model: Model<'openai-completions'>;
  apiKey: string;
} {
  const apiKey = overrides?.apiKey ?? process.env.PORTKEY_API_KEY;
  const baseUrl = overrides?.baseUrl ?? process.env.PORTKEY_BASE_URL;
  const provider = overrides?.provider ?? process.env.PORTKEY_PROVIDER ?? '@aws-bedrock-use2';
  const modelId = overrides?.modelId ?? process.env.AGENT_MODEL ?? 'us.anthropic.claude-sonnet-4-6';

  if (!apiKey) throw new Error('PORTKEY_API_KEY is required. Set it in .env or pass as override.');
  if (!baseUrl) throw new Error('PORTKEY_BASE_URL is required. Set it in .env or pass as override.');

  const model: Model<'openai-completions'> = {
    id: modelId,
    name: `${modelId} via Portkey`,
    api: 'openai-completions',
    provider: 'portkey',
    baseUrl,
    headers: {
      'x-portkey-api-key': apiKey,
      'x-portkey-provider': provider,
    },
    reasoning: false,
    input: ['text'],
    cost: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      maxTokensField: 'max_tokens',
    },
  };

  return { model, apiKey };
}
