import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { GoalType } from '../types/state.js';

/**
 * Directory containing consulting rule markdown files.
 * Resolved relative to this file's location (src/agent/ → src/rules/).
 */
const RULES_DIR = path.resolve(import.meta.dirname, '..', 'rules');

/** Module-level cache — rules are static for the lifetime of the process. */
const ruleCache = new Map<string, string>();

/**
 * Load a single rule file by name. Cached after first read.
 */
export async function loadRule(filename: string): Promise<string | null> {
  const cached = ruleCache.get(filename);
  if (cached !== undefined) return cached;

  const filePath = path.join(RULES_DIR, filename);
  try {
    const content = await readFile(filePath, 'utf-8');
    ruleCache.set(filename, content);
    return content;
  } catch {
    return null;
  }
}

/**
 * Build the system prompt by assembling:
 *   1. Core investigation rules (always loaded)
 *   2. Platform-specific rules (loaded if platform is known)
 *   3. Goal-specific rules (always loaded)
 *
 * Rules are joined with markdown separators.
 * Platform rules are optional — if the platform is 'unknown', they're skipped.
 */
export async function buildSystemPrompt(goal: GoalType | 'universal', platform: string): Promise<string> {
  const parts: string[] = [];

  const core = await loadRule('core.md');
  if (core) parts.push(core);

  if (platform !== 'unknown') {
    const platformRule = await loadRule(`platform-${platform}.md`);
    if (platformRule) parts.push(platformRule);
  }

  const goalRule = await loadRule(`goal-${goal}.md`);
  if (goalRule) parts.push(goalRule);

  return parts.join('\n\n---\n\n');
}

/**
 * List all available rule files in the rules directory.
 * Useful for validation and the CLI --dry-run command.
 */
export async function listRuleFiles(): Promise<string[]> {
  try {
    return (await readdir(RULES_DIR)).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

/**
 * Validate that all expected rule files exist for a given goal and platform.
 * Returns an array of missing files (empty array = all present).
 */
export function validateRules(goal: GoalType, platform: string): string[] {
  const expected = ['core.md', `goal-${goal}.md`];
  if (platform !== 'unknown') {
    expected.push(`platform-${platform}.md`);
  }

  return expected.filter((filename) => {
    const filePath = path.join(RULES_DIR, filename);
    return !existsSync(filePath);
  });
}
