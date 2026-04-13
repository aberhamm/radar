#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPiTools } from './tools/piToolAdapter.js';
import type { AgentState } from './types/state.js';
import { listRuleFiles, validateRules } from './agent/systemPrompt.js';
import type { GoalType } from './types/state.js';
import { handleAnalyze } from './commands/analyze.js';
import { handleAnalyzeAll } from './commands/analyzeAll.js';
import { handleCompare } from './commands/compare.js';
import { handleDiff } from './commands/diff.js';
import { handleGauntlet } from './commands/gauntlet.js';

// Load .env
import 'dotenv/config';

const program = new Command();

program
  .name('radar')
  .description('Radar — agentic consulting tool for headless CMS codebase analysis.\n\nPoint it at a Sitecore XM Cloud or Optimizely SaaS repo and get a scored\nonboarding brief with evidence-backed findings in minutes, not days.')
  .version('1.0.0')
  .addHelpText('after', `
Examples:
  $ radar analyze --repo ./my-sitecore-repo
  $ radar analyze --repo ./my-repo --goal all --budget 100
  $ radar analyze --repo https://github.com/Sitecore/xmcloud-starter-js --verbose
  $ radar compare --repos ./repo-a ./repo-b
  $ radar gauntlet
  $ radar gauntlet --run --repos ./repo-a ./repo-b https://github.com/org/repo
  $ radar tools
  $ radar rules --validate
  $ radar dashboard --port 3001
`);

program
  .command('analyze')
  .description('Run an agentic investigation on a repository')
  .option('--repo <path>', 'Repository URL or local path')
  .option('--goal <type>', 'Analysis goal: onboarding, audit, audit-generic, migration, component-map, ci-check, security-review, nextjs, accessibility, all')
  .option('--platform <name>', 'Platform override: sitecore, optimizely (auto-detected if omitted)')
  .option('--output <dir>', 'Output directory', './output')
  .option('--budget <n>', 'Tool call budget (default: 150 for all, 45 for single goal)')
  .option('--dry-run', 'Show configuration without running')
  .option('--verbose', 'Show real-time agent reasoning and tool calls')
  .option('--json', 'Output summary as JSON (for CI integration)')
  .option('--export', 'Output full JSON export to stdout')
  .option('--github-output', 'Post results to GitHub (issue or PR comment)')
  .option('--pr <number>', 'PR number for ci-check goal comments', parseInt)
  .option('--resume <path>', 'Resume from a checkpoint file (path to .jsonl)')
  .option('--checkpoint-interval <n>', 'Save checkpoint every N tool calls (0 to disable)', '5')
  .action(async (opts) => {
    try {
      // Apply goal-appropriate default budget if user didn't specify
      if (!opts.budget) {
        opts.budget = opts.goal === 'all' ? '150' : '45';
      }
      const handler = opts.goal === 'all' ? handleAnalyzeAll : handleAnalyze;
      const exitCode = await handler(opts);
      if (exitCode !== 0) process.exit(exitCode);
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`);
      process.exit(2);
    }
  });

program
  .command('tools')
  .description('List registered tools')
  .option('--list', 'Show all tools')
  .action(() => {
    // Use a minimal state just for tool introspection
    const dummyState: AgentState = {
      goal: 'onboarding', repo: { source: 'local', localPath: '.', name: 'introspection' },
      resolvedVersions: {}, findings: [], filesRead: new Set(),
      toolCallCount: 0, toolCallBudget: 0, webSearchCount: 0, webSearchBudget: 0,
      urlFetchCount: 0, urlFetchBudget: 0, docTokensUsed: 0, docTokenBudget: 0,
      fetchedDocs: [], investigationLog: [], modelUsage: new Map(),
      fileReadCache: new Map(),
    };
    const { tools } = buildPiTools(dummyState);
    console.log(`\nRegistered tools (${tools.length}):\n`);
    for (const tool of tools) {
      console.log(`  ${tool.name}`);
      console.log(`    ${tool.description}`);
      console.log('');
    }
  });

program
  .command('rules')
  .description('Validate consulting rule files')
  .option('--validate', 'Check all expected rule files exist')
  .action(() => {
    const files = listRuleFiles();
    console.log(`\nRule files (${files.length}):\n`);
    for (const f of files) {
      console.log(`  ${f}`);
    }

    // Validate for all goal/platform combos
    const goals: GoalType[] = ['onboarding', 'audit', 'migration'];
    const platforms = ['sitecore', 'optimizely', 'unknown'];
    let allValid = true;

    for (const goal of goals) {
      for (const platform of platforms) {
        const missing = validateRules(goal, platform);
        if (missing.length > 0) {
          console.log(`\n  Missing for ${goal}/${platform}: ${missing.join(', ')}`);
          allValid = false;
        }
      }
    }

    if (allValid) {
      console.log('\n  All rules valid.');
    }
  });

program
  .command('compare')
  .description('Run side-by-side comparison of two repositories')
  .requiredOption('--repos <paths...>', 'Two repository paths or URLs to compare')
  .option('--goal <type>', 'Analysis goal: onboarding, audit, audit-generic, migration, component-map, ci-check, security-review, nextjs, accessibility', 'onboarding')
  .option('--platform <name>', 'Platform override: sitecore, optimizely (auto-detected if omitted)')
  .option('--output <dir>', 'Output directory', './output')
  .option('--budget <n>', 'Tool call budget per repo', '45')
  .option('--verbose', 'Show real-time agent reasoning and tool calls')
  .action(async (opts) => {
    try {
      const exitCode = await handleCompare(opts);
      if (exitCode !== 0) process.exit(exitCode);
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`);
      process.exit(2);
    }
  });

