/**
 * detect_scope_drift — Cross-reference README/docs claims against actual code.
 *
 * Table-driven pattern matching (no LLM). Each claim pattern has:
 * - a regex to find claims in README/docs
 * - a verify function that checks if the claim holds in the repo
 *
 * Returns claims array + summary string.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DetectScopeDriftInput, DetectScopeDriftOutput, DriftClaim } from '../../types/tools.js';

/** Try to read a file, return null if not found. */
async function tryRead(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Check if a path exists (file or directory). */
async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Check if any file matching a prefix pattern exists in a directory. */
async function hasFileWithPrefix(dir: string, prefix: string): Promise<boolean> {
  try {
    const entries = await readdir(dir);
    return entries.some((e) => e.startsWith(prefix));
  } catch {
    return false;
  }
}

/** Read package.json deps (all combined). */
async function readAllDeps(repoRoot: string): Promise<Record<string, string>> {
  const raw = await tryRead(join(repoRoot, 'package.json'));
  if (!raw) return {};
  try {
    const pkg = JSON.parse(raw);
    return {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
      ...((pkg.peerDependencies as Record<string, string>) ?? {}),
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Claim pattern definitions
// ---------------------------------------------------------------------------

interface ClaimPattern {
  /** Human-readable label for the claim type. */
  label: string;
  /** Regex to match in README text (case-insensitive). */
  regex: RegExp;
  /** Verify whether the claim holds. Returns verification + evidence. */
  verify: (repoRoot: string, deps: Record<string, string>) => Promise<{
    verification: DriftClaim['verification'];
    evidence?: string;
    filePath?: string;
  }>;
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  // 1. TypeScript strict mode
  {
    label: 'TypeScript strict mode',
    regex: /typescript\s+strict|strict\s+typescript|strict\s+mode/i,
    verify: async (root) => {
      const raw = await tryRead(join(root, 'tsconfig.json'));
      if (!raw) return { verification: 'unverified', evidence: 'tsconfig.json not found' };
      try {
        // Strip comments (simple: single-line //)
        const stripped = raw.replace(/\/\/.*$/gm, '');
        const tsconfig = JSON.parse(stripped);
        const strict = tsconfig?.compilerOptions?.strict;
        if (strict === true) {
          return { verification: 'verified', evidence: 'tsconfig.json has strict: true', filePath: 'tsconfig.json' };
        }
        if (strict === false) {
          return { verification: 'contradicted', evidence: 'tsconfig.json has strict: false', filePath: 'tsconfig.json' };
        }
        return { verification: 'unverified', evidence: 'tsconfig.json does not set strict explicitly', filePath: 'tsconfig.json' };
      } catch {
        return { verification: 'unverified', evidence: 'tsconfig.json could not be parsed' };
      }
    },
  },

  // 2. TypeScript (general)
  {
    label: 'TypeScript',
    regex: /\btypescript\b/i,
    verify: async (root) => {
      const hasTsconfig = await exists(join(root, 'tsconfig.json'));
      if (hasTsconfig) return { verification: 'verified', evidence: 'tsconfig.json exists', filePath: 'tsconfig.json' };
      return { verification: 'unverified', evidence: 'tsconfig.json not found' };
    },
  },

  // 3. Testing
  {
    label: 'Testing',
    regex: /\b(test(s|ing)?|coverage|jest|vitest|mocha|cypress|playwright)\b/i,
    verify: async (root, deps) => {
      const testRunners = ['jest', 'vitest', 'mocha', 'cypress', 'playwright', '@playwright/test', 'ava', 'tap'];
      const found = testRunners.filter((r) => r in deps);
      if (found.length > 0) {
        return { verification: 'verified', evidence: `Test runner(s) in deps: ${found.join(', ')}`, filePath: 'package.json' };
      }
      const hasTestDir = await exists(join(root, 'test')) || await exists(join(root, 'tests')) || await exists(join(root, '__tests__'));
      if (hasTestDir) return { verification: 'verified', evidence: 'Test directory found' };
      return { verification: 'unverified', evidence: 'No test runner in deps and no test directory found' };
    },
  },

  // 4. SSG / static site claims
  {
    label: 'Static Site Generation (SSG)',
    regex: /\b(SSG|static\s+site|static\s+generation|statically\s+generated)\b/i,
    verify: async (root) => {
      // Check for getServerSideProps usage which contradicts SSG-first claims
      try {
        const srcPages = await readdir(join(root, 'src', 'pages'), { recursive: true }).catch(() => [] as string[]);
        const entries: string[] = (srcPages as string[]).length > 0
          ? srcPages as string[]
          : await readdir(join(root, 'pages'), { recursive: true }).catch(() => [] as string[]) as string[];

        for (const filePath of entries) {
          if (!filePath.endsWith('.tsx') && !filePath.endsWith('.ts') && !filePath.endsWith('.jsx') && !filePath.endsWith('.js')) continue;
          const content = await tryRead(join(root, 'src', 'pages', filePath)) ?? await tryRead(join(root, 'pages', filePath));
          if (content && /getServerSideProps/.test(content)) {
            return { verification: 'contradicted' as const, evidence: `getServerSideProps found in ${filePath} (contradicts SSG-first)`, filePath };
          }
        }
      } catch { /* no pages dir */ }
      return { verification: 'unverified', evidence: 'Could not confirm SSG usage from code' };
    },
  },

  // 5. Docker
  {
    label: 'Docker',
    regex: /\bdocker\b/i,
    verify: async (root) => {
      const hasDockerfile = await exists(join(root, 'Dockerfile'));
      const hasCompose = await exists(join(root, 'docker-compose.yml')) || await exists(join(root, 'docker-compose.yaml'));
      if (hasDockerfile || hasCompose) {
        const which = [hasDockerfile && 'Dockerfile', hasCompose && 'docker-compose.yml'].filter(Boolean).join(', ');
        return { verification: 'verified', evidence: `Found: ${which}`, filePath: hasDockerfile ? 'Dockerfile' : 'docker-compose.yml' };
      }
      return { verification: 'unverified', evidence: 'No Dockerfile or docker-compose.yml found' };
    },
  },

  // 6. Monorepo
  {
    label: 'Monorepo',
    regex: /\bmonorepo\b/i,
    verify: async (root) => {
      const tools = [
        { file: 'lerna.json', name: 'Lerna' },
        { file: 'nx.json', name: 'Nx' },
        { file: 'turbo.json', name: 'Turborepo' },
        { file: 'pnpm-workspace.yaml', name: 'pnpm workspaces' },
      ];
      for (const { file, name } of tools) {
        if (await exists(join(root, file))) {
          return { verification: 'verified', evidence: `${name} config found (${file})`, filePath: file };
        }
      }
      // Check package.json workspaces
      const raw = await tryRead(join(root, 'package.json'));
      if (raw) {
        try {
          const pkg = JSON.parse(raw);
          if (pkg.workspaces) return { verification: 'verified', evidence: 'package.json has workspaces field', filePath: 'package.json' };
        } catch { /* ignore */ }
      }
      return { verification: 'unverified', evidence: 'No monorepo tooling found' };
    },
  },

  // 7. ESLint
  {
    label: 'ESLint',
    regex: /\beslint\b/i,
    verify: async (root, deps) => {
      if ('eslint' in deps) return { verification: 'verified', evidence: 'eslint in deps', filePath: 'package.json' };
      const configs = ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts'];
      for (const c of configs) {
        if (await exists(join(root, c))) return { verification: 'verified', evidence: `Config found: ${c}`, filePath: c };
      }
      return { verification: 'unverified', evidence: 'No eslint config or dependency found' };
    },
  },

  // 8. Prettier
  {
    label: 'Prettier',
    regex: /\bprettier\b/i,
    verify: async (root, deps) => {
      if ('prettier' in deps) return { verification: 'verified', evidence: 'prettier in deps', filePath: 'package.json' };
      const hasConfig = await hasFileWithPrefix(root, '.prettierrc') || await exists(join(root, 'prettier.config.js')) || await exists(join(root, 'prettier.config.mjs'));
      if (hasConfig) return { verification: 'verified', evidence: 'Prettier config found' };
      return { verification: 'unverified', evidence: 'No prettier config or dependency found' };
    },
  },

  // 9. CI badge
  {
    label: 'CI/CD pipeline',
    regex: /!\[.*?\]\(https?:\/\/(?:github\.com\/[^)]*\/actions\/workflows\/[^)]+|img\.shields\.io\/github\/actions\/workflow\/status\/[^)]+)\)/i,
    verify: async (root) => {
      const hasWorkflows = await exists(join(root, '.github', 'workflows'));
      if (hasWorkflows) {
        try {
          const files = await readdir(join(root, '.github', 'workflows'));
          const ymlFiles = files.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
          if (ymlFiles.length > 0) {
            return { verification: 'verified', evidence: `Workflow files: ${ymlFiles.join(', ')}`, filePath: '.github/workflows/' };
          }
        } catch { /* ignore */ }
      }
      return { verification: 'contradicted', evidence: 'CI badge in README but no .github/workflows/ directory or workflow files found' };
    },
  },

  // 10. Accessibility / WCAG
  {
    label: 'Accessibility (WCAG/a11y)',
    regex: /\b(WCAG|accessibility|a11y)\b/i,
    verify: async (_root, deps) => {
      const a11yDeps = ['axe-core', '@axe-core/react', 'pa11y', 'jest-axe', '@testing-library/jest-dom', 'eslint-plugin-jsx-a11y'];
      const found = a11yDeps.filter((d) => d in deps);
      if (found.length > 0) {
        return { verification: 'verified', evidence: `a11y tooling in deps: ${found.join(', ')}`, filePath: 'package.json' };
      }
      return { verification: 'unverified', evidence: 'No accessibility testing tools found in dependencies' };
    },
  },

  // 11. i18n / internationalization
  {
    label: 'Internationalization (i18n)',
    regex: /\b(i18n|internationali[sz]ation|multi-?lang(uage)?)\b/i,
    verify: async (root, deps) => {
      const i18nDeps = ['next-intl', 'react-intl', 'i18next', 'next-i18next', 'react-i18next', 'formatjs', '@formatjs/intl'];
      const found = i18nDeps.filter((d) => d in deps);
      if (found.length > 0) {
        return { verification: 'verified', evidence: `i18n library in deps: ${found.join(', ')}`, filePath: 'package.json' };
      }
      // Check for locale directories
      const localeDirs = ['locales', 'locale', 'i18n', 'translations', 'lang', 'messages'];
      for (const dir of localeDirs) {
        if (await exists(join(root, dir)) || await exists(join(root, 'src', dir))) {
          return { verification: 'verified', evidence: `Locale directory found: ${dir}` };
        }
      }
      return { verification: 'unverified', evidence: 'No i18n libraries or locale directories found' };
    },
  },

  // 12. PWA / Service Worker
  {
    label: 'PWA / Service Worker',
    regex: /\b(PWA|progressive\s+web\s+app|service\s+worker)\b/i,
    verify: async (root, deps) => {
      if ('next-pwa' in deps || '@ducanh2912/next-pwa' in deps || 'workbox-webpack-plugin' in deps) {
        return { verification: 'verified', evidence: 'PWA library in deps', filePath: 'package.json' };
      }
      const swFiles = ['sw.js', 'service-worker.js', 'service-worker.ts', 'sw.ts'];
      for (const f of swFiles) {
        if (await exists(join(root, f)) || await exists(join(root, 'public', f)) || await exists(join(root, 'src', f))) {
          return { verification: 'verified', evidence: `Service worker found: ${f}`, filePath: f };
        }
      }
      return { verification: 'unverified', evidence: 'No PWA library or service worker file found' };
    },
  },

  // 13. GraphQL
  {
    label: 'GraphQL',
    regex: /\bgraphql\b/i,
    verify: async (root, deps) => {
      const gqlDeps = ['graphql', '@apollo/client', 'apollo-server', 'graphql-request', 'urql', '@urql/core', 'graphql-tag'];
      const found = gqlDeps.filter((d) => d in deps);
      if (found.length > 0) {
        return { verification: 'verified', evidence: `GraphQL deps: ${found.join(', ')}`, filePath: 'package.json' };
      }
      // Check for .graphql files
      try {
        const entries = await readdir(join(root, 'src'), { recursive: true }).catch(() => [] as string[]);
        const gqlFiles = (entries as string[]).filter((e) => typeof e === 'string' && (e.endsWith('.graphql') || e.endsWith('.gql')));
        if (gqlFiles.length > 0) {
          return { verification: 'verified', evidence: `GraphQL files found: ${gqlFiles.slice(0, 3).join(', ')}` };
        }
      } catch { /* ignore */ }
      return { verification: 'unverified', evidence: 'No GraphQL deps or .graphql files found' };
    },
  },
];

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function detectScopeDrift(
  repoRoot: string,
  input: DetectScopeDriftInput,
): Promise<DetectScopeDriftOutput> {
  const root = input.repoPath ? resolve(repoRoot, input.repoPath) : repoRoot;

  // 1. Find and read README
  const readmeNames = ['README.md', 'readme.md', 'README', 'README.txt', 'Readme.md'];
  let readmeContent: string | null = null;
  let readmeSource = '';
  for (const name of readmeNames) {
    readmeContent = await tryRead(join(root, name));
    if (readmeContent) {
      readmeSource = name;
      break;
    }
  }

  // 2. Read package.json description
  let pkgDescription = '';
  const pkgRaw = await tryRead(join(root, 'package.json'));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      pkgDescription = typeof pkg.description === 'string' ? pkg.description : '';
    } catch { /* ignore */ }
  }

  // Combine text sources
  const textSources: Array<{ source: string; text: string }> = [];
  if (readmeContent) textSources.push({ source: readmeSource, text: readmeContent });
  if (pkgDescription) textSources.push({ source: 'package.json description', text: pkgDescription });

  if (textSources.length === 0) {
    return { claims: [], summary: 'No README or package.json description found — nothing to cross-reference.' };
  }

  // 3. Load deps once for all patterns
  const deps = await readAllDeps(root);

  // 4. Match patterns and verify
  const claims: DriftClaim[] = [];

  for (const pattern of CLAIM_PATTERNS) {
    for (const { source, text } of textSources) {
      const match = pattern.regex.exec(text);
      if (match) {
        const result = await pattern.verify(root, deps);
        claims.push({
          source,
          claim: `${pattern.label}: "${match[0]}"`,
          verification: result.verification,
          evidence: result.evidence,
          filePath: result.filePath,
        });
        break; // Only count once per pattern across sources
      }
    }
  }

  // 5. Build summary
  const verified = claims.filter((c) => c.verification === 'verified').length;
  const unverified = claims.filter((c) => c.verification === 'unverified').length;
  const contradicted = claims.filter((c) => c.verification === 'contradicted').length;
  const sourceList = textSources.map((s) => s.source).join(', ');
  const summary = `Found ${claims.length} claims in ${sourceList}: ${verified} verified, ${unverified} unverified, ${contradicted} contradicted`;

  return { claims, summary };
}
