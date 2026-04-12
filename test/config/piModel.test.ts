import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildPiModel } from '../../src/config/piModel.js';

describe('buildPiModel', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    // Default to portkey provider (existing behavior)
    process.env.PROVIDER_TYPE = 'portkey';
    process.env.PORTKEY_API_KEY = 'test-key';
    process.env.PORTKEY_BASE_URL = 'https://test.example.com/v1';
    process.env.PORTKEY_PROVIDER = '@aws-bedrock-use2';
    process.env.AGENT_MODEL = 'us.anthropic.claude-sonnet-4-6';
    process.env.FAST_MODEL = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('builds both agent and fast models from env vars', () => {
    const { model, fastModel, apiKey } = buildPiModel();

    expect(apiKey).toBe('test-key');
    expect(model.id).toBe('us.anthropic.claude-sonnet-4-6');
    expect(model.api).toBe('openai-completions');
    expect(fastModel.id).toBe('us.anthropic.claude-haiku-4-5-20251001-v1:0');
    expect(fastModel.api).toBe('openai-completions');
  });

  it('agent and fast models share gateway config', () => {
    const { model, fastModel } = buildPiModel();

    expect(model.baseUrl).toBe(fastModel.baseUrl);
    expect(model.headers).toEqual(fastModel.headers);
    expect(model.compat).toEqual(fastModel.compat);
  });

  it('fast model has lower cost than agent model', () => {
    const { model, fastModel } = buildPiModel();

    expect(fastModel.cost!.input).toBeLessThan(model.cost!.input);
    expect(fastModel.cost!.output).toBeLessThan(model.cost!.output);
  });

  it('throws when required env vars are missing', () => {
    delete process.env.PORTKEY_API_KEY;
    expect(() => buildPiModel()).toThrow('PORTKEY_API_KEY is required');
  });

  it('throws when PORTKEY_BASE_URL is missing', () => {
    delete process.env.PORTKEY_BASE_URL;
    expect(() => buildPiModel()).toThrow('PORTKEY_BASE_URL is required');
  });

  it('accepts overrides', () => {
    const { model } = buildPiModel({ modelId: 'custom-model' });
    expect(model.id).toBe('custom-model');
  });

  it('includes provider type in model name', () => {
    const { model } = buildPiModel();
    expect(model.name).toContain('via portkey');
  });

  it('works with openai provider', () => {
    process.env.PROVIDER_TYPE = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    delete process.env.AGENT_MODEL;
    delete process.env.FAST_MODEL;

    const { model, fastModel } = buildPiModel();
    expect(model.id).toBe('gpt-4o');
    expect(fastModel.id).toBe('gpt-4o-mini');
    expect(model.name).toContain('via openai');
    expect(model.headers!['Authorization']).toBe('Bearer sk-test');
  });
});
