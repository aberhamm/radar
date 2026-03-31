import fs from 'node:fs';
import path from 'node:path';
import type { GoalType } from '../types/state.js';

/**
 * Directory containing consulting rule markdown files.
 * Resolved relative to this file's location (src/agent/ → src/rules/).
 */
const RULES_DIR = path.resolve(import.meta.dirname, '..', 'rules');

/**
 * Load a single rule file by name. Returns the file content or null if not found.
 */
export function loadRule(filename: string): string | null {
  const filePath = path.join(RULES_DIR, filename);
  try {
    return fs.readFileSync(filePath, 'utf-8');
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
export function buildSystemPrompt(goal: GoalType, platform: string): string {
  const parts: string[] = [];

  const core = loadRule('core.md');
  if (core) parts.push(core);

  if (platform !== 'unknown') {
    const platformRule = loadRule(`platform-${platform}.md`);
    if (platformRule) parts.push(platformRule);
  }

  const goalRule = loadRule(`goal-${goal}.md`);
  if (goalRule) parts.push(goalRule);

  return parts.join('\n\n---\n\n');
}

/**
 * List all available rule files in the rules directory.
 * Useful for validation and the CLI --dry-run command.
 */
export function listRuleFiles(): string[] {
  try {
    return fs.readdirSync(RULES_DIR).filter((f) => f.endsWith('.md'));
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
    return !fs.existsSync(filePath);
  });
}
