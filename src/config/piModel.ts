/**
 * Pi Model configuration — provider-agnostic.
 *
 * Builds a Pi-ai Model<'openai-completions'> that routes through the
 * configured provider (Portkey, OpenAI, Azure OpenAI, or any generic
 * OpenAI-compatible endpoint). Provider selection is via PROVIDER_TYPE
 * env var or auto-detection from available API keys.
 */

import type { Model } from '@mariozechner/pi-ai';
import { getProviderConfig, type ProviderOverrides } from './providerConfig.js';

export interface PiModelConfig {
  /** API key (provider-specific: PORTKEY_API_KEY, OPENAI_API_KEY, etc.) */
  apiKey: string;
  /** Base URL for the API endpoint */
  baseUrl: string;
  /** Portkey-specific: provider routing header */
  provider: string;
  /** Model ID for the agent (investigation) model */
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
  const config = getProviderConfig({
    apiKey: overrides?.apiKey,
    baseUrl: overrides?.baseUrl,
    provider: overrides?.provider,
    agentModelId: overrides?.modelId,
  } as Partial<ProviderOverrides>);

  const sharedConfig = {
    api: 'openai-completions' as const,
    provider: config.providerType,
    baseUrl: config.baseUrl,
    headers: config.headers,
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
    name: `${config.agentModelId} via ${config.providerType}`,
    cost: { input: 0.003, output: 0.015, cacheRead: 0.0003, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };

  const fastModel: Model<'openai-completions'> = {
    ...sharedConfig,
    id: config.fastModelId,
    name: `${config.fastModelId} via ${config.providerType} (fast)`,
    cost: { input: 0.0008, output: 0.004, cacheRead: 0.00008, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };

  return { model, fastModel, apiKey: config.apiKey };
}
