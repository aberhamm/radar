import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseNextConfig } from '../../../src/tools/config/parseNextConfig.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('parseNextConfig', () => {
  it('extracts images, env, i18n from config', async () => {
    const result = await parseNextConfig(FIXTURE, {});
    expect(result.error).toBeUndefined();
    expect(result.configPath).toBe('next.config.js');
    expect(result.images?.domains).toContain('cm.example.com');
    expect(result.env).toHaveProperty('SITECORE_API_HOST');
    expect(result.i18n?.locales).toContain('en');
    expect(result.rawExports).toContain('module.exports');
  });

  it('returns error when no config exists', async () => {
    const result = await parseNextConfig(path.resolve('test/fixtures'), {});
    expect(result.error).toBeDefined();
  });
});
