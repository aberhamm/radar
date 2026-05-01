/**
 * Universal analysis command — runs tiered investigation (core + specialists),
 * scores all 8 goals from the same findings pool, writes per-goal briefs in parallel.
 */

import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { runAgent, runPreCompute, writeOutputFiles, type RunResult } from '../agent/runner.js';
import { planBudget, rebalanceBudget, planClusterBudget, type ClusterAllocation } from '../agent/budgetPlanner.js';
import { buildClusterPrompt } from '../agent/goalPrompts.js';
import { runSynthesis } from '../agent/synthesisRunner.js';
import { cloneRepo } from '../tools/repo/cloneRepo.js';
import { queryNpmVersions, TRACKED_PACKAGES } from '../tools/dependency/queryNpmVersions.js';
import { formatVerboseStep } from '../output/verboseFormatter.js';
import { computeScorecard } from '../output/scorecard.js';
import { renderBrief } from '../output/brief.js';
import { buildFullExport, serializeExport } from '../output/json.js';
import { writeAllBriefs } from '../output/goalBriefWriter.js';
import {
  renderMultiGoalSummary,
  type MultiGoalResult,
  type MultiGoalMetrics,
} from '../output/multiGoalSummary.js';
import { persistRunToTieredStorage } from '../output/runPersistence.js';
import { deduplicateFindings } from '../tools/analysis/deduplicateFindings.js';
import { ALL_GOALS, type GoalType, type AgentState } from '../types/state.js';
import type { Scorecard } from '../types/output.js';

interface PassResult {
  pass: string;
  budget: number;
  result?: RunResult;
  error?: string;
  durationMs: number;
}

