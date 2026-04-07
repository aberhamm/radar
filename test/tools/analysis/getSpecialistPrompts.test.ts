import { describe, it, expect } from 'vitest';
import { getSpecialistPrompts } from '../../../src/tools/analysis/getSpecialistPrompts.js';
import type { AppRoot } from '../../../src/types/tools.js';

describe('getSpecialistPrompts', () => {
  it('returns nextjs, prisma, and tailwind specialists for matching roots', async () => {
    const roots: AppRoot[] = [
      {
        path: '.',
        type: 'nextjs',
        hasPackageJson: true,
        framework: 'next',
        frameworkVersion: '^14.2.3',
        plugins: ['prisma', 'tailwind'],
      },
    ];

    const result = await getSpecialistPrompts({ roots, isMonorepo: false });

    expect(result.specialists.length).toBe(3);
    const ids = result.specialists.map((s) => s.id);
    expect(ids).toContain('nextjs');
    expect(ids).toContain('prisma');
    expect(ids).toContain('tailwind');

    // Each specialist should have non-empty checklist content
    for (const s of result.specialists) {
      expect(s.checklist.length).toBeGreaterThan(100);
    }

    expect(result.summary).toContain('3 specialist checklist');
  });

  it('returns empty specialists for unmatched stack', async () => {
    const roots: AppRoot[] = [
      {
        path: '.',
        type: 'node',
        hasPackageJson: true,
        framework: 'express',
      },
    ];

    const result = await getSpecialistPrompts({ roots, isMonorepo: false });

    expect(result.specialists).toEqual([]);
    expect(result.summary).toContain('No specialist checklists');
  });

  it('returns nextjs and cms-sitecore specialists for Sitecore JSS project', async () => {
    const roots: AppRoot[] = [
      {
        path: '.',
        type: 'nextjs',
        hasPackageJson: true,
        framework: 'next',
        plugins: ['sitecore-jss'],
      },
    ];

    const result = await getSpecialistPrompts({ roots, isMonorepo: false });

    const ids = result.specialists.map((s) => s.id);
    expect(ids).toContain('nextjs');
    expect(ids).toContain('cms-sitecore');
    expect(result.specialists.length).toBe(2);
  });

  it('returns nextjs and cms-optimizely specialists for Optimizely project', async () => {
    const roots: AppRoot[] = [
      {
        path: '.',
        type: 'nextjs',
        hasPackageJson: true,
        framework: 'next',
        plugins: ['optimizely-cms', 'graphql'],
      },
    ];

    const result = await getSpecialistPrompts({ roots, isMonorepo: false });

    const ids = result.specialists.map((s) => s.id);
    expect(ids).toContain('nextjs');
    expect(ids).toContain('cms-optimizely');
    expect(ids).toContain('graphql');
  });

  it('sorts high-relevance specialists before medium-relevance', async () => {
    const roots: AppRoot[] = [
      {
        path: '.',
        type: 'nextjs',
        hasPackageJson: true,
        framework: 'next',
        plugins: ['tailwind', 'prisma'],
      },
    ];

    const result = await getSpecialistPrompts({ roots, isMonorepo: false });

    // nextjs (high) and prisma (high) should come before tailwind (medium)
    const tailwindIndex = result.specialists.findIndex((s) => s.id === 'tailwind');
    const nextjsIndex = result.specialists.findIndex((s) => s.id === 'nextjs');
    const prismaIndex = result.specialists.findIndex((s) => s.id === 'prisma');

    expect(nextjsIndex).toBeLessThan(tailwindIndex);
    expect(prismaIndex).toBeLessThan(tailwindIndex);
    expect(result.specialists[tailwindIndex].relevance).toBe('medium');
  });

  it('deduplicates specialists across multiple roots', async () => {
    const roots: AppRoot[] = [
      {
        path: 'packages/web',
        type: 'nextjs',
        hasPackageJson: true,
        framework: 'next',
        plugins: ['tailwind'],
      },
      {
        path: 'packages/admin',
        type: 'nextjs',
        hasPackageJson: true,
        framework: 'next',
        plugins: ['tailwind'],
      },
    ];

    const result = await getSpecialistPrompts({ roots, isMonorepo: true, monorepoTool: 'turborepo' });

    // Should only have one nextjs and one tailwind specialist, not duplicates
    const ids = result.specialists.map((s) => s.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids.length).toBe(uniqueIds.length);
    expect(ids).toContain('nextjs');
    expect(ids).toContain('tailwind');
  });
});
