/**
 * Pi Model configuration for Portkey gateway.
 *
 * Builds a Pi-ai Model<'openai-completions'> that routes through the Portkey
 * gateway to Amazon Bedrock. Uses shared PortkeyConfig for connection details.
 */

import type { Model } from '@mariozechner/pi-ai';
import { getPortkeyConfig } from './portkeyConfig.js';

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
  const config = getPortkeyConfig({
    apiKey: overrides?.apiKey,
    baseUrl: overrides?.baseUrl,
    provider: overrides?.provider,
    agentModelId: overrides?.modelId,
  });

  const sharedConfig = {
    api: 'openai-completions' as const,
    provider: 'portkey',
    baseUrl: config.baseUrl,
    headers: {
      'x-portkey-api-key': config.apiKey,
      'x-portkey-provider': config.provider,
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
    id: config.agentModelId,
    name: `${config.agentModelId} via Portkey`,
    cost: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };

  const fastModel: Model<'openai-completions'> = {
    ...sharedConfig,
    id: config.fastModelId,
    name: `${config.fastModelId} via Portkey (fast)`,
    cost: { input: 0.0008, output: 0.004, cacheRead: 0.00008, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };

  return { model, fastModel, apiKey: config.apiKey };
}
