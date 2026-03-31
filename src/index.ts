#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { createProvider } from './providers/factory.js';
import { runAgent } from './agent/runner.js';
import { buildSystemPrompt, listRuleFiles, validateRules } from './agent/systemPrompt.js';
import { buildGoalPrompt } from './agent/goalPrompts.js';
import { getToolDefinitions } from './tools/registry.js';
import { cloneRepo } from './tools/repo/cloneRepo.js';
import { queryNpmVersions, TRACKED_PACKAGES } from './tools/dependency/queryNpmVersions.js';
import type { GoalType } from './types/state.js';

// Load .env
import 'dotenv/config';

const program = new Command();

program
  .name('repo-audit-delivery-agent')
  .description('Agentic consulting tool for headless CMS codebase analysis')
  .version('1.0.0');

program
  .command('analyze')
  .description('Run an agentic investigation on a repository')
  .option('--repo <path>', 'Repository URL or local path')
  .option('--goal <type>', 'Analysis goal: onboarding, audit, migration, component-map, ci-check')
  .option('--platform <name>', 'Platform override: sitecore, optimizely (auto-detected if omitted)')
  .option('--output <dir>', 'Output directory', './output')
  .option('--budget <n>', 'Tool call budget', '50')
  .option('--dry-run', 'Show configuration without running')
  .action(async (opts) => {
    try {
      await handleAnalyze(opts);
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command('tools')
  .description('List registered tools')
  .option('--list', 'Show all tools')
  .action(() => {
    const defs = getToolDefinitions();
    console.log(`\nRegistered tools (${defs.length}):\n`);
    for (const def of defs) {
      const params = Object.keys(
        (def.function.parameters as Record<string, unknown>).properties ?? {},
      );
      console.log(`  ${def.function.name}`);
      console.log(`    ${def.function.description}`);
      console.log(`    params: ${params.join(', ') || '(none)'}`);
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

program.parse();

async function handleAnalyze(opts: {
  repo?: string;
  goal?: string;
  platform?: string;
  output: string;
  budget: string;
  dryRun?: boolean;
}) {
  const repoInput = opts.repo;
  if (!repoInput) {
    throw new Error('--repo is required. Pass a local path or GitHub URL.');
  }

  const goal = (opts.goal ?? 'onboarding') as GoalType;
  const validGoals = ['onboarding', 'audit', 'migration', 'component-map', 'ci-check'];
  if (!validGoals.includes(goal)) {
    throw new Error(`Invalid goal: ${goal}. Valid: ${validGoals.join(', ')}`);
  }

  const budget = parseInt(opts.budget, 10);
  const platform = opts.platform ?? 'unknown';
  const outputDir = opts.output;

  // Resolve repo path
  let repoPath: string;
  let repoName: string;
  let repoSource: 'github' | 'local';
  let repoUrl: string | undefined;

  if (repoInput.startsWith('http://') || repoInput.startsWith('https://')) {
    // Remote repo — clone it
    console.log(`Cloning ${repoInput}...`);
    const cloneResult = await cloneRepo({ url: repoInput });
    repoPath = cloneResult.localPath;
    repoName = repoInput.split('/').pop()?.replace('.git', '') ?? 'unknown';
    repoSource = 'github';
    repoUrl = repoInput;
    console.log(`  Cloned to ${repoPath} (${cloneResult.defaultBranch}, ${cloneResult.lastCommit.hash.slice(0, 7)})`);
  } else {
    // Local repo
    repoPath = path.resolve(repoInput);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository path not found: ${repoPath}`);
    }
    repoName = path.basename(repoPath);
    repoSource = 'local';
  }

  // Dry run — show config and exit
  if (opts.dryRun) {
    console.log('\n--- Dry Run ---\n');
    console.log(`Repo:     ${repoPath}`);
    console.log(`Goal:     ${goal}`);
    console.log(`Platform: ${platform}`);
    console.log(`Budget:   ${budget} tool calls`);
    console.log(`Output:   ${outputDir}`);
    console.log(`\nSystem prompt (${buildSystemPrompt(goal, platform).length} chars)`);
    console.log(`Goal prompt (${buildGoalPrompt(goal, repoPath, budget, 5).length} chars)`);
    console.log(`Tools: ${getToolDefinitions().length} registered`);
    console.log(`Rules: ${listRuleFiles().length} files`);
    const missing = validateRules(goal, platform);
    if (missing.length > 0) {
      console.log(`\nMissing rules: ${missing.join(', ')}`);
    } else {
      console.log('\nAll rules valid.');
    }
    return;
  }

  // Resolve npm versions
  console.log('Resolving npm versions...');
  const npmResult = await queryNpmVersions({ packages: TRACKED_PACKAGES });
  const versionCount = Object.keys(npmResult.versions).length;
  console.log(
    `  ${versionCount} packages resolved${npmResult.fromCache ? ` (cached, ${npmResult.cacheAge})` : ''}`,
  );

  // Create provider
  const provider = createProvider();
  console.log(`Provider: ${provider.name}`);

  // Run agent
  console.log(`\nStarting investigation (goal: ${goal}, budget: ${budget})...\n`);

  const result = await runAgent({
    provider,
    repoPath,
    repoName,
    repoSource,
    repoUrl,
    goal,
    platform: platform !== 'unknown' ? platform : undefined,
    toolCallBudget: budget,
    outputDir,
    onStep: (step) => {
      const truncated = step.result?.slice(0, 60) ?? '';
      console.log(`  [Step ${step.step}] ${step.action} → ${truncated}`);
    },
  });

  // Summary
  console.log(`\n--- Investigation complete ---\n`);
  console.log(`  Tool calls: ${result.metrics.toolCalls}`);
  console.log(`  Findings:   ${result.state.findings.length}`);
  console.log(`  Scorecard:  ${result.scorecard.overallScore.toUpperCase()}`);
  console.log(`  Duration:   ${(result.metrics.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Est. cost:  $${result.metrics.totalEstimatedCostUsd.toFixed(4)}`);
  console.log('');

  for (const p of result.outputPaths) {
    console.log(`  ✓ ${p}`);
  }
  console.log('');
}
