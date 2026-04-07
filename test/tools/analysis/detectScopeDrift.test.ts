import { describe, it, expect, afterAll } from 'vitest';
import { detectScopeDrift } from '../../../src/tools/analysis/detectScopeDrift.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('detectScopeDrift', () => {
  // --- Test 1: Contradicted claim (TypeScript strict) ---
  const tmpStrict = path.join(tmpdir(), `drift-strict-${Date.now()}`);
  afterAll(() => {
    try { rmSync(tmpStrict, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detects contradicted TypeScript strict mode claim', async () => {
    mkdirSync(tmpStrict, { recursive: true });
    writeFileSync(path.join(tmpStrict, 'README.md'), '# My App\n\nBuilt with TypeScript strict mode for maximum safety.');
    writeFileSync(path.join(tmpStrict, 'package.json'), JSON.stringify({ name: 'test' }));
    writeFileSync(path.join(tmpStrict, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: false },
    }));

    const result = await detectScopeDrift(tmpStrict, {});
    expect(result.claims.length).toBeGreaterThanOrEqual(1);

    const strictClaim = result.claims.find((c) => c.claim.includes('strict'));
    expect(strictClaim).toBeDefined();
    expect(strictClaim!.verification).toBe('contradicted');
    expect(strictClaim!.evidence).toContain('strict: false');
    expect(result.summary).toContain('contradicted');
  });

  // --- Test 2: Verified claim (Next.js) ---
  const tmpNextjs = path.join(tmpdir(), `drift-nextjs-${Date.now()}`);
  afterAll(() => {
    try { rmSync(tmpNextjs, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detects verified claim when dependency exists', async () => {
    mkdirSync(tmpNextjs, { recursive: true });
    writeFileSync(path.join(tmpNextjs, 'README.md'), '# My App\n\nBuilt with TypeScript and ESLint for code quality.');
    writeFileSync(path.join(tmpNextjs, 'package.json'), JSON.stringify({
      name: 'test',
      dependencies: { next: '14.0.0' },
      devDependencies: { eslint: '8.50.0', typescript: '5.2.0' },
    }));
    writeFileSync(path.join(tmpNextjs, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true },
    }));

    const result = await detectScopeDrift(tmpNextjs, {});
    expect(result.claims.length).toBeGreaterThanOrEqual(1);

    const tsClaim = result.claims.find((c) => c.claim.includes('TypeScript'));
    expect(tsClaim).toBeDefined();
    expect(tsClaim!.verification).toBe('verified');

    const eslintClaim = result.claims.find((c) => c.claim.includes('ESLint'));
    expect(eslintClaim).toBeDefined();
    expect(eslintClaim!.verification).toBe('verified');

    expect(result.summary).toContain('verified');
  });

  // --- Test 3: No README ---
  const tmpNoReadme = path.join(tmpdir(), `drift-noreadme-${Date.now()}`);
  afterAll(() => {
    try { rmSync(tmpNoReadme, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('returns empty claims gracefully when no README exists', async () => {
    mkdirSync(tmpNoReadme, { recursive: true });
    writeFileSync(path.join(tmpNoReadme, 'package.json'), JSON.stringify({ name: 'test' }));

    const result = await detectScopeDrift(tmpNoReadme, {});
    expect(result.claims).toEqual([]);
    expect(result.summary).toContain('No README or package.json description found');
  });

  // --- Test 4: CI badge drift ---
  const tmpCiBadge = path.join(tmpdir(), `drift-ci-badge-${Date.now()}`);
  afterAll(() => {
    try { rmSync(tmpCiBadge, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detects CI badge with no workflows directory', async () => {
    mkdirSync(tmpCiBadge, { recursive: true });
    writeFileSync(path.join(tmpCiBadge, 'README.md'),
      '# My App\n\n![CI](https://github.com/foo/bar/actions/workflows/ci.yml/badge.svg)\n\nA great app.',
    );
    writeFileSync(path.join(tmpCiBadge, 'package.json'), JSON.stringify({ name: 'test' }));

    const result = await detectScopeDrift(tmpCiBadge, {});
    const ciBadgeClaim = result.claims.find((c) => c.claim.includes('CI'));
    expect(ciBadgeClaim).toBeDefined();
    expect(ciBadgeClaim!.verification).toBe('contradicted');
    expect(ciBadgeClaim!.evidence).toContain('no .github/workflows');
  });
});
