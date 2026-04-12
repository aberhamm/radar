import path from 'node:path';
import fs from 'node:fs';
import { runAgent, type RunResult } from '../agent/runner.js';
import { cloneRepo } from '../tools/repo/cloneRepo.js';
import { queryNpmVersions, TRACKED_PACKAGES } from '../tools/dependency/queryNpmVersions.js';
import { renderComparison, type ComparisonInput } from '../output/comparisonRenderer.js';
import { formatVerboseStep } from '../output/verboseFormatter.js';
import type { GoalType } from '../types/state.js';

/**
 * Compare command — runs agent on two repos sequentially, then renders comparison.
 * Returns exit code: 0 = success, 1 = any red, 2 = both repos errored
 */
export async function handleCompare(opts: {
  repos: string[];
  goal: string;
  platform?: string;
  output: string;
  budget: string;
  verbose?: boolean;
}): Promise<number> {
  if (opts.repos.length !== 2) {
    throw new Error('--repos requires exactly two repository paths or URLs.');
  }

  const goal = opts.goal as GoalType;
  const validGoals = ['onboarding', 'audit', 'audit-generic', 'migration', 'component-map', 'ci-check', 'security-review', 'nextjs', 'accessibility'];
  if (!validGoals.includes(goal)) {
    throw new Error(`Invalid goal: ${goal}. Valid: ${validGoals.join(', ')}`);
  }

  const budget = parseInt(opts.budget, 10);
  const platform = opts.platform ?? 'unknown';
  const outputDir = opts.output;
  const verbose = opts.verbose ?? false;

  // Resolve npm versions once for both runs
  console.log('Resolving npm versions...');
  const npmResult = await queryNpmVersions({ packages: TRACKED_PACKAGES });
  const versionCount = Object.keys(npmResult.versions).length;
  console.log(
    `  ${versionCount} packages resolved${npmResult.fromCache ? ` (cached, ${npmResult.cacheAge})` : ''}`,
  );

  // Run agent on both repos in parallel
  console.log('\nStarting parallel analysis of both repos...\n');

  async function analyzeRepo(repoInput: string): Promise<{ repoInput: string; result?: RunResult; repoName: string; error?: string }> {
    try {
      // Resolve repo path
      let repoPath: string;
      let repoName: string;
      let repoSource: 'github' | 'local';
      let repoUrl: string | undefined;

      if (repoInput.startsWith('http://') || repoInput.startsWith('https://')) {
        console.log(`[${repoInput.split('/').pop()?.replace('.git', '') ?? 'repo'}] Cloning...`);
        const cloneResult = await cloneRepo({ url: repoInput });
        repoPath = cloneResult.localPath;
        repoName = repoInput.split('/').pop()?.replace('.git', '') ?? 'unknown';
        repoSource = 'github';
        repoUrl = repoInput;
        console.log(`[${repoName}] Cloned to ${repoPath} (${cloneResult.defaultBranch}, ${cloneResult.lastCommit.hash.slice(0, 7)})`);
      } else {
        repoPath = path.resolve(repoInput);
        if (!fs.existsSync(repoPath)) {
          throw new Error(`Repository path not found: ${repoPath}`);
        }
        repoName = path.basename(repoPath);
        repoSource = 'local';
      }

      console.log(`[${repoName}] Starting investigation (goal: ${goal}, budget: ${budget})...`);

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
        onStep: (step) => {
          if (verbose) {
            formatVerboseStep(step, repoName);
          } else {
            const truncated = step.result?.slice(0, 60) ?? '';
            console.log(`  [${repoName}] [Step ${step.step}] ${step.action} → ${truncated}`);
          }
        },
      });

      console.log(`[${repoName}] Done: ${result.scorecard.overallScore.toUpperCase()}, ${result.state.findings.length} findings`);
      return { repoInput, result, repoName };
    } catch (err) {
      const repoName = repoInput.split('/').pop()?.replace('.git', '') ?? repoInput;
      const errorMsg = (err as Error).message;
      console.error(`[${repoName}] Error: ${errorMsg}`);
      return { repoInput, repoName, error: errorMsg };
    }
  }

  const results = await Promise.all(opts.repos.map(analyzeRepo));

  // Generate comparison output
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Generating comparison report...');
  console.log(`${'='.repeat(60)}\n`);

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  const [resA, resB] = results;

  // If both failed, report and exit
  if (!resA.result && !resB.result) {
    const errorReport = [
      `# Comparison Report: ${resA.repoName} vs ${resB.repoName}`,
      '',
      '> Both repositories failed to analyze.',
      '',
      `**${resA.repoName}:** ${resA.error}`,
      '',
      `**${resB.repoName}:** ${resB.error}`,
    ].join('\n');
    const outPath = path.join(outputDir, 'comparison.md');
    fs.writeFileSync(outPath, errorReport, 'utf-8');
    console.log(`  Written: ${outPath}`);
    console.error('\nBoth repositories failed. See comparison.md for details.');
    return 2;
  }

  // If one failed, produce partial comparison with error note
  if (!resA.result || !resB.result) {
    const successResult = (resA.result ?? resB.result)!;
    const successName = resA.result ? resA.repoName : resB.repoName;
    const failedName = resA.result ? resB.repoName : resA.repoName;
    const failedError = resA.result ? resB.error : resA.error;

    const partialReport = [
      `# Comparison Report: ${resA.repoName} vs ${resB.repoName}`,
      '',
      `> Generated by **repo-audit-delivery-agent** | ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      '',
      '---',
      '',
      '## Error',
      '',
      `Analysis of **${failedName}** failed: ${failedError}`,
      '',
      `Only **${successName}** was analyzed successfully.`,
      '',
      '---',
      '',
      `## ${successName} Results`,
      '',
      `**Overall Score:** ${successResult.scorecard.overallScore.toUpperCase()}`,
      `**Findings:** ${successResult.state.findings.length}`,
      '',
      'See the individual brief for full details.',
    ].join('\n');

    const outPath = path.join(outputDir, 'comparison.md');
    fs.writeFileSync(outPath, partialReport, 'utf-8');
    console.log(`  Written: ${outPath}`);
    console.log(`\n  Note: ${failedName} failed — partial comparison only.`);
    return successResult.scorecard.overallScore === 'red' ? 1 : 0;
  }

  // Both succeeded — render full comparison
  const inputA: ComparisonInput = {
    repoName: resA.repoName,
    scorecard: resA.result.scorecard,
    findings: resA.result.state.findings,
    briefMarkdown: resA.result.briefMarkdown,
  };
  const inputB: ComparisonInput = {
    repoName: resB.repoName,
    scorecard: resB.result.scorecard,
    findings: resB.result.state.findings,
    briefMarkdown: resB.result.briefMarkdown,
  };

  const comparisonMd = renderComparison(inputA, inputB);
  const outPath = path.join(outputDir, 'comparison.md');
  fs.writeFileSync(outPath, comparisonMd, 'utf-8');

  console.log(`  Written: ${outPath}`);
  console.log('');
  console.log(`  ${resA.repoName}: ${resA.result.scorecard.overallScore.toUpperCase()} (${resA.result.state.findings.length} findings)`);
  console.log(`  ${resB.repoName}: ${resB.result.scorecard.overallScore.toUpperCase()} (${resB.result.state.findings.length} findings)`);
  console.log('');

  // Exit code: worst of the two
  const hasRed =
    resA.result.scorecard.overallScore === 'red' ||
    resB.result.scorecard.overallScore === 'red';
  return hasRed ? 1 : 0;
}