program
  .command('diff')
  .description('Compare findings between two runs')
  .argument('<run-a>', 'Path to previous findings JSON file')
  .argument('<run-b>', 'Path to current findings JSON file')
  .action((runA: string, runB: string) => {
    const exitCode = handleDiff({ runA, runB });
    if (exitCode !== 0) process.exit(exitCode);
  });

program
  .command('gauntlet')
  .description('Run quality gauntlet across repos and goals, or view results')
  .option('--run', 'Run the gauntlet (default: just print existing results)')
  .option('--repos <paths...>', 'Repository paths or GitHub URLs to test')
  .option('--goals <types>', 'Comma-separated goal types (default: onboarding,audit,security-review)')
  .option('--budget <n>', 'Tool call budget per run', '45')
  .option('--verbose', 'Show real-time agent reasoning and tool calls')
  .option('--clear', 'Clear existing gauntlet results')
  .action(async (opts) => {
    try {
      const exitCode = await handleGauntlet(opts);
      if (exitCode !== 0) process.exit(exitCode);
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`);
      process.exit(2);
    }
  });

program
  .command('dashboard')
  .description('Start the dashboard UI and open in browser')
  .option('--port <port>', 'Port for the dashboard', '3000')
  .action(async (options) => {
    const port = parseInt(options.port, 10);
    const dashboardDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dashboard');

    // Check if dashboard directory exists
    if (!fs.existsSync(dashboardDir)) {
      console.error('Dashboard directory not found at:', dashboardDir);
      console.error('Run: cd dashboard && pnpm install');
      process.exit(1);
    }

    console.log(`Starting dashboard on port ${port}...`);

    // Clean stale Turbopack dev cache to prevent 500 on cold start
    const dotNextDev = path.join(dashboardDir, '.next', 'dev');
    if (fs.existsSync(dotNextDev)) {
      fs.rmSync(dotNextDev, { recursive: true, force: true });
    }

    // Spawn next dev as a child process
    const child = spawn('npx', ['next', 'dev', '--port', String(port)], {
      cwd: dashboardDir,
      stdio: 'inherit',
      shell: true,
    });

    child.on('error', (err) => {
      console.error('Failed to start dashboard:', err.message);
      process.exit(1);
    });

    // Open browser immediately — webpack compiles on first request,
    // so the browser will show the loading state while it compiles.
    const url = `http://localhost:${port}`;

    // Wait briefly for the server process to bind the port
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log(`Opening ${url} in browser...`);
    const openCmd = process.platform === 'win32' ? 'start'
      : process.platform === 'darwin' ? 'open'
      : 'xdg-open';
    spawn(openCmd, [url], { shell: true, detached: true });

    console.log('Dashboard running. Press Ctrl+C to stop.');

    // Keep process alive
    process.on('SIGINT', () => {
      child.kill();
      process.exit(0);
    });
  });

program.parse();
