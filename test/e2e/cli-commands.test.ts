/**
 * E2e tests: CLI command coverage.
 *
 * Verifies every radar command works against fixture repos without LLM calls.
 * Uses child_process.execSync to spawn the CLI entry point directly.
 *
 * Tests are consolidated to minimize process spawns and keep total runtime
 * under Vitest's internal worker communication timeout (~60s).
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'src/index.ts');
const FIXTURE_REPO = path.resolve(__dirname, '../fixtures/sitecore-minimal');
const FIXTURE_RUN_A = path.resolve(__dirname, '../fixtures/run-output-a.json');
const FIXTURE_RUN_B = path.resolve(__dirname, '../fixtures/run-output-b.json');

/** Run a CLI command and return stdout. Throws on non-zero exit. */
function runCli(args: string, options?: { cwd?: string; timeout?: number }): string {
  const cmd = `npx tsx "${CLI}" ${args}`;
  const result = execSync(cmd, {
    cwd: options?.cwd ?? ROOT,
    timeout: options?.timeout ?? 15_000,
    encoding: 'utf-8',
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result;
}

/** Run a CLI command and return exit code + stdout + stderr. Does not throw on non-zero. */
function runCliRaw(args: string, options?: { cwd?: string; timeout?: number }): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const cmd = `npx tsx "${CLI}" ${args}`;
  try {
    const stdout = execSync(cmd, {
      cwd: options?.cwd ?? ROOT,
      timeout: options?.timeout ?? 15_000,
      encoding: 'utf-8',
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    };
  }
}

describe('CLI: radar analyze --dry-run', () => {
  it('exits 0, prints plan without executing, no output files created', () => {
    const outputDir = path.join(ROOT, 'test/__cli_dryrun_output__');
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true });
    }

    const stdout = runCli(
      `analyze --repo "${FIXTURE_REPO}" --goal onboarding --dry-run --output "${outputDir}"`,
    );

    // Prints configuration plan
    expect(stdout).toContain('Dry Run');
    expect(stdout).toContain('Repo:');
    expect(stdout).toContain('Goal:');
    expect(stdout).toContain('Budget:');
    expect(stdout).toContain('All rules valid');

    // Does not create output files
    expect(fs.existsSync(outputDir)).toBe(false);
  });

  it('works with --goal audit', () => {
    const stdout = runCli(`analyze --repo "${FIXTURE_REPO}" --goal audit --dry-run`);
    expect(stdout).toContain('Goal:     audit');
  });
});

describe('CLI: radar tools', () => {
  it('exits 0 and lists all registered tools (more than 10)', () => {
    const stdout = runCli('tools --list');
    expect(stdout).toContain('Registered tools');
    // Check for some known tools
    expect(stdout).toContain('list_directory');
    expect(stdout).toContain('read_file');
    expect(stdout).toContain('record_finding');
    // Verify count
    const match = stdout.match(/Registered tools \((\d+)\)/);
    expect(match).not.toBeNull();
    const toolCount = parseInt(match![1], 10);
    expect(toolCount).toBeGreaterThan(10);
  });
});

describe('CLI: radar rules --validate', () => {
  it('exits 0, lists rule files, and validates them', () => {
    const stdout = runCli('rules --validate');
    expect(stdout).toContain('Rule files');
    expect(stdout).toContain('.md');
    expect(stdout).toContain('All rules valid');
  });
});

describe('CLI: radar diff', () => {
  it('exits 0 and produces meaningful diff with new, resolved, and persistent findings', () => {
    const stdout = runCli(`diff "${FIXTURE_RUN_A}" "${FIXTURE_RUN_B}"`);

    // Basic structure
    expect(stdout).toContain('Findings Diff');
    expect(stdout).toContain('Previous:');
    expect(stdout).toContain('Current:');
    expect(stdout).toContain('Summary:');

    // Detects new findings (run-b has DEP-001 and PERF-001 that run-a does not)
    expect(stdout).toContain('New:');
    expect(stdout).toContain('React version is one major behind');
    expect(stdout).toContain('No image optimization configured');

    // Detects resolved findings (run-a has ARCH-001 that run-b does not)
    expect(stdout).toContain('Resolved:');
    expect(stdout).toContain('App Router with catch-all route pattern');

    // Reports persistent findings (STACK-001 and SEC-001 are in both)
    expect(stdout).toContain('Persistent:');
    expect(stdout).toContain('2 findings unchanged');
  });

  it('fails gracefully with missing file', () => {
    const result = runCliRaw('diff "nonexistent-a.json" "nonexistent-b.json"');
    expect(result.exitCode).not.toBe(0);
  });
});

describe('CLI: radar compare --dry-run', () => {
  it('exits 0 and shows comparison config with correct goal', () => {
    const stdout = runCli(
      `compare --repos "${FIXTURE_REPO}" "${FIXTURE_REPO}" --goal audit --dry-run`,
    );
    expect(stdout).toContain('Dry Run (compare)');
    expect(stdout).toContain('Repos:');
    expect(stdout).toContain('Goal:     audit');
    expect(stdout).toContain('Budget:');
  });
});

describe('CLI: radar --help', () => {
  it('exits 0 and shows usage info for all commands', () => {
    const stdout = runCli('--help');
    expect(stdout).toContain('radar');
    expect(stdout).toContain('analyze');
    expect(stdout).toContain('compare');
    expect(stdout).toContain('diff');
    expect(stdout).toContain('tools');
    expect(stdout).toContain('rules');
  });
});
