import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parseEnvFile } from '../../../src/tools/config/parseEnvFile.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('parseEnvFile', () => {
  it('extracts variable names from .env.example', async () => {
    const result = await parseEnvFile(FIXTURE, { path: '.env.example' });
    expect(result.error).toBeUndefined();
    const names = result.variables.map((v) => v.name);
    expect(names).toContain('SITECORE_API_KEY');
    expect(names).toContain('JSS_APP_NAME');
    expect(result.variables.every((v) => v.hasDefault)).toBe(true);
  });

  it('returns error for missing file', async () => {
    const result = await parseEnvFile(FIXTURE, { path: '.env.local' });
    expect(result.error).toContain('not found');
  });
});
