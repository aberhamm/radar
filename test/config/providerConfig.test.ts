import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getProviderConfig, getPortkeyConfig } from '../../src/config/providerConfig.js';

describe('getProviderConfig', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe('portkey provider', () => {
    beforeEach(() => {
      process.env.PROVIDER_TYPE = 'portkey';
      process.env.PORTKEY_API_KEY = 'pk-test';
      process.env.PORTKEY_BASE_URL = 'https://portkey.example.com/v1';
      process.env.PORTKEY_PROVIDER = '@aws-bedrock-use2';
      process.env.AGENT_MODEL = 'us.anthropic.claude-sonnet-4-6';
      process.env.FAST_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    });

    it('builds config from env vars', () => {
      const config = getProviderConfig();
      expect(config.providerType).toBe('portkey');
      expect(config.apiKey).toBe('pk-test');
      expect(config.baseUrl).toBe('https://portkey.example.com/v1');
      expect(config.agentModelId).toBe('us.anthropic.claude-sonnet-4-6');
      expect(config.fastModelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
      expect(config.headers['x-portkey-api-key']).toBe('pk-test');
      expect(config.headers['x-portkey-provider']).toBe('@aws-bedrock-use2');
    });

    it('throws when PORTKEY_API_KEY is missing', () => {
      delete process.env.PORTKEY_API_KEY;
      expect(() => getProviderConfig()).toThrow('PORTKEY_API_KEY is required');
    });

    it('throws when PORTKEY_BASE_URL is missing', () => {
      delete process.env.PORTKEY_BASE_URL;
      expect(() => getProviderConfig()).toThrow('PORTKEY_BASE_URL is required');
    });

    it('uses default model IDs when AGENT_MODEL and FAST_MODEL are not set', () => {
      delete process.env.AGENT_MODEL;
      delete process.env.FAST_MODEL;
      const config = getProviderConfig();
      expect(config.agentModelId).toBe('us.anthropic.claude-sonnet-4-6');
      expect(config.fastModelId).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    });
  });

  describe('openai provider', () => {
    beforeEach(() => {
      process.env.PROVIDER_TYPE = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
      // Clear portkey vars
      delete process.env.PORTKEY_API_KEY;
      delete process.env.PORTKEY_BASE_URL;
    });

    it('builds config from env vars', () => {
      const config = getProviderConfig();
      expect(config.providerType).toBe('openai');
      expect(config.apiKey).toBe('sk-test');
      expect(config.baseUrl).toBe('https://api.openai.com/v1');
      expect(config.headers['Authorization']).toBe('Bearer sk-test');
    });

    it('uses OpenAI model defaults', () => {
      delete process.env.AGENT_MODEL;
      delete process.env.FAST_MODEL;
      const config = getProviderConfig();
      expect(config.agentModelId).toBe('gpt-4o');
      expect(config.fastModelId).toBe('gpt-4o-mini');
    });

    it('throws when OPENAI_API_KEY is missing', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => getProviderConfig()).toThrow('OPENAI_API_KEY is required');
    });

    it('accepts custom base URL', () => {
      process.env.OPENAI_BASE_URL = 'https://custom.openai.com/v1';
      const config = getProviderConfig();
      expect(config.baseUrl).toBe('https://custom.openai.com/v1');
    });
  });

  describe('azure-openai provider', () => {
    beforeEach(() => {
      process.env.PROVIDER_TYPE = 'azure-openai';
      process.env.AZURE_OPENAI_API_KEY = 'az-test';
      process.env.AZURE_OPENAI_BASE_URL = 'https://myresource.openai.azure.com/openai/deployments';
      delete process.env.PORTKEY_API_KEY;
      delete process.env.OPENAI_API_KEY;
    });

    it('builds config from env vars', () => {
      const config = getProviderConfig();
      expect(config.providerType).toBe('azure-openai');
      expect(config.apiKey).toBe('az-test');
      expect(config.baseUrl).toBe('https://myresource.openai.azure.com/openai/deployments');
      expect(config.headers['api-key']).toBe('az-test');
    });

    it('throws when AZURE_OPENAI_API_KEY is missing', () => {
      delete process.env.AZURE_OPENAI_API_KEY;
      expect(() => getProviderConfig()).toThrow('AZURE_OPENAI_API_KEY is required');
    });

    it('throws when AZURE_OPENAI_BASE_URL is missing', () => {
      delete process.env.AZURE_OPENAI_BASE_URL;
      expect(() => getProviderConfig()).toThrow('AZURE_OPENAI_BASE_URL is required');
    });
  });

  describe('generic provider', () => {
    beforeEach(() => {
      process.env.PROVIDER_TYPE = 'generic';
      process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
      process.env.LLM_API_KEY = 'local-key';
      delete process.env.PORTKEY_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.AZURE_OPENAI_API_KEY;
    });

    it('builds config from env vars', () => {
      const config = getProviderConfig();
      expect(config.providerType).toBe('generic');
      expect(config.baseUrl).toBe('http://localhost:11434/v1');
      expect(config.headers['Authorization']).toBe('Bearer local-key');
    });

    it('works without API key (e.g., local Ollama)', () => {
      delete process.env.LLM_API_KEY;
      const config = getProviderConfig();
      expect(config.apiKey).toBe('');
      expect(config.headers['Authorization']).toBeUndefined();
    });

    it('throws when LLM_BASE_URL is missing', () => {
      delete process.env.LLM_BASE_URL;
      delete process.env.OPENAI_BASE_URL;
      expect(() => getProviderConfig()).toThrow('LLM_BASE_URL');
    });

    it('falls back to OPENAI_BASE_URL', () => {
      delete process.env.LLM_BASE_URL;
      process.env.OPENAI_BASE_URL = 'http://other:8080/v1';
      const config = getProviderConfig();
      expect(config.baseUrl).toBe('http://other:8080/v1');
    });
  });

  describe('auto-detection', () => {
    beforeEach(() => {
      delete process.env.PROVIDER_TYPE;
      delete process.env.PORTKEY_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.LLM_API_KEY;
      delete process.env.LLM_BASE_URL;
      delete process.env.OPENAI_BASE_URL;
    });

    it('detects portkey from PORTKEY_API_KEY', () => {
      process.env.PORTKEY_API_KEY = 'pk-test';
      process.env.PORTKEY_BASE_URL = 'https://portkey.example.com/v1';
      const config = getProviderConfig();
      expect(config.providerType).toBe('portkey');
    });

    it('detects openai from OPENAI_API_KEY', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const config = getProviderConfig();
      expect(config.providerType).toBe('openai');
    });

    it('detects azure from AZURE_OPENAI_API_KEY', () => {
      process.env.AZURE_OPENAI_API_KEY = 'az-test';
      process.env.AZURE_OPENAI_BASE_URL = 'https://myresource.openai.azure.com/openai/deployments';
      const config = getProviderConfig();
      expect(config.providerType).toBe('azure-openai');
    });

    it('falls back to generic when no API keys found', () => {
      process.env.LLM_BASE_URL = 'http://localhost:11434/v1';
      const config = getProviderConfig();
      expect(config.providerType).toBe('generic');
    });
  });

  describe('overrides', () => {
    beforeEach(() => {
      process.env.PROVIDER_TYPE = 'portkey';
      process.env.PORTKEY_API_KEY = 'pk-test';
      process.env.PORTKEY_BASE_URL = 'https://portkey.example.com/v1';
    });

    it('accepts model ID override', () => {
      const config = getProviderConfig({ agentModelId: 'custom-model' });
      expect(config.agentModelId).toBe('custom-model');
    });

    it('accepts provider type override', () => {
      process.env.OPENAI_API_KEY = 'sk-test';
      const config = getProviderConfig({ providerType: 'openai' });
      expect(config.providerType).toBe('openai');
    });
  });

  describe('invalid provider type', () => {
    beforeEach(() => {
      // Clear all provider-specific keys so auto-detection falls to generic
      delete process.env.PORTKEY_API_KEY;
      delete process.env.PORTKEY_BASE_URL;
      delete process.env.OPENAI_API_KEY;
      delete process.env.AZURE_OPENAI_API_KEY;
    });

    it('falls back to auto-detection on unknown PROVIDER_TYPE', () => {
      process.env.PROVIDER_TYPE = 'invalid-provider';
      process.env.LLM_BASE_URL = 'http://localhost/v1';
      // Invalid PROVIDER_TYPE is not in the allowed list, so auto-detection runs
      // No API keys set, falls to generic
      const config = getProviderConfig();
      expect(config.providerType).toBe('generic');
    });
  });

  describe('backward compatibility', () => {
    beforeEach(() => {
      process.env.PORTKEY_API_KEY = 'pk-test';
      process.env.PORTKEY_BASE_URL = 'https://portkey.example.com/v1';
      process.env.PORTKEY_PROVIDER = '@aws-bedrock-use2';
    });

    it('getPortkeyConfig returns same result as getProviderConfig', () => {
      const a = getProviderConfig();
      const b = getPortkeyConfig();
      expect(a).toEqual(b);
    });
  });
});
