/**
 * Provider-agnostic LLM configuration.
 *
 * Supports multiple providers via PROVIDER_TYPE env var:
 *   - portkey:       Portkey AI gateway (default, routes to Bedrock/Anthropic/etc.)
 *   - openai:        Direct OpenAI API
 *   - azure-openai:  Azure OpenAI Service
 *   - generic:       Any OpenAI-compatible endpoint (Ollama, Together, Groq, vLLM, etc.)
 *
 * All providers use the OpenAI chat completions API format, which Pi Agent
 * consumes via its openai-completions model type.
 */

export type ProviderType = 'portkey' | 'openai' | 'azure-openai' | 'generic';

export interface ProviderConfig {
  providerType: ProviderType;
  apiKey: string;
  baseUrl: string;
  agentModelId: string;
  fastModelId: string;
  headers: Record<string, string>;
}

interface ProviderOverrides {
  providerType?: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  provider?: string;           // Portkey-specific: provider routing header
  agentModelId?: string;
  fastModelId?: string;
}

const MODEL_DEFAULTS: Record<ProviderType, { agent: string; fast: string }> = {
  portkey:        { agent: 'us.anthropic.claude-sonnet-4-6',                fast: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
  openai:         { agent: 'gpt-4o',                                        fast: 'gpt-4o-mini' },
  'azure-openai': { agent: 'gpt-4o',                                        fast: 'gpt-4o-mini' },
  generic:        { agent: 'claude-sonnet-4-6-20250514',                   fast: 'claude-haiku-4-5-20251001' },
};

function resolveProviderType(override?: ProviderType): ProviderType {
  if (override) return override;
  const env = process.env.PROVIDER_TYPE;
  if (env && ['portkey', 'openai', 'azure-openai', 'generic'].includes(env)) {
    return env as ProviderType;
  }
  // Auto-detect from env vars
  if (process.env.PORTKEY_API_KEY) return 'portkey';
  if (process.env.AZURE_OPENAI_API_KEY) return 'azure-openai';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'generic';
}

function buildPortkeyConfig(overrides: ProviderOverrides): ProviderConfig {
  const apiKey = overrides.apiKey ?? process.env.PORTKEY_API_KEY;
  const baseUrl = overrides.baseUrl ?? process.env.PORTKEY_BASE_URL;
  const provider = overrides.provider ?? process.env.PORTKEY_PROVIDER ?? '@aws-bedrock-use2';

  if (!apiKey) throw new Error('PORTKEY_API_KEY is required for portkey provider. Set it in .env or pass as override.');
  if (!baseUrl) throw new Error('PORTKEY_BASE_URL is required for portkey provider. Set it in .env or pass as override.');

  const defaults = MODEL_DEFAULTS.portkey;
  return {
    providerType: 'portkey',
    apiKey,
    baseUrl,
    agentModelId: overrides.agentModelId ?? process.env.AGENT_MODEL ?? defaults.agent,
    fastModelId: overrides.fastModelId ?? process.env.FAST_MODEL ?? defaults.fast,
    headers: {
      'x-portkey-api-key': apiKey,
      'x-portkey-provider': provider,
      'Content-Type': 'application/json',
    },
  };
}

function buildOpenAIConfig(overrides: ProviderOverrides): ProviderConfig {
  const apiKey = overrides.apiKey ?? process.env.OPENAI_API_KEY;
  const baseUrl = overrides.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';

  if (!apiKey) throw new Error('OPENAI_API_KEY is required for openai provider. Set it in .env or pass as override.');

  const defaults = MODEL_DEFAULTS.openai;
  return {
    providerType: 'openai',
    apiKey,
    baseUrl,
    agentModelId: overrides.agentModelId ?? process.env.AGENT_MODEL ?? defaults.agent,
    fastModelId: overrides.fastModelId ?? process.env.FAST_MODEL ?? defaults.fast,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  };
}

function buildAzureOpenAIConfig(overrides: ProviderOverrides): ProviderConfig {
  const apiKey = overrides.apiKey ?? process.env.AZURE_OPENAI_API_KEY;
  const baseUrl = overrides.baseUrl ?? process.env.AZURE_OPENAI_BASE_URL;

  if (!apiKey) throw new Error('AZURE_OPENAI_API_KEY is required for azure-openai provider. Set it in .env or pass as override.');
  if (!baseUrl) throw new Error('AZURE_OPENAI_BASE_URL is required for azure-openai provider. Set it in .env (e.g., https://your-resource.openai.azure.com/openai/deployments).');

  const defaults = MODEL_DEFAULTS['azure-openai'];
  return {
    providerType: 'azure-openai',
    apiKey,
    baseUrl,
    agentModelId: overrides.agentModelId ?? process.env.AGENT_MODEL ?? defaults.agent,
    fastModelId: overrides.fastModelId ?? process.env.FAST_MODEL ?? defaults.fast,
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
  };
}

function buildGenericConfig(overrides: ProviderOverrides): ProviderConfig {
  const apiKey = overrides.apiKey ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
  const baseUrl = overrides.baseUrl ?? process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL;

  if (!baseUrl) throw new Error('LLM_BASE_URL (or OPENAI_BASE_URL) is required for generic provider. Set it in .env (e.g., http://localhost:11434/v1 for Ollama).');

  const defaults = MODEL_DEFAULTS.generic;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return {
    providerType: 'generic',
    apiKey,
    baseUrl,
    agentModelId: overrides.agentModelId ?? process.env.AGENT_MODEL ?? defaults.agent,
    fastModelId: overrides.fastModelId ?? process.env.FAST_MODEL ?? defaults.fast,
    headers,
  };
}

const PROVIDER_BUILDERS: Record<ProviderType, (overrides: ProviderOverrides) => ProviderConfig> = {
  portkey: buildPortkeyConfig,
  openai: buildOpenAIConfig,
  'azure-openai': buildAzureOpenAIConfig,
  generic: buildGenericConfig,
};

/**
 * Build provider configuration from environment variables.
 * Auto-detects provider from PROVIDER_TYPE env var or presence of provider-specific keys.
 */
export function getProviderConfig(overrides?: Partial<ProviderOverrides>): ProviderConfig {
  const providerType = resolveProviderType(overrides?.providerType);
  const builder = PROVIDER_BUILDERS[providerType];
  if (!builder) {
    throw new Error(`Unknown PROVIDER_TYPE: "${providerType}". Supported: portkey, openai, azure-openai, generic.`);
  }
  return builder(overrides ?? {});
}

/**
 * Backward-compatible alias. Existing code that calls getPortkeyConfig()
 * continues to work — it now routes through the provider abstraction.
 */
export function getPortkeyConfig(overrides?: Partial<ProviderOverrides>): ProviderConfig {
  return getProviderConfig(overrides);
}

export type { ProviderOverrides };

// Re-export PortkeyConfig as alias for backward compatibility
export type PortkeyConfig = ProviderConfig;
