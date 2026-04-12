import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { runAgent } from '../agent/runner.js';
import { buildSystemPrompt, listRuleFiles, validateRules } from '../agent/systemPrompt.js';
import { buildGoalPrompt } from '../agent/goalPrompts.js';
import { cloneRepo } from '../tools/repo/cloneRepo.js';
import { queryNpmVersions, TRACKED_PACKAGES } from '../tools/dependency/queryNpmVersions.js';
import { formatVerboseStep } from '../output/verboseFormatter.js';
import { detectCiPlatform } from '../ci/adapter.js';
import { orchestrateCi } from '../ci/orchestrator.js';
import type { GoalType } from '../types/state.js';

/**
 * Returns exit code: 0 = green/yellow, 1 = any red category, 2 = agent error
 */
export async function handleAnalyze(opts: {
  repo?: string;
  goal?: string;
  platform?: string;
  output: string;
  budget: string;
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
  export?: boolean;
  githubOutput?: boolean;
  pr?: number;
  resume?: string;
  checkpointInterval?: string;
}): Promise<number> {
  const repoInput = opts.repo;
  if (!repoInput) {
    throw new Error('--repo is required. Pass a local path or GitHub URL.');
  }

  const goal = (opts.goal ?? 'onboarding') as GoalType;
  const validGoals = ['onboarding', 'audit', 'audit-generic', 'migration', 'component-map', 'ci-check', 'security-review', 'nextjs', 'accessibility'];
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
    console.log(`Tools: 20 registered`);
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

  // Run agent
  console.log(`\nStarting investigation (goal: ${goal}, budget: ${budget})...\n`);

  const verbose = opts.verbose ?? false;

  // Budget extension callback — interactive prompt for TTY, auto-assemble for CI
  const isInteractive = process.stdin.isTTY && !opts.json;
  const onBudgetExhausted = isInteractive
    ? async (state: { findings: number; toolCalls: number; budget: number }) => {
        const answer = await askYesNo(
          `\n  Budget reached (${state.toolCalls} calls, ${state.findings} findings). Continue for 50 more? [y/N] `,
        );
        return answer;
      }
    : undefined;

  const result = await runAgent({
    repoPath,
    repoName,
    repoSource,
    repoUrl,
    goal,
    platform: platform !== 'unknown' ? platform : undefined,
    toolCallBudget: budget,
    outputDir,
    verbose,
    onBudgetExhausted,
    resumeFrom: opts.resume,
    checkpointInterval: opts.checkpointInterval ? parseInt(opts.checkpointInterval, 10) : undefined,
    onStep: (step) => {
      if (verbose) {
        formatVerboseStep(step);
      } else {
        const truncated = step.result?.slice(0, 60) ?? '';
        console.log(`  [Step ${step.step}] ${step.action} → ${truncated}`);
      }
    },
  });

  // Full export mode — output complete JSON export to stdout
  if (opts.export) {
    console.log(result.exportJson);
    if (result.terminationReason === 'error') return 2;
    if (result.scorecard.overallScore === 'red') return 1;
    return 0;
  }

  // CI integration — runs after agent completes, before exit code decision
  const ciAdapter = await detectCiPlatform();
  let ciOperations: Array<{ operation: string; status: string; error?: string }> = [];

  if (ciAdapter.platform !== 'generic') {
    ciOperations = await orchestrateCi(
      {
        scorecard: result.scorecard,
        metrics: result.metrics,
        findings: result.state.findings,
        outputDir,
        repoName,
      },
      ciAdapter,
    );
  }

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
      ...(ciOperations.length > 0 ? { ciOperations } : {}),
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
  // Show checkpoint path if one was written
  const checkpointFile = path.join(outputDir, `${repoName.replace(/[^a-zA-Z0-9_-]/g, '-')}-checkpoint.jsonl`);
  if (fs.existsSync(checkpointFile)) {
    console.log(`  📎 Checkpoint: ${checkpointFile} (use --resume to continue)`);
  }

  // CI operations summary
  if (ciOperations.length > 0) {
    console.log('');
    console.log('  CI operations:');
    for (const op of ciOperations) {
      const icon = op.status === 'success' ? '✓' : op.status === 'skipped' ? '○' : '✗';
      console.log(`    ${icon} ${op.operation}${op.error ? ` (${op.error})` : ''}`);
    }
  }
  console.log('');

  // Exit code: 0 = green/yellow, 1 = any red, 2 = error
  if (result.terminationReason === 'error') return 2;
  if (result.scorecard.overallScore === 'red') return 1;
  return 0;
}

function askYesNo(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}
