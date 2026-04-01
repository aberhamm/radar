#!/usr/bin/env node

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { createProvider } from './providers/factory.js';
import { runAgent, type StepEvent } from './agent/runner.js';
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
  .option('--verbose', 'Show real-time agent reasoning and tool calls')
  .option('--json', 'Output summary as JSON (for CI integration)')
  .action(async (opts) => {
    try {
      const exitCode = await handleAnalyze(opts);
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

/**
 * Returns exit code: 0 = green/yellow, 1 = any red category, 2 = agent error
 */
async function handleAnalyze(opts: {
  repo?: string;
  goal?: string;
  platform?: string;
  output: string;
  budget: string;
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
}): Promise<number> {
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
    return 0;
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

  const verbose = opts.verbose ?? false;

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
    verbose,
    onStep: (step) => {
      if (verbose) {
        formatVerboseStep(step);
      } else {
        const truncated = step.result?.slice(0, 60) ?? '';
        console.log(`  [Step ${step.step}] ${step.action} → ${truncated}`);
      }
    },
  });

  // JSON output mode — CI-friendly
  if (opts.json) {
    const summary = {
      status: result.terminationReason,
      score: result.scorecard.overallScore,
      findings: result.state.findings.length,
      toolCalls: result.metrics.toolCalls,
      durationMs: result.metrics.durationMs,
      estimatedCostUsd: result.metrics.totalEstimatedCostUsd,
      outputPaths: result.outputPaths,
      categories: result.scorecard.categories.map((c) => ({
        name: c.category,
        score: c.score,
        findings: c.findings.length,
      })),
      topRisks: result.scorecard.topRisks.map((r) => ({
        id: r.id,
        severity: r.severity,
        title: r.title,
      })),
      ...(result.errorDetail ? { error: result.errorDetail } : {}),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (result.terminationReason === 'error') return 2;
    if (result.scorecard.overallScore === 'red') return 1;
    return 0;
  }

  // Summary
  const isPartial = result.terminationReason !== 'completed';
  if (isPartial) {
    console.log(`\n--- Investigation ${result.terminationReason === 'error' ? 'failed' : 'ended'} (${result.terminationReason}) ---\n`);
    if (result.errorDetail) {
      console.log(`  Error: ${result.errorDetail}`);
    }
    if (result.state.findings.length > 0) {
      console.log(`  Partial output generated with ${result.state.findings.length} findings.`);
    }
  } else {
    console.log(`\n--- Investigation complete ---\n`);
  }
  console.log(`  Tool calls: ${result.metrics.toolCalls}`);
  console.log(`  Findings:   ${result.state.findings.length}`);
  console.log(`  Scorecard:  ${result.scorecard.overallScore.toUpperCase()}`);
  console.log(`  Duration:   ${(result.metrics.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Est. cost:  $${result.metrics.totalEstimatedCostUsd.toFixed(4)}`);

  // Per-model breakdown
  const modelEntries = Object.entries(result.metrics.models);
  if (modelEntries.length > 0) {
    console.log('');
    console.log('  Model breakdown:');
    for (const [modelId, info] of modelEntries) {
      const shortId = modelId.replace('us.anthropic.', '');
      console.log(`    ${shortId}: ${info.calls} calls, ${info.inputTokens.toLocaleString()} in / ${info.outputTokens.toLocaleString()} out, $${info.estimatedCostUsd.toFixed(4)}`);
    }
  }
  console.log('');

  for (const p of result.outputPaths) {
    console.log(`  ✓ ${p}`);
  }
  console.log('');

  // Exit code: 0 = green/yellow, 1 = any red, 2 = error
  if (result.terminationReason === 'error') return 2;
  if (result.scorecard.overallScore === 'red') return 1;
  return 0;
}

// --- Verbose output formatting ---

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const MAGENTA = '\x1b[35m';

function formatVerboseStep(step: StepEvent): void {
  const prefix = `${DIM}[Step ${step.step}]${RESET}`;

  switch (step.type) {
    case 'text_response': {
      console.log(`\n${prefix} ${MAGENTA}${BOLD}Agent thinking:${RESET}`);
      const text = step.fullReasoning ?? step.reasoning ?? '';
      // Wrap at 100 chars for readability
      for (const line of wrapText(text, 100)) {
        console.log(`  ${DIM}${line}${RESET}`);
      }
      break;
    }

    case 'finding': {
      try {
        const parsed = JSON.parse(step.fullResult ?? step.result ?? '{}');
        if (parsed.error) {
          console.log(`${prefix} ${RED}Finding error: ${parsed.error}${RESET}`);
        } else {
          console.log(`${prefix} ${GREEN}${BOLD}FINDING RECORDED: ${parsed.findingId}${RESET} (${parsed.totalFindings} total)`);
          if (step.args) {
            try {
              const args = JSON.parse(step.args);
              const finding = args.finding ?? args;
              if (finding.title) {
                console.log(`  ${BOLD}${finding.severity?.toUpperCase() ?? 'INFO'}:${RESET} ${finding.title}`);
              }
              if (finding.description) {
                const desc = finding.description.slice(0, 200);
                console.log(`  ${DIM}${desc}${desc.length < finding.description.length ? '...' : ''}${RESET}`);
              }
            } catch { /* ignore parse errors */ }
          }
        }
      } catch {
        console.log(`${prefix} ${GREEN}Finding: ${step.result}${RESET}`);
      }
      break;
    }

    case 'assemble_output': {
      console.log(`\n${prefix} ${CYAN}${BOLD}ASSEMBLING OUTPUT${RESET} — ${step.result}`);
      if (step.fullResult) {
        console.log(`  ${DIM}Sections: ${step.fullResult}${RESET}`);
      }
      break;
    }

    case 'budget_warning': {
      console.log(`${prefix} ${YELLOW}${BOLD}${step.result}${RESET}`);
      break;
    }

    default: {
      // Standard tool call
      const toolName = step.action;
      const shortResult = step.result?.slice(0, 80) ?? '';

      // Show reasoning if present and different from previous
      if (step.fullReasoning) {
        const reasoning = step.fullReasoning.trim();
        if (reasoning) {
          console.log(`\n${prefix} ${MAGENTA}${BOLD}Reasoning:${RESET}`);
          for (const line of wrapText(reasoning, 100)) {
            console.log(`  ${DIM}${line}${RESET}`);
          }
        }
      }

      console.log(`${prefix} ${CYAN}${toolName}${RESET} → ${DIM}${shortResult}${RESET}`);

      // In verbose mode, show the tool arguments
      if (step.args) {
        try {
          const args = JSON.parse(step.args);
          const argStr = JSON.stringify(args, null, 0);
          if (argStr.length > 2) { // not just "{}"
            console.log(`  ${DIM}args: ${argStr.slice(0, 120)}${argStr.length > 120 ? '...' : ''}${RESET}`);
          }
        } catch { /* ignore */ }
      }
    }
  }
}

function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split('\n');
  for (const para of paragraphs) {
    if (para.length <= width) {
      lines.push(para);
    } else {
      let remaining = para;
      while (remaining.length > width) {
        const breakAt = remaining.lastIndexOf(' ', width);
        const idx = breakAt > 0 ? breakAt : width;
        lines.push(remaining.slice(0, idx));
        remaining = remaining.slice(idx + 1);
      }
      if (remaining) lines.push(remaining);
    }
  }
  return lines;
}