export async function handleAnalyzeAll(opts: {
  repo?: string;
  platform?: string;
  output: string;
  budget: string;
  goals?: GoalType[];
  dryRun?: boolean;
  verbose?: boolean;
  json?: boolean;
  export?: boolean;
  parallel?: boolean;
}): Promise<number> {
  const repoInput = opts.repo;
  if (!repoInput) {
    throw new Error('--repo is required. Pass a local path or GitHub URL.');
  }

  const totalBudget = parseInt(opts.budget, 10);
  if (totalBudget < 15) {
    throw new Error(`Budget ${totalBudget} is too low for --goal all. Minimum: 15.`);
  }

  const selectedGoals = opts.goals ?? ALL_GOALS;
  const platform = opts.platform ?? 'unknown';
  const outputDir = path.join(opts.output, 'all');
  const verbose = opts.verbose ?? false;

  // Resolve repo
  let repoPath: string;
  let repoName: string;
  let repoSource: 'github' | 'local';
  let repoUrl: string | undefined;

  if (repoInput.startsWith('http://') || repoInput.startsWith('https://')) {
    console.log(`Cloning ${repoInput}...`);
    const cloneResult = await cloneRepo({ url: repoInput });
    repoPath = cloneResult.localPath;
    repoName = repoInput.split('/').pop()?.replace('.git', '') ?? 'unknown';
    repoSource = 'github';
    repoUrl = repoInput;
    console.log(
      `  Cloned to ${repoPath} (${cloneResult.defaultBranch}, ${cloneResult.lastCommit.hash.slice(0, 7)})`,
    );
  } else {
    repoPath = path.resolve(repoInput);
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository path not found: ${repoPath}`);
    }
    repoName = path.basename(repoPath);
    repoSource = 'local';
  }

  // Dry run — show config and exit
  if (opts.dryRun) {
    console.log(`\n--- Dry Run (${selectedGoals.length} goals) ---\n`);
    console.log(`Repo:     ${repoPath}`);
    console.log(`Goals:    ${selectedGoals.join(', ')}`);
    console.log(`Platform: ${platform}`);
    console.log(`Budget:   ${totalBudget} tool calls (split across core + specialist passes)`);
    console.log(`Output:   ${outputDir}`);
    return 0;
  }

  // Resolve npm versions (shared across all passes)
  console.log('Resolving npm versions...');
  const npmResult = await queryNpmVersions({ packages: TRACKED_PACKAGES });
  console.log(
    `  ${Object.keys(npmResult.versions).length} packages resolved${npmResult.fromCache ? ` (cached, ${npmResult.cacheAge})` : ''}`,
  );

  // Pre-compute repo signals for budget planning (also reused by core pass)
  console.log('Pre-computing repo signals...');
  const preCompute = await runPreCompute(repoPath);

  // ─── Parallel dispatch (opt-in via --parallel) ─────────────────────
  if (opts.parallel) {
    return handleParallelDispatch(opts, {
      repoPath, repoName, repoSource, repoUrl,
      totalBudget, selectedGoals, platform, outputDir, verbose,
      preCompute,
    });
  }

  // ─── Sequential dispatch (default: core → nextjs → a11y) ──────────
  // Budget allocation — deterministic plan based on detected repo signals
  const plan = planBudget(totalBudget, preCompute);
  const coreBudget = plan.passes[0].budget;
  let nextjsBudget = plan.passes[1].budget;
  let a11yBudget = plan.passes[2].budget;
  let skipNextjs = plan.passes[1].skip;
  let skipA11y = plan.passes[2].skip;

  const budgetSummary = plan.passes.map(p => p.skip ? `${p.name}: skip` : `${p.name}: ${p.budget}`).join(', ');
  console.log(`\nBudget plan: ${budgetSummary} (total: ${totalBudget})`);
  for (const p of plan.passes) {
    console.log(`  ${p.name}: ${p.reason}`);
  }
  console.log('');

  const parentRunId = crypto.randomUUID();
  const passResults: PassResult[] = [];
  let sharedState: Partial<AgentState> | undefined;
  const allInvestigationLogs: AgentState['investigationLog'] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEvents: Array<Record<string, any>> = [];

  // Budget extension callback — interactive prompt for TTY, skip for CI/JSON
  const isInteractive = process.stdin.isTTY && !opts.json;
  const onBudgetExhausted = isInteractive
    ? async (state: { findings: number; toolCalls: number; budget: number }) => {
        const answer = await askYesNo(
          `\n  Budget reached (${state.toolCalls} calls, ${state.findings} findings). Continue for 50 more? [y/N] `,
        );
        return answer;
      }
    : undefined;

  // Emit budget plan event
  allEvents.push({
    step: -1,
    action: 'budget_plan',
    result: JSON.stringify({ passes: plan.passes, signals: plan.signals }),
    timestamp: new Date().toISOString(),
  });

  // --- Pass 1: Core investigation ---
  const coreStart = Date.now();
  console.log(`[Core] Starting investigation (budget: ${coreBudget})...`);
  try {
    const coreResult = await runAgent({
      repoPath,
      repoName,
      repoSource,
      repoUrl,
      goal: 'universal' as GoalType, // Universal rules: broad investigation + aggressive recording
      platform: platform !== 'unknown' ? platform : undefined,
      toolCallBudget: coreBudget,
      outputDir,
      verbose,
      preCompute, // Reuse pre-computed signals — avoids redundant filesystem scans
      onBudgetExhausted,
      onStep: (step) => {
        allEvents.push(step);
        if (verbose) formatVerboseStep(step, '[Core]');
        else if (step.type !== 'text_delta' && step.type !== 'tool_start' && step.type !== 'finding_progress') console.log(`  [Core] [Step ${step.step}] ${step.action} → ${step.result?.slice(0, 60) ?? ''}`);
      },
    });
    const coreDuration = Date.now() - coreStart;
    passResults.push({ pass: 'Core', budget: coreBudget, result: coreResult, durationMs: coreDuration });
    allInvestigationLogs.push(...coreResult.state.investigationLog);
    sharedState = {
      findings: coreResult.state.findings,
      filesRead: coreResult.state.filesRead,
      fileReadCache: coreResult.state.fileReadCache,
      resolvedVersions: coreResult.state.resolvedVersions,
      stackProfile: coreResult.state.stackProfile,
      fetchedDocs: coreResult.state.fetchedDocs,
      modelUsage: coreResult.state.modelUsage,
    };
    allEvents.push({ step: -1, action: 'pass_complete', result: JSON.stringify({ pass: 'Core', toolCalls: coreResult.metrics.toolCalls, budget: coreBudget, terminationReason: coreResult.terminationReason }), timestamp: new Date().toISOString() });
    console.log(`[Core] Done: ${coreResult.state.findings.length} findings, ${coreResult.metrics.toolCalls}/${coreBudget} calls, ${(coreDuration / 1000).toFixed(1)}s`);
  } catch (err) {
    const coreDuration = Date.now() - coreStart;
    passResults.push({ pass: 'Core', budget: coreBudget, error: (err as Error).message, durationMs: coreDuration });
    console.error(`[Core] Failed: ${(err as Error).message}`);
    // Core failure is fatal
    return 2;
  }

  // --- Post-core rebalance ---
  const corePassResult = passResults[0]?.result;
  if (corePassResult) {
    const rebalance = rebalanceBudget(plan, corePassResult);
    nextjsBudget = rebalance.adjustedPasses[1].budget;
    a11yBudget = rebalance.adjustedPasses[2].budget;
    skipNextjs = rebalance.adjustedPasses[1].skip;
    skipA11y = rebalance.adjustedPasses[2].skip;

    allEvents.push({
      step: -1,
      action: 'budget_rebalance',
      result: JSON.stringify({
        adjustedPasses: rebalance.adjustedPasses.map(p => ({ name: p.name, budget: p.budget, skip: p.skip, reason: p.reason })),
        coreUtilization: rebalance.coreUtilization,
        adjustmentReasons: rebalance.adjustmentReasons,
      }),
      timestamp: new Date().toISOString(),
    });

    if (rebalance.adjustmentReasons[0] !== 'No adjustments needed — plan holds') {
      console.log(`\nRebalanced: ${rebalance.adjustmentReasons.join('; ')}`);
    }
  }

  // --- Pass 2 & 3: Specialist passes (parallel when both active) ---
  // Both specialists start from Core's shared state snapshot. They investigate
  // independently, so we run them concurrently and merge findings afterward.
  const coreSharedState = { ...sharedState };

  const specialistTasks: Array<Promise<{ pass: string; budget: number; result?: RunResult; error?: string; durationMs: number }>> = [];

  if (!skipNextjs && nextjsBudget > 0) {
    allEvents.push({ step: -1, action: 'pass_boundary', result: 'Next.js Specialist', timestamp: new Date().toISOString() });
    console.log(`\n[Next.js] Starting specialist pass (budget: ${nextjsBudget})...`);
    specialistTasks.push((async () => {
      const nextjsStart = Date.now();
      try {
        const nextjsResult = await runAgent({
          repoPath,
          repoName,
          repoSource,
          repoUrl,
          goal: 'nextjs' as GoalType,
          platform: platform !== 'unknown' ? platform : undefined,
          toolCallBudget: nextjsBudget,
          outputDir,
          verbose,
          initialState: coreSharedState,
          preCompute,
          onBudgetExhausted,
          onStep: (step) => {
            allEvents.push(step);
            if (verbose) formatVerboseStep(step, '[Next.js]');
            else if (step.type !== 'text_delta' && step.type !== 'tool_start' && step.type !== 'finding_progress') console.log(`  [Next.js] [Step ${step.step}] ${step.action} → ${step.result?.slice(0, 60) ?? ''}`);
          },
        });
        const nextjsDuration = Date.now() - nextjsStart;
        allInvestigationLogs.push(...nextjsResult.state.investigationLog);
        allEvents.push({ step: -1, action: 'pass_complete', result: JSON.stringify({ pass: 'Next.js Specialist', toolCalls: nextjsResult.metrics.toolCalls, budget: nextjsBudget, terminationReason: nextjsResult.terminationReason }), timestamp: new Date().toISOString() });
        console.log(`[Next.js] Done: ${nextjsResult.state.findings.length} total findings, ${nextjsResult.metrics.toolCalls}/${nextjsBudget} calls`);
        return { pass: 'Next.js Specialist', budget: nextjsBudget, result: nextjsResult, durationMs: nextjsDuration };
      } catch (err) {
        const nextjsDuration = Date.now() - nextjsStart;
        console.warn(`[Next.js] Specialist failed (graceful degradation): ${(err as Error).message}`);
        return { pass: 'Next.js Specialist', budget: nextjsBudget, error: (err as Error).message, durationMs: nextjsDuration };
      }
    })());
  } else {
    console.log(`\n[Next.js] Skipped — ${plan.passes[1].reason}`);
    passResults.push({ pass: 'Next.js Specialist', budget: 0, durationMs: 0 });
    allEvents.push({ step: -1, action: 'pass_boundary', result: 'Next.js Specialist (skipped)', timestamp: new Date().toISOString() });
  }

  if (!skipA11y && a11yBudget > 0) {
    allEvents.push({ step: -1, action: 'pass_boundary', result: 'Accessibility Specialist', timestamp: new Date().toISOString() });
    console.log(`\n[A11y] Starting specialist pass (budget: ${a11yBudget})...`);
    specialistTasks.push((async () => {
      const a11yStart = Date.now();
      try {
        const a11yResult = await runAgent({
          repoPath,
          repoName,
          repoSource,
          repoUrl,
          goal: 'accessibility' as GoalType,
          platform: platform !== 'unknown' ? platform : undefined,
          toolCallBudget: a11yBudget,
          outputDir,
          verbose,
          initialState: coreSharedState,
          preCompute,
          onBudgetExhausted,
          onStep: (step) => {
            allEvents.push(step);
            if (verbose) formatVerboseStep(step, '[A11y]');
            else if (step.type !== 'text_delta' && step.type !== 'tool_start' && step.type !== 'finding_progress') console.log(`  [A11y] [Step ${step.step}] ${step.action} → ${step.result?.slice(0, 60) ?? ''}`);
          },
        });
        const a11yDuration = Date.now() - a11yStart;
        allInvestigationLogs.push(...a11yResult.state.investigationLog);
        allEvents.push({ step: -1, action: 'pass_complete', result: JSON.stringify({ pass: 'Accessibility Specialist', toolCalls: a11yResult.metrics.toolCalls, budget: a11yBudget, terminationReason: a11yResult.terminationReason }), timestamp: new Date().toISOString() });
        console.log(`[A11y] Done: ${a11yResult.state.findings.length} total findings, ${a11yResult.metrics.toolCalls}/${a11yBudget} calls`);
        return { pass: 'Accessibility Specialist', budget: a11yBudget, result: a11yResult, durationMs: a11yDuration };
      } catch (err) {
        const a11yDuration = Date.now() - a11yStart;
        console.warn(`[A11y] Specialist failed (graceful degradation): ${(err as Error).message}`);
        return { pass: 'Accessibility Specialist', budget: a11yBudget, error: (err as Error).message, durationMs: a11yDuration };
      }
    })());
  } else {
    console.log(`\n[A11y] Skipped — ${plan.passes[2].reason}`);
    passResults.push({ pass: 'Accessibility Specialist', budget: 0, durationMs: 0 });
    allEvents.push({ step: -1, action: 'pass_boundary', result: 'Accessibility Specialist (skipped)', timestamp: new Date().toISOString() });
  }

  // Await all specialist passes in parallel
  const specialistResults = await Promise.all(specialistTasks);
  passResults.push(...specialistResults);

  // Merge findings from all successful specialist passes with Core's findings.
  // Use a Set of finding IDs to avoid duplicates (Core findings are included in
  // each specialist's output since they start from Core's state).
  const seenFindingIds = new Set<string>();
  const mergedFindings = [];
  for (const pr of [passResults[0], ...specialistResults]) {
    if (!pr?.result) continue;
    for (const f of pr.result.state.findings) {
      if (!seenFindingIds.has(f.id)) {
        seenFindingIds.add(f.id);
        mergedFindings.push(f);
      }
    }
  }

  // Semantic dedup across the merged pool (catches cross-pass near-duplicates)
  const dedupResult = deduplicateFindings(mergedFindings);
  if (dedupResult.mergedCount > 0) {
    console.log(`  Deduplication: merged ${dedupResult.mergedCount} duplicate finding(s). ${dedupResult.findings.length} retained.`);
    mergedFindings.length = 0;
    mergedFindings.push(...dedupResult.findings);
  }

  // Build merged shared state from last successful specialist (or Core)
  const lastSpecialist = specialistResults.filter(p => p.result).pop();
  const stateSource = lastSpecialist?.result ?? passResults[0]?.result;
  if (stateSource) {
    sharedState = {
      findings: mergedFindings,
      filesRead: stateSource.state.filesRead,
      fileReadCache: stateSource.state.fileReadCache,
      resolvedVersions: stateSource.state.resolvedVersions,
      stackProfile: stateSource.state.stackProfile,
      fetchedDocs: stateSource.state.fetchedDocs,
      modelUsage: stateSource.state.modelUsage,
    };
  }

  // Collect all findings
  const allSuccessful = passResults.filter((p) => p.result);
  if (allSuccessful.length === 0) {
    console.error('No passes succeeded.');
    return 2;
  }
  const lastSuccessful = allSuccessful[allSuccessful.length - 1] as { result: RunResult } & typeof allSuccessful[0];
  const allFindings = mergedFindings;

  // --- Phase 5: Multi-goal scoring ---
  console.log(`\nScoring ${selectedGoals.length} goals from ${allFindings.length} findings...`);
  const scorecards = new Map<GoalType, Scorecard>();
  const multiGoalResults: MultiGoalResult[] = [];

  await Promise.all(selectedGoals.map(async (goal) => {
    const scorecard = computeScorecard(repoName, goal, allFindings);
    scorecards.set(goal, scorecard);
    multiGoalResults.push({ goal, scorecard });
    console.log(`  ${goal}: ${scorecard.overallScore.toUpperCase()} (${scorecard.categories.length} categories)`);
  }));

  // --- Phase 6: Per-goal brief writing (parallel) ---
  console.log('\nWriting per-goal briefs...');
  const briefResults = await writeAllBriefs(selectedGoals, allFindings, scorecards);
  for (const br of briefResults) {
    if (br.error) {
      console.warn(`  ${br.goal}: brief failed — ${br.error}`);
    } else {
      console.log(`  ${br.goal}: ${Object.keys(br.sections).length} sections`);
    }
  }

  // --- Phase 7: Write output files ---
  fs.mkdirSync(outputDir, { recursive: true });
  const allOutputPaths: string[] = [];

  // Per-goal output
  for (const goal of selectedGoals) {
    const goalDir = path.join(outputDir, goal);
    fs.mkdirSync(goalDir, { recursive: true });

    const scorecard = scorecards.get(goal)!;
    const briefResult = briefResults.find((b) => b.goal === goal);
    const sections = briefResult?.sections ?? {};

    const briefMarkdown = renderBrief(
      scorecard,
      sections,
      allInvestigationLogs,
      lastSuccessful.result.state.fetchedDocs,
      passResults.reduce((sum, p) => sum + (p.result?.metrics.toolCalls ?? 0), 0),
      totalBudget,
      lastSuccessful.result.metrics,
    );

    // Update the multiGoalResult with brief path
    const mgResult = multiGoalResults.find((r) => r.goal === goal);
    if (mgResult) mgResult.briefPath = `./${goal}/brief.md`;

    const goalState: AgentState = {
      ...lastSuccessful.result.state,
      goal,
      investigationLog: allInvestigationLogs,
    };

    const fullExport = buildFullExport(
      goalState,
      scorecard,
      sections,
      lastSuccessful.result.metrics,
      lastSuccessful.result.terminationReason,
      totalBudget,
    );

    const scorecardPath = path.join(goalDir, 'scorecard.json');
    fs.writeFileSync(scorecardPath, JSON.stringify(scorecard, null, 2), 'utf-8');
    allOutputPaths.push(scorecardPath);

    const briefPath = path.join(goalDir, 'brief.md');
    fs.writeFileSync(briefPath, briefMarkdown, 'utf-8');
    allOutputPaths.push(briefPath);

    const exportPath = path.join(goalDir, 'export.json');
    fs.writeFileSync(exportPath, serializeExport(fullExport), 'utf-8');
    allOutputPaths.push(exportPath);
  }

  // --- Phase 7b: Persist to tiered storage (output/runs/) for dashboard ---
  const runsDir = path.join(path.dirname(outputDir), 'runs');
  const startedAt = lastSuccessful.result.metrics.startedAt;
  const completedAt = new Date().toISOString();

  for (const goal of selectedGoals) {
    const scorecard = scorecards.get(goal)!;
    const briefResult = briefResults.find((b) => b.goal === goal);
    const sections = briefResult?.sections ?? {};
    const briefMarkdown = renderBrief(
      scorecard,
      sections,
      allInvestigationLogs,
      lastSuccessful.result.state.fetchedDocs,
      passResults.reduce((sum, p) => sum + (p.result?.metrics.toolCalls ?? 0), 0),
      totalBudget,
      lastSuccessful.result.metrics,
    );

    persistRunToTieredStorage(runsDir, {
      id: crypto.randomUUID(),
      goal,
      repoName,
      startedAt,
      completedAt,
      scorecard,
      metrics: lastSuccessful.result.metrics,
      briefMarkdown,
      terminationReason: lastSuccessful.result.terminationReason,
      findings: allFindings,
      parentRunId,
      repoPath,
      repoSource,
      repoUrl,
    }, allEvents);
  }
  console.log(`  Persisted ${selectedGoals.length} runs to tiered storage (parentRunId: ${parentRunId.slice(0, 8)}...)`);

  // Unified findings
  const findingsPath = path.join(outputDir, 'findings.json');
  fs.writeFileSync(findingsPath, JSON.stringify(allFindings, null, 2), 'utf-8');
  allOutputPaths.push(findingsPath);

  // Cross-goal summary
  const totalToolCalls = passResults.reduce((sum, p) => sum + (p.result?.metrics.toolCalls ?? 0), 0);
  const totalDuration = passResults.reduce((sum, p) => sum + p.durationMs, 0);
  const totalCost = passResults.reduce((sum, p) => sum + (p.result?.metrics.totalEstimatedCostUsd ?? 0), 0);

  const metrics: MultiGoalMetrics = {
    totalToolCalls,
    totalDurationMs: totalDuration,
    totalCostUsd: totalCost,
    passBreakdown: passResults.map((p) => ({
      pass: p.pass,
      toolCalls: p.result?.metrics.toolCalls ?? 0,
      budget: p.budget,
      durationMs: p.durationMs,
      terminationReason: p.result?.terminationReason ?? (p.error ? 'error' : 'budget_exhausted'),
    })),
  };

  const summaryMd = renderMultiGoalSummary(repoName, multiGoalResults, allFindings, metrics);
  const summaryPath = path.join(outputDir, 'summary.md');
  fs.writeFileSync(summaryPath, summaryMd, 'utf-8');
  allOutputPaths.push(summaryPath);

  // JSON output mode
  if (opts.json) {
    const summary = {
      status: 'completed',
      mode: 'universal',
      findings: allFindings.length,
      toolCalls: totalToolCalls,
      durationMs: totalDuration,
      estimatedCostUsd: totalCost,
      goals: selectedGoals.map((goal) => {
        const sc = scorecards.get(goal)!;
        return {
          goal,
          score: sc.overallScore,
          categories: sc.categories.map((c) => ({
            name: c.category,
            score: c.score,
            findings: c.findings.length,
          })),
        };
      }),
      passes: passResults.map((p) => ({
        pass: p.pass,
        toolCalls: p.result?.metrics.toolCalls ?? 0,
        error: p.error,
      })),
    };
    console.log(JSON.stringify(summary, null, 2));
    const hasRed = selectedGoals.some((g) => scorecards.get(g)?.overallScore === 'red');
    return hasRed ? 1 : 0;
  }

  // Summary output
  console.log(`\n--- Analysis complete (${selectedGoals.length} goals) ---\n`);
  console.log(`  Tool calls: ${totalToolCalls}/${totalBudget}`);
  console.log(`  Findings:   ${allFindings.length}`);
  console.log(`  Duration:   ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Est. cost:  $${totalCost.toFixed(4)}`);
  console.log('');
  console.log('  Passes:');
  for (const p of passResults) {
    const calls = p.result?.metrics.toolCalls ?? 0;
    const reason = p.result?.terminationReason ?? (p.error ? 'error' : 'unknown');
    const flag = reason === 'budget_exhausted' ? ' ⚠️  budget exceeded' : reason === 'completed' ? '' : ` (${reason})`;
    console.log(`    ${p.pass}: ${calls}/${p.budget} calls, ${(p.durationMs / 1000).toFixed(1)}s${flag}`);
  }
  console.log('');
  console.log('  Scores:');
  for (const goal of selectedGoals) {
    const sc = scorecards.get(goal)!;
    const emoji = sc.overallScore === 'red' ? '🔴' : sc.overallScore === 'yellow' ? '🟡' : '🟢';
    console.log(`    ${emoji} ${goal}: ${sc.overallScore.toUpperCase()}`);
  }
  console.log('');
  for (const p of allOutputPaths.slice(0, 10)) {
    console.log(`  ✓ ${p}`);
  }
  if (allOutputPaths.length > 10) {
    console.log(`  ... and ${allOutputPaths.length - 10} more files`);
  }
  console.log('');

  const hasRed = selectedGoals.some((g) => scorecards.get(g)?.overallScore === 'red');
  return hasRed ? 1 : 0;
}

// ─── Parallel dispatch implementation ───────────────────────────────

interface ParallelContext {
  repoPath: string;
  repoName: string;
  repoSource: 'github' | 'local';
  repoUrl?: string;
  totalBudget: number;
  selectedGoals: GoalType[];
  platform: string;
  outputDir: string;
  verbose: boolean;
  preCompute: Awaited<ReturnType<typeof runPreCompute>>;
}

async function handleParallelDispatch(
  opts: Parameters<typeof handleAnalyzeAll>[0],
  ctx: ParallelContext,
): Promise<number> {
  const { repoPath, repoName, repoSource, repoUrl, totalBudget, selectedGoals, platform, outputDir, verbose, preCompute } = ctx;

  const clusterPlan = planClusterBudget(totalBudget, preCompute);
  const activeClusters = clusterPlan.clusters.filter(c => !c.skip);

  console.log(`\nCluster plan (parallel): ${activeClusters.length} workers, synthesis budget: ${clusterPlan.synthesisBudget}`);
  for (const c of clusterPlan.clusters) {
    console.log(`  ${c.name}: ${c.skip ? `skip (${c.skipReason})` : `${c.budget} calls`}`);
  }
  console.log('');

  const parentRunId = crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEvents: Array<Record<string, any>> = [];
  const allInvestigationLogs: AgentState['investigationLog'] = [];

  // Emit cluster plan event
  allEvents.push({
    step: -1,
    action: 'cluster_plan',
    result: JSON.stringify({ clusters: clusterPlan.clusters, signals: clusterPlan.signals, synthesisBudget: clusterPlan.synthesisBudget }),
    timestamp: new Date().toISOString(),
  });

  // Dispatch all workers in parallel
  const workerResults = await Promise.allSettled(
    activeClusters.map(async (cluster) => {
      const start = Date.now();
      console.log(`[${cluster.name}] Starting worker (budget: ${cluster.budget})...`);
      try {
        const result = await runAgent({
          repoPath,
          repoName,
          repoSource,
          repoUrl,
          goal: 'audit-generic' as GoalType,
          platform: platform !== 'unknown' ? platform : undefined,
          toolCallBudget: cluster.budget,
          outputDir,
          verbose,
          preCompute,
          mode: 'worker',
          workerId: cluster.clusterId,
          allowedCategories: cluster.categories,
          onStep: (step) => {
            allEvents.push(step);
            if (verbose) formatVerboseStep(step, `[${cluster.name}]`);
            else if (step.type !== 'text_delta' && step.type !== 'tool_start' && step.type !== 'finding_progress') {
              console.log(`  [${cluster.name}] [Step ${step.step}] ${step.action} → ${step.result?.slice(0, 60) ?? ''}`);
            }
          },
        });
        const durationMs = Date.now() - start;
        allInvestigationLogs.push(...result.state.investigationLog);
        allEvents.push({
          step: -1,
          action: 'worker_complete',
          workerId: cluster.clusterId,
          result: JSON.stringify({
            worker: cluster.name,
            toolCalls: result.metrics.toolCalls,
            budget: cluster.budget,
            findings: result.state.findings.length,
            terminationReason: result.terminationReason,
          }),
          timestamp: new Date().toISOString(),
        });
        console.log(`[${cluster.name}] Done: ${result.state.findings.length} findings, ${result.metrics.toolCalls}/${cluster.budget} calls, ${(durationMs / 1000).toFixed(1)}s`);
        return { cluster, result, durationMs };
      } catch (err) {
        const durationMs = Date.now() - start;
        console.warn(`[${cluster.name}] Worker failed: ${(err as Error).message}`);
        return { cluster, error: (err as Error).message, durationMs };
      }
    }),
  );

  // Collect findings from all successful workers, dedup by ID then semantically
  const seenIds = new Set<string>();
  const mergedFindings = [];
  let lastSuccessfulResult: RunResult | undefined;

  for (const settled of workerResults) {
    if (settled.status === 'rejected') continue;
    const wr = settled.value;
    if ('error' in wr && !('result' in wr)) continue;
    if (!wr.result) continue;
    lastSuccessfulResult = wr.result;
    for (const f of wr.result.state.findings) {
      if (!seenIds.has(f.id)) {
        seenIds.add(f.id);
        mergedFindings.push(f);
      }
    }
  }

  if (!lastSuccessfulResult) {
    console.error('No workers completed successfully.');
    return 2;
  }

  // Semantic dedup
  const dedupResult = deduplicateFindings(mergedFindings);
  if (dedupResult.mergedCount > 0) {
    console.log(`  Deduplication: merged ${dedupResult.mergedCount} duplicate(s). ${dedupResult.findings.length} retained.`);
    mergedFindings.length = 0;
    mergedFindings.push(...dedupResult.findings);
  }

  console.log(`\nAll workers complete. ${mergedFindings.length} merged findings.`);

  // --- Synthesis pass ---
  if (clusterPlan.synthesisBudget > 0 && mergedFindings.length > 0) {
    console.log(`\n[Synthesis] Starting (budget: ${clusterPlan.synthesisBudget}, findings: ${mergedFindings.length})...`);
    try {
      const synthResult = await runSynthesis({
        repoPath,
        repoName,
        goal: 'audit-generic' as GoalType,
        findings: mergedFindings,
        toolCallBudget: clusterPlan.synthesisBudget,
        outputDir,
        onStep: (step) => {
          allEvents.push(step);
          if (verbose) formatVerboseStep(step, '[Synthesis]');
          else if (step.type !== 'text_delta' && step.type !== 'tool_start' && step.type !== 'finding_progress') {
            console.log(`  [Synthesis] [Step ${step.step}] ${step.action} → ${step.result?.slice(0, 60) ?? ''}`);
          }
        },
      });
      if (synthResult.crossCuttingFindings.length > 0) {
        for (const f of synthResult.crossCuttingFindings) {
          if (!seenIds.has(f.id)) {
            seenIds.add(f.id);
            mergedFindings.push(f);
          }
        }
        console.log(`[Synthesis] Added ${synthResult.crossCuttingFindings.length} cross-cutting finding(s). Total: ${mergedFindings.length}`);
      } else {
        console.log(`[Synthesis] Done (no cross-cutting findings added).`);
      }
      allEvents.push({
        step: -1,
        action: 'synthesis_complete',
        workerId: 'synthesis',
        result: JSON.stringify({ crossCutting: synthResult.crossCuttingFindings.length, terminationReason: synthResult.terminationReason }),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[Synthesis] Failed (non-fatal): ${(err as Error).message}`);
    }
  }

  // --- Scoring & output (same as sequential path) ---
  console.log(`\nScoring ${selectedGoals.length} goals from ${mergedFindings.length} findings...`);
  const scorecards = new Map<GoalType, Scorecard>();
  const multiGoalResults: MultiGoalResult[] = [];

  for (const goal of selectedGoals) {
    const scorecard = computeScorecard(repoName, goal, mergedFindings);
    scorecards.set(goal, scorecard);
    multiGoalResults.push({ goal, scorecard });
    console.log(`  ${goal}: ${scorecard.overallScore.toUpperCase()} (${scorecard.categories.length} categories)`);
  }

  console.log('\nWriting per-goal briefs...');
  const briefResults = await writeAllBriefs(selectedGoals, mergedFindings, scorecards);
  for (const br of briefResults) {
    if (br.error) console.warn(`  ${br.goal}: brief failed — ${br.error}`);
    else console.log(`  ${br.goal}: ${Object.keys(br.sections).length} sections`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const allOutputPaths: string[] = [];

  for (const goal of selectedGoals) {
    const goalDir = path.join(outputDir, goal);
    fs.mkdirSync(goalDir, { recursive: true });

    const scorecard = scorecards.get(goal)!;
    const briefResult = briefResults.find((b) => b.goal === goal);
    const sections = briefResult?.sections ?? {};

    const briefMarkdown = renderBrief(
      scorecard, sections, allInvestigationLogs,
      lastSuccessfulResult.state.fetchedDocs,
      workerResults.reduce((sum, s) => sum + (s.status === 'fulfilled' && s.value.result ? s.value.result.metrics.toolCalls : 0), 0),
      totalBudget, lastSuccessfulResult.metrics,
    );

    const mgResult = multiGoalResults.find((r) => r.goal === goal);
    if (mgResult) mgResult.briefPath = `./${goal}/brief.md`;

    const goalState: AgentState = {
      ...lastSuccessfulResult.state,
      goal,
      findings: mergedFindings,
      investigationLog: allInvestigationLogs,
    };

    const fullExport = buildFullExport(
      goalState, scorecard, sections,
      lastSuccessfulResult.metrics,
      lastSuccessfulResult.terminationReason,
      totalBudget,
    );

    fs.writeFileSync(path.join(goalDir, 'scorecard.json'), JSON.stringify(scorecard, null, 2), 'utf-8');
    allOutputPaths.push(path.join(goalDir, 'scorecard.json'));
    fs.writeFileSync(path.join(goalDir, 'brief.md'), briefMarkdown, 'utf-8');
    allOutputPaths.push(path.join(goalDir, 'brief.md'));
    fs.writeFileSync(path.join(goalDir, 'export.json'), serializeExport(fullExport), 'utf-8');
    allOutputPaths.push(path.join(goalDir, 'export.json'));
  }

  // Persist to tiered storage
  const runsDir = path.join(path.dirname(outputDir), 'runs');
  for (const goal of selectedGoals) {
    const scorecard = scorecards.get(goal)!;
    const briefResult = briefResults.find((b) => b.goal === goal);
    const sections = briefResult?.sections ?? {};
    const briefMarkdown = renderBrief(
      scorecard, sections, allInvestigationLogs,
      lastSuccessfulResult.state.fetchedDocs,
      workerResults.reduce((sum, s) => sum + (s.status === 'fulfilled' && s.value.result ? s.value.result.metrics.toolCalls : 0), 0),
      totalBudget, lastSuccessfulResult.metrics,
    );
    persistRunToTieredStorage(runsDir, {
      id: crypto.randomUUID(),
      goal, repoName,
      startedAt: lastSuccessfulResult.metrics.startedAt,
      completedAt: new Date().toISOString(),
      scorecard, metrics: lastSuccessfulResult.metrics,
      briefMarkdown,
      terminationReason: lastSuccessfulResult.terminationReason,
      findings: mergedFindings,
      parentRunId, repoPath, repoSource, repoUrl,
    }, allEvents);
  }
  console.log(`  Persisted ${selectedGoals.length} runs to tiered storage (parentRunId: ${parentRunId.slice(0, 8)}...)`);

  const findingsPath = path.join(outputDir, 'findings.json');
  fs.writeFileSync(findingsPath, JSON.stringify(mergedFindings, null, 2), 'utf-8');
  allOutputPaths.push(findingsPath);

  const totalToolCalls = workerResults.reduce((sum, s) => sum + (s.status === 'fulfilled' && s.value.result ? s.value.result.metrics.toolCalls : 0), 0);
  const totalDuration = workerResults.reduce((sum, s) => sum + (s.status === 'fulfilled' ? s.value.durationMs : 0), 0);
  const totalCost = workerResults.reduce((sum, s) => sum + (s.status === 'fulfilled' && s.value.result ? (s.value.result.metrics.totalEstimatedCostUsd ?? 0) : 0), 0);

  if (opts.json) {
    const summary = {
      status: 'completed',
      mode: 'parallel',
      workers: activeClusters.length,
      findings: mergedFindings.length,
      toolCalls: totalToolCalls,
      durationMs: totalDuration,
      estimatedCostUsd: totalCost,
      goals: selectedGoals.map((goal) => {
        const sc = scorecards.get(goal)!;
        return { goal, score: sc.overallScore, categories: sc.categories.map(c => ({ name: c.category, score: c.score, findings: c.findings.length })) };
      }),
    };
    console.log(JSON.stringify(summary, null, 2));
    return selectedGoals.some(g => scorecards.get(g)?.overallScore === 'red') ? 1 : 0;
  }

  console.log(`\n--- Analysis complete (parallel, ${selectedGoals.length} goals) ---\n`);
  console.log(`  Workers:    ${activeClusters.length}`);
  console.log(`  Tool calls: ${totalToolCalls}/${totalBudget}`);
  console.log(`  Findings:   ${mergedFindings.length}`);
  console.log(`  Wall time:  ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`  Est. cost:  $${totalCost.toFixed(4)}`);
  console.log('');
  console.log('  Scores:');
  for (const goal of selectedGoals) {
    const sc = scorecards.get(goal)!;
    const emoji = sc.overallScore === 'red' ? '🔴' : sc.overallScore === 'yellow' ? '🟡' : '🟢';
    console.log(`    ${emoji} ${goal}: ${sc.overallScore.toUpperCase()}`);
  }
  console.log('');

  return selectedGoals.some(g => scorecards.get(g)?.overallScore === 'red') ? 1 : 0;
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
