import { describe, it, expect, afterAll } from 'vitest';
import { detectAppRoots } from '../../../src/tools/analysis/detectAppRoots.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURE = path.resolve('test/fixtures/sitecore-minimal');

describe('detectAppRoots', () => {
  it('detects single app root in sitecore-minimal fixture', async () => {
    const result = await detectAppRoots(FIXTURE, {});
    expect(result.roots.length).toBeGreaterThanOrEqual(1);
    expect(result.roots[0].path).toBe('.');
    expect(result.roots[0].hasPackageJson).toBe(true);
    expect(result.roots[0].type).toBe('nextjs');
  });

  it('reports isMonorepo=false for single root without monorepo tooling', async () => {
    const result = await detectAppRoots(FIXTURE, {});
    // sitecore-minimal has no lerna/nx/turbo, and only 1 root
    if (result.roots.length === 1) {
      expect(result.isMonorepo).toBe(false);
    }
  });

  // Monorepo fixture
  const tmpMonorepo = path.join(tmpdir(), `monorepo-test-${Date.now()}`);
  afterAll(() => {
    try { rmSync(tmpMonorepo, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detects monorepo with multiple app roots', async () => {
    // Create a minimal monorepo structure
    mkdirSync(path.join(tmpMonorepo, 'packages', 'web'), { recursive: true });
    mkdirSync(path.join(tmpMonorepo, 'packages', 'api'), { recursive: true });

    writeFileSync(path.join(tmpMonorepo, 'package.json'), JSON.stringify({
      name: 'monorepo',
      workspaces: ['packages/*'],
    }));
    writeFileSync(path.join(tmpMonorepo, 'packages', 'web', 'package.json'), JSON.stringify({
      name: '@mono/web',
      dependencies: { next: '14.0.0', react: '18.0.0' },
    }));
    writeFileSync(path.join(tmpMonorepo, 'packages', 'api', 'package.json'), JSON.stringify({
      name: '@mono/api',
      dependencies: { express: '4.18.0' },
    }));

    const result = await detectAppRoots(tmpMonorepo, {});
    expect(result.isMonorepo).toBe(true);
    expect(result.monorepoTool).toBe('npm-workspaces');
    expect(result.roots.length).toBe(3); // root + web + api

    const web = result.roots.find((r) => r.path.includes('web'));
    expect(web).toBeDefined();
    expect(web!.type).toBe('nextjs');

    const api = result.roots.find((r) => r.path.includes('api'));
    expect(api).toBeDefined();
    expect(api!.type).toBe('node');
    expect(api!.framework).toBe('express');
  });

  it('respects maxDepth', async () => {
    const result = await detectAppRoots(tmpMonorepo, { maxDepth: 0 });
    // Only root package.json at depth 0
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].path).toBe('.');
  });

  it('detects turborepo monorepo tool', async () => {
    const tmpTurbo = path.join(tmpdir(), `turbo-test-${Date.now()}`);
    mkdirSync(tmpTurbo, { recursive: true });
    writeFileSync(path.join(tmpTurbo, 'package.json'), '{}');
    writeFileSync(path.join(tmpTurbo, 'turbo.json'), '{}');

    const result = await detectAppRoots(tmpTurbo, {});
    expect(result.monorepoTool).toBe('turborepo');

    rmSync(tmpTurbo, { recursive: true, force: true });
  });

  it('detects config-based frameworks (Svelte)', async () => {
    const tmp = path.join(tmpdir(), `svelte-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { svelte: '4.2.0' },
    }));
    writeFileSync(path.join(tmp, 'svelte.config.js'), 'export default {};');

    const result = await detectAppRoots(tmp, {});
    expect(result.roots[0].type).toBe('svelte');
    expect(result.roots[0].framework).toBe('svelte');
    expect(result.roots[0].frameworkVersion).toBe('4.2.0');

    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects non-JS ecosystem roots (Go)', async () => {
    const tmp = path.join(tmpdir(), `go-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');

    const result = await detectAppRoots(tmp, {});
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].type).toBe('go');
    expect(result.roots[0].hasPackageJson).toBe(false);
    expect(result.roots[0].framework).toBe('go');

    rmSync(tmp, { recursive: true, force: true });
  });

  it('extracts framework version from deps', async () => {
    const tmp = path.join(tmpdir(), `version-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.2.3', react: '18.2.0' },
    }));

    const result = await detectAppRoots(tmp, {});
    expect(result.roots[0].type).toBe('nextjs');
    expect(result.roots[0].frameworkVersion).toBe('^14.2.3');

    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects plugins (Prisma, Tailwind, GraphQL)', async () => {
    const tmp = path.join(tmpdir(), `plugins-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({
      dependencies: { next: '14.0.0', react: '18.0.0', '@prisma/client': '5.0.0', graphql: '16.0.0' },
      devDependencies: { tailwindcss: '3.4.0', prisma: '5.0.0' },
    }));

    const result = await detectAppRoots(tmp, {});
    expect(result.roots[0].plugins).toBeDefined();
    expect(result.roots[0].plugins).toContain('prisma');
    expect(result.roots[0].plugins).toContain('tailwind');
    expect(result.roots[0].plugins).toContain('graphql');

    rmSync(tmp, { recursive: true, force: true });
  });

  it('detects .NET projects via .csproj', async () => {
    const tmp = path.join(tmpdir(), `dotnet-test-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, 'MyApp.csproj'), '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');

    const result = await detectAppRoots(tmp, {});
    expect(result.roots.length).toBe(1);
    expect(result.roots[0].type).toBe('dotnet');
    expect(result.roots[0].hasPackageJson).toBe(false);

    rmSync(tmp, { recursive: true, force: true });
  });
});
