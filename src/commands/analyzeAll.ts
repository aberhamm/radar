/**
 * Universal analysis command — runs tiered investigation (core + specialists),
 * scores all 8 goals from the same findings pool, writes per-goal briefs in parallel.
 */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { runAgent, runPreCompute, writeOutputFiles, type RunResult } from '../agent/runner.js';
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
import type { GoalType, AgentState } from '../types/state.js';
import type { Scorecard } from '../types/output.js';

const ALL_GOALS: GoalType[] = [
  'onboarding',
  'audit',
  'migration',
  'component-map',
  'ci-check',
  'security-review',
  'nextjs',
  'accessibility',
];

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
  verbose?: boolean;
  json?: boolean;
  export?: boolean;
}): Promise<number> {
  const repoInput = opts.repo;
  if (!repoInput) {
    throw new Error('--repo is required. Pass a local path or GitHub URL.');
  }

  const totalBudget = parseInt(opts.budget, 10);
  if (totalBudget < 60) {
    throw new Error(`Budget ${totalBudget} is too low for --goal all. Minimum recommended: 100.`);
  }

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

  // Resolve npm versions (shared across all passes)
  console.log('Resolving npm versions...');
  const npmResult = await queryNpmVersions({ packages: TRACKED_PACKAGES });
  console.log(
    `  ${Object.keys(npmResult.versions).length} packages resolved${npmResult.fromCache ? ` (cached, ${npmResult.cacheAge})` : ''}`,
  );

  // Budget allocation — core gets 70% because it must investigate AND record findings.
  // Specialists get 15% each for targeted depth.
  const coreBudget = Math.floor(totalBudget * 0.7);
  const nextjsBudget = Math.floor(totalBudget * 0.15);
  const a11yBudget = totalBudget - coreBudget - nextjsBudget;

  console.log(`\nStarting universal analysis (budget: ${coreBudget}+${nextjsBudget}+${a11yBudget}=${totalBudget})...\n`);

  const parentRunId = crypto.randomUUID();
  const passResults: PassResult[] = [];
  let sharedState: Partial<AgentState> | undefined;
  const allInvestigationLogs: AgentState['investigationLog'] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allEvents: Array<Record<string, any>> = [];

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
      onStep: (step) => {
        allEvents.push(step);
        if (verbose) formatVerboseStep(step, '[Core]');
        else console.log(`  [Core] [Step ${step.step}] ${step.action} → ${step.result?.slice(0, 60) ?? ''}`);
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

  // --- Pass 2: Next.js specialist ---
  allEvents.push({ step: -1, action: 'pass_boundary', result: 'Next.js Specialist', timestamp: new Date().toISOString() });
  const nextjsStart = Date.now();
  console.log(`\n[Next.js] Starting specialist pass (budget: ${nextjsBudget})...`);
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
      initialState: sharedState,
      onStep: (step) => {
        allEvents.push(step);
        if (verbose) formatVerboseStep(step, '[Next.js]');
        else console.log(`  [Next.js] [Step ${step.step}] ${step.action} → ${step.result?.slice(0, 60) ?? ''}`);
      },
    });
    const nextjsDuration = Date.now() - nextjsStart;
    passResults.push({ pass: 'Next.js Specialist', budget: nextjsBudget, result: nextjsResult, durationMs: nextjsDuration });
    allInvestigationLogs.push(...nextjsResult.state.investigationLog);
    // Update shared state with new findings
    sharedState = {
      findings: nextjsResult.state.findings,
      filesRead: nextjsResult.state.filesRead,
      fileReadCache: nextjsResult.state.fileReadCache,
      resolvedVersions: nextjsResult.state.resolvedVersions,
      stackProfile: nextjsResult.state.stackProfile,
      fetchedDocs: nextjsResult.state.fetchedDocs,
      modelUsage: nextjsResult.state.modelUsage,
    };
    allEvents.push({ step: -1, action: 'pass_complete', result: JSON.stringify({ pass: 'Next.js Specialist', toolCalls: nextjsResult.metrics.toolCalls, budget: nextjsBudget, terminationReason: nextjsResult.terminationReason }), timestamp: new Date().toISOString() });
    console.log(`[Next.js] Done: ${nextjsResult.state.findings.length} total findings, ${nextjsResult.metrics.toolCalls}/${nextjsBudget} calls`);
  } catch (err) {
    const nextjsDuration = Date.now() - nextjsStart;
    passResults.push({ pass: 'Next.js Specialist', budget: nextjsBudget, error: (err as Error).message, durationMs: nextjsDuration });
    console.warn(`[Next.js] Specialist failed (graceful degradation): ${(err as Error).message}`);
  }

  // --- Pass 3: Accessibility specialist ---
  allEvents.push({ step: -1, action: 'pass_boundary', result: 'Accessibility Specialist', timestamp: new Date().toISOString() });
  const a11yStart = Date.now();
  console.log(`\n[A11y] Starting specialist pass (budget: ${a11yBudget})...`);
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
      initialState: sharedState,
      onStep: (step) => {
        allEvents.push(step);
        if (verbose) formatVerboseStep(step, '[A11y]');
        else console.log(`  [A11y] [Step ${step.step}] ${step.action} → ${step.result?.slice(0, 60) ?? ''}`);
      },
    });
    const a11yDuration = Date.now() - a11yStart;
    passResults.push({ pass: 'Accessibility Specialist', budget: a11yBudget, result: a11yResult, durationMs: a11yDuration });
    allInvestigationLogs.push(...a11yResult.state.investigationLog);
    sharedState = {
      findings: a11yResult.state.findings,
      filesRead: a11yResult.state.filesRead,
      fileReadCache: a11yResult.state.fileReadCache,
      resolvedVersions: a11yResult.state.resolvedVersions,
      stackProfile: a11yResult.state.stackProfile,
      fetchedDocs: a11yResult.state.fetchedDocs,
      modelUsage: a11yResult.state.modelUsage,
    };
    allEvents.push({ step: -1, action: 'pass_complete', result: JSON.stringify({ pass: 'Accessibility Specialist', toolCalls: a11yResult.metrics.toolCalls, budget: a11yBudget, terminationReason: a11yResult.terminationReason }), timestamp: new Date().toISOString() });
    console.log(`[A11y] Done: ${a11yResult.state.findings.length} total findings, ${a11yResult.metrics.toolCalls}/${a11yBudget} calls`);
  } catch (err) {
    const a11yDuration = Date.now() - a11yStart;
    passResults.push({ pass: 'Accessibility Specialist', budget: a11yBudget, error: (err as Error).message, durationMs: a11yDuration });
    console.warn(`[A11y] Specialist failed (graceful degradation): ${(err as Error).message}`);
  }

  // Collect all findings from the latest shared state
  const lastSuccessful = passResults.filter((p) => p.result).pop();
  if (!lastSuccessful?.result) {
    console.error('No passes succeeded.');
    return 2;
  }
  const allFindings = lastSuccessful.result.state.findings;

  // --- Phase 5: Multi-goal scoring ---
  console.log(`\nScoring ${ALL_GOALS.length} goals from ${allFindings.length} findings...`);
  const scorecards = new Map<GoalType, Scorecard>();
  const multiGoalResults: MultiGoalResult[] = [];

  for (const goal of ALL_GOALS) {
    const scorecard = computeScorecard(repoName, goal, allFindings);
    scorecards.set(goal, scorecard);
    multiGoalResults.push({ goal, scorecard });
    console.log(`  ${goal}: ${scorecard.overallScore.toUpperCase()} (${scorecard.categories.length} categories)`);
  }

  // --- Phase 6: Per-goal brief writing (parallel) ---
  console.log('\nWriting per-goal briefs...');
  const briefResults = await writeAllBriefs(ALL_GOALS, allFindings, scorecards);
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
  for (const goal of ALL_GOALS) {
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

  for (const goal of ALL_GOALS) {
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
  console.log(`  Persisted ${ALL_GOALS.length} runs to tiered storage (parentRunId: ${parentRunId.slice(0, 8)}...)`);

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
      goals: ALL_GOALS.map((goal) => {
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
    const hasRed = ALL_GOALS.some((g) => scorecards.get(g)?.overallScore === 'red');
    return hasRed ? 1 : 0;
  }

  // Summary output
  console.log(`\n--- Universal analysis complete ---\n`);
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
  for (const goal of ALL_GOALS) {
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

  // Exit code: worst of all scorecards
  const hasRed = ALL_GOALS.some((g) => scorecards.get(g)?.overallScore === 'red');
  return hasRed ? 1 : 0;
}
