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
 * Build Pi Model configs from environment variables.
 *
 * Returns both the agent model (heavy, for investigation) and the fast model
 * (lightweight, for assembly/writing). API key is returned separately since
 * Pi passes keys via getApiKey callback, not in the Model object.
 */
export function buildPiModel(overrides?: Partial<PiModelConfig>): {
  model: Model<'openai-completions'>;
  fastModel: Model<'openai-completions'>;
  apiKey: string;
} {
  const apiKey = overrides?.apiKey ?? process.env.PORTKEY_API_KEY;
  const baseUrl = overrides?.baseUrl ?? process.env.PORTKEY_BASE_URL;
  const provider = overrides?.provider ?? process.env.PORTKEY_PROVIDER ?? '@aws-bedrock-use2';
  const modelId = overrides?.modelId ?? process.env.AGENT_MODEL ?? 'us.anthropic.claude-sonnet-4-6';
  const fastModelId = process.env.FAST_MODEL ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

  if (!apiKey) throw new Error('PORTKEY_API_KEY is required. Set it in .env or pass as override.');
  if (!baseUrl) throw new Error('PORTKEY_BASE_URL is required. Set it in .env or pass as override.');

  const sharedConfig = {
    api: 'openai-completions' as const,
    provider: 'portkey',
    baseUrl,
    headers: {
      'x-portkey-api-key': apiKey,
      'x-portkey-provider': provider,
    },
    reasoning: false,
    input: ['text'] as ('text' | 'image')[],
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStore: false,
      maxTokensField: 'max_tokens' as const,
    },
  };

  const model: Model<'openai-completions'> = {
    ...sharedConfig,
    id: modelId,
    name: `${modelId} via Portkey`,
    cost: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };

  const fastModel: Model<'openai-completions'> = {
    ...sharedConfig,
    id: fastModelId,
    name: `${fastModelId} via Portkey (fast)`,
    cost: { input: 0.0008, output: 0.004, cacheRead: 0.00008, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };

  return { model, fastModel, apiKey };
}
