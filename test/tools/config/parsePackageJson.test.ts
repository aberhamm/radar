import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { parsePackageJson } from '../../../src/tools/config/parsePackageJson.js';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('parsePackageJson', () => {
  it('extracts deps, scripts, name, version', async () => {
    const result = await parsePackageJson(FIXTURE, {});
    expect(result.error).toBeUndefined();
    expect(result.name).toBe('sitecore-minimal');
    expect(result.scripts).toHaveProperty('dev');
    expect(result.dependencies.some((d) => d.name === '@sitecore-jss/sitecore-jss-nextjs')).toBe(true);
    expect(result.devDependencies.some((d) => d.name === 'typescript')).toBe(true);
  });

  it('returns error for malformed JSON', async () => {
    const result = await parsePackageJson(FIXTURE, { path: 'next.config.js' });
    expect(result.error).toBeDefined();
  });
});
