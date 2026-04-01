import path from 'node:path';
import type { ParseNextConfigInput, ParseNextConfigOutput } from '../../types/tools.js';
import { resolveAndRead, isResolveError } from '../utils/resolveAndRead.js';

const CONFIG_NAMES = ['next.config.js', 'next.config.mjs', 'next.config.ts'];

export async function parseNextConfig(
  repoRoot: string,
  input: ParseNextConfigInput,
): Promise<ParseNextConfigOutput> {
  // Find the config file
  let configPath = '';
  let content = '';

  // Determine search directory — LLM may pass a directory path instead of a file
  const searchDir = input.path?.replace(/\/$/, '') ?? '';
  const candidates = CONFIG_NAMES.map((name) =>
    searchDir ? `${searchDir}/${name}` : name,
  );

  // If the LLM passed an exact file path, try it first
  if (input.path && CONFIG_NAMES.some((n) => input.path!.endsWith(n))) {
    const result = await resolveAndRead(repoRoot, input.path);
    if (!isResolveError(result)) {
      configPath = input.path;
      content = result.content;
    }
  }

  // Otherwise search for config files in the directory
  if (!configPath) {
    for (const candidate of candidates) {
      const result = await resolveAndRead(repoRoot, candidate);
      if (!isResolveError(result)) {
        configPath = candidate;
        content = result.content;
        break;
      }
    }
  }

  if (!configPath) {
    return {
      configPath: '', images: undefined, redirects: false, rewrites: false,
      headers: false, env: {}, experimental: {}, rawExports: [],
      error: 'No next.config file found',
    };
  }

  // Static analysis via regex (no dynamic execution)
  return {
    configPath,
    images: extractImages(content),
    redirects: /redirects\s*[:(]/.test(content) || /async\s+redirects/.test(content),
    rewrites: /rewrites\s*[:(]/.test(content) || /async\s+rewrites/.test(content),
    headers: /headers\s*[:(]/.test(content) || /async\s+headers/.test(content),
    env: extractEnv(content),
    experimental: extractExperimental(content),
    output: extractOutput(content),
    i18n: extractI18n(content),
    transpilePackages: extractTranspilePackages(content),
    rawExports: extractExports(content),
  };
}

function extractImages(content: string): { domains: string[]; remotePatterns: unknown[] } | undefined {
  const domainsMatch = content.match(/domains\s*:\s*\[([^\]]*)\]/);
  if (!domainsMatch) return undefined;

  const domains = domainsMatch[1]
    .match(/['"]([^'"]+)['"]/g)
    ?.map((s) => s.replace(/['"]/g, '')) ?? [];

  return { domains, remotePatterns: [] };
}

function extractEnv(content: string): Record<string, string> {
  const envBlock = content.match(/env\s*:\s*\{([^}]*)\}/);
  if (!envBlock) return {};

  const env: Record<string, string> = {};
  const pairs = envBlock[1].matchAll(/(\w+)\s*:\s*([^,\n]+)/g);
  for (const [, key, value] of pairs) {
    env[key] = value.trim();
  }
  return env;
}

function extractExperimental(content: string): Record<string, unknown> {
  if (/experimental\s*:/.test(content)) {
    return { present: true };
  }
  return {};
}

function extractOutput(content: string): string | undefined {
  const match = content.match(/output\s*:\s*['"](\w+)['"]/);
  return match?.[1];
}

function extractI18n(content: string): { locales: string[]; defaultLocale: string } | undefined {
  const localesMatch = content.match(/locales\s*:\s*\[([^\]]*)\]/);
  const defaultMatch = content.match(/defaultLocale\s*:\s*['"]([^'"]+)['"]/);
  if (!localesMatch) return undefined;

  const locales = localesMatch[1]
    .match(/['"]([^'"]+)['"]/g)
    ?.map((s) => s.replace(/['"]/g, '')) ?? [];

  return { locales, defaultLocale: defaultMatch?.[1] ?? locales[0] ?? 'en' };
}

function extractTranspilePackages(content: string): string[] | undefined {
  const match = content.match(/transpilePackages\s*:\s*\[([^\]]*)\]/);
  if (!match) return undefined;
  return match[1].match(/['"]([^'"]+)['"]/g)?.map((s) => s.replace(/['"]/g, '')) ?? [];
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  if (/module\.exports/.test(content)) exports.push('module.exports');
  if (/export\s+default/.test(content)) exports.push('export default');
  const named = content.matchAll(/export\s+(?:const|let|var|function)\s+(\w+)/g);
  for (const [, name] of named) exports.push(name);
  return exports;
}
