import path from 'node:path';
import fs from 'node:fs';
import { runAgent, type RunResult } from '../agent/runner.js';
import { cloneRepo } from '../tools/repo/cloneRepo.js';
import { queryNpmVersions, TRACKED_PACKAGES } from '../tools/dependency/queryNpmVersions.js';
import { formatVerboseStep } from '../output/verboseFormatter.js';
import type { GoalType } from '../types/state.js';
import type { Finding } from '../types/findings.js';

// ─── Gauntlet result schema ──────────────────────────────────

export interface GauntletResult {
  repo: string;
  goal: string;
  timestamp: string;
  crashFree: boolean;
  hallucinationFree: boolean;
  confidencePass: boolean;
  sectionsPopulated: boolean;
  scorecardComplete: boolean;
  findingsCount: number;
  overallScore?: string;
  durationMs?: number;
  estimatedCostUsd?: number;
  /** Count of individual evidence items that could not be verified against actual files */
  unverifiableEvidenceCount?: number;
  /** Total evidence items across all findings */
  totalEvidenceCount?: number;
  /** Findings with zero evidence (claims without backing) */
  unsupportedFindingsCount?: number;
  notes?: string;
}

const RESULTS_PATH = path.resolve('output/gauntlet-results.jsonl');
const DEFAULT_GOALS: GoalType[] = ['onboarding', 'audit', 'security-review'];

// ─── Evaluation helpers ──────────────────────────────────────

interface EvidenceStats {
  total: number;
  unverifiable: number;
  unsupportedFindings: number;
}

function countEvidenceStats(findings: Finding[]): EvidenceStats {
  let total = 0;
  let unverifiable = 0;
  let unsupportedFindings = 0;

  for (const f of findings) {
    if (f.evidence.length === 0) {
      unsupportedFindings++;
      continue;
    }
    for (const e of f.evidence) {
      total++;
      if (e.verificationStatus === 'unverifiable') {
        unverifiable++;
      }
    }
  }

  return { total, unverifiable, unsupportedFindings };
}

function checkHallucinationFree(findings: Finding[]): boolean {
  // Spec: "zero hallucinated evidence" — any single evidence item that is
  // unverifiable (claimed to exist in a file but doesn't) is a failure.
  const stats = countEvidenceStats(findings);
  return stats.unverifiable === 0;
}

function checkConfidencePass(findings: Finding[]): boolean {
  // <20% of findings with confidence <= 3
  if (findings.length === 0) return true;
  const lowConfidence = findings.filter(f => (f.confidence ?? 10) <= 3).length;
  return (lowConfidence / findings.length) < 0.2;
}

function checkSectionsPopulated(briefMarkdown: string): boolean {
  // Brief should have multiple ## headings with content under each
  const sections = briefMarkdown.split(/^## /m).slice(1); // split by h2, drop preamble
  if (sections.length === 0) return false;
  // Every section should have at least some content (not just whitespace)
  return sections.every(s => s.replace(/^[^\n]*\n/, '').trim().length > 10);
}

function checkScorecardComplete(categories: Array<{ category: string; score: string }>): boolean {
  // No "unknown" categories, and at least one category scored
  if (categories.length === 0) return false;
  return categories.every(c => c.score !== 'unknown' && c.category !== 'unknown');
}

// ─── JSONL persistence ───────────────────────────────────────

function loadResults(): GauntletResult[] {
  if (!fs.existsSync(RESULTS_PATH)) return [];
  const lines = fs.readFileSync(RESULTS_PATH, 'utf-8').split('\n').filter(l => l.trim());
  return lines.map(l => JSON.parse(l) as GauntletResult);
}

function appendResult(result: GauntletResult): void {
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
  fs.appendFileSync(RESULTS_PATH, JSON.stringify(result) + '\n', 'utf-8');
}

// ─── Table renderer ──────────────────────────────────────────

function renderTable(results: GauntletResult[]): void {
  if (results.length === 0) {
    console.log('\n  No gauntlet results yet. Run with --run --repos <paths...>\n');
    return;
  }

  const pass = (v: boolean) => v ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  const status = (r: GauntletResult) => {
    const checks = [r.crashFree, r.hallucinationFree, r.confidencePass, r.sectionsPopulated, r.scorecardComplete];
    if (checks.every(Boolean)) return '\x1b[32mGREEN\x1b[0m';
    if (checks.filter(Boolean).length >= 3) return '\x1b[33mYELLOW\x1b[0m';
    return '\x1b[31mRED\x1b[0m';
  };

  // Column widths
  const repoW = Math.max(24, ...results.map(r => r.repo.length));
  const goalW = Math.max(10, ...results.map(r => r.goal.length));

  const header = [
    'Repo'.padEnd(repoW),
    'Goal'.padEnd(goalW),
    'Crash',
    'Halluc',
    'Conf ',
    'Sections',
    'Score',
    'Status',
  ].join(' | ');

  const divider = header.replace(/[^|]/g, '-');

  console.log('');
  console.log(`  ${header}`);
  console.log(`  ${divider}`);

  for (const r of results) {
    const row = [
      r.repo.padEnd(repoW),
      r.goal.padEnd(goalW),
      pass(r.crashFree).padEnd(4 + 9), // ANSI codes add 9 chars
      pass(r.hallucinationFree).padEnd(6 + 9),
      pass(r.confidencePass).padEnd(5 + 9),
      pass(r.sectionsPopulated).padEnd(8 + 9),
      pass(r.scorecardComplete).padEnd(5 + 9),
      status(r),
    ].join(' | ');
    console.log(`  ${row}`);
  }

  // Summary
  const allGreen = results.every(r =>
    r.crashFree && r.hallucinationFree && r.confidencePass && r.sectionsPopulated && r.scorecardComplete
  );
  const failCount = results.filter(r =>
    !r.crashFree || !r.hallucinationFree || !r.confidencePass || !r.sectionsPopulated || !r.scorecardComplete
  ).length;

  console.log('');
  if (allGreen) {
    console.log('  \x1b[32m✓ All repos pass gauntlet criteria. Phase 1 exit gate: CLEAR.\x1b[0m');
  } else {
    console.log(`  \x1b[31m✗ ${failCount}/${results.length} runs have failures. Phase 1 exit gate: NOT MET.\x1b[0m`);
  }
  console.log('');
}

// ─── Run handler ─────────────────────────────────────────────

async function runGauntlet(repos: string[], goals: GoalType[], budget: number, verbose: boolean): Promise<number> {
  console.log(`\nGauntlet: ${repos.length} repos × ${goals.length} goals = ${repos.length * goals.length} runs`);
  console.log(`Budget: ${budget} tool calls per run\n`);

  // Resolve npm versions once
  console.log('Resolving npm versions...');
  const npmResult = await queryNpmVersions({ packages: TRACKED_PACKAGES });
  const versionCount = Object.keys(npmResult.versions).length;
  console.log(`  ${versionCount} packages resolved${npmResult.fromCache ? ` (cached, ${npmResult.cacheAge})` : ''}\n`);

  let hasFailure = false;

  for (const repoInput of repos) {
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
      console.log(`  Cloned to ${repoPath} (${cloneResult.defaultBranch}, ${cloneResult.lastCommit.hash.slice(0, 7)})`);
    } else {
      repoPath = path.resolve(repoInput);
      if (!fs.existsSync(repoPath)) {
        console.error(`  Repository path not found: ${repoPath}`);
        // Record crash for all goals
        for (const goal of goals) {
          appendResult({
            repo: path.basename(repoInput),
            goal,
            timestamp: new Date().toISOString(),
            crashFree: false,
            hallucinationFree: false,
            confidencePass: false,
            sectionsPopulated: false,
            scorecardComplete: false,
            findingsCount: 0,
            notes: `Repository path not found: ${repoPath}`,
          });
        }
        hasFailure = true;
        continue;
      }
      repoName = path.basename(repoPath);
      repoSource = 'local';
    }

    for (const goal of goals) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`  ${repoName} × ${goal} (budget: ${budget})`);
      console.log(`${'─'.repeat(60)}\n`);

      let result: RunResult;
      try {
        result = await runAgent({
          repoPath,
          repoName,
          repoSource,
          repoUrl,
          goal,
          toolCallBudget: budget,
          outputDir: './output',
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
      } catch (err) {
        const errorMsg = (err as Error).message;
        console.error(`  CRASH: ${errorMsg}`);
        appendResult({
          repo: repoName,
          goal,
          timestamp: new Date().toISOString(),
          crashFree: false,
          hallucinationFree: false,
          confidencePass: false,
          sectionsPopulated: false,
          scorecardComplete: false,
          findingsCount: 0,
          notes: `Crash: ${errorMsg}`,
        });
        hasFailure = true;
        continue;
      }

      // Evaluate exit gate criteria
      const crashFree = result.terminationReason !== 'error';
      const evidenceStats = countEvidenceStats(result.state.findings);
      const hallucinationFree = evidenceStats.unverifiable === 0;
      const confidencePass = checkConfidencePass(result.state.findings);
      const sectionsPopulated = checkSectionsPopulated(result.briefMarkdown);
      const scorecardComplete = checkScorecardComplete(
        result.scorecard.categories.map(c => ({ category: c.category, score: c.score }))
      );

      const gauntletResult: GauntletResult = {
        repo: repoName,
        goal,
        timestamp: new Date().toISOString(),
        crashFree,
        hallucinationFree,
        confidencePass,
        sectionsPopulated,
        scorecardComplete,
        findingsCount: result.state.findings.length,
        overallScore: result.scorecard.overallScore,
        durationMs: result.metrics.durationMs,
        estimatedCostUsd: result.metrics.totalEstimatedCostUsd,
        unverifiableEvidenceCount: evidenceStats.unverifiable,
        totalEvidenceCount: evidenceStats.total,
        unsupportedFindingsCount: evidenceStats.unsupportedFindings,
        notes: result.terminationReason !== 'completed'
          ? `Terminated: ${result.terminationReason}${result.errorDetail ? ` — ${result.errorDetail}` : ''}`
          : undefined,
      };

      appendResult(gauntletResult);

      const allPass = crashFree && hallucinationFree && confidencePass && sectionsPopulated && scorecardComplete;
      if (!allPass) hasFailure = true;

      // Per-run summary
      const icon = allPass ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      console.log(`\n  ${icon} ${repoName} × ${goal}: ${result.scorecard.overallScore.toUpperCase()}, ${result.state.findings.length} findings, $${result.metrics.totalEstimatedCostUsd.toFixed(4)}`);
      console.log(`    Evidence: ${evidenceStats.total} items, ${evidenceStats.unverifiable} unverifiable, ${evidenceStats.unsupportedFindings} findings with no evidence`);
      if (!crashFree) console.log('    ✗ Crash detected');
      if (!hallucinationFree) console.log(`    ✗ ${evidenceStats.unverifiable} hallucinated evidence items (must be 0)`);
      if (!confidencePass) {
        const lowConf = result.state.findings.filter(f => (f.confidence ?? 10) <= 3).length;
        console.log(`    ✗ ${lowConf}/${result.state.findings.length} findings have confidence ≤3 (${Math.round(lowConf / result.state.findings.length * 100)}%, must be <20%)`);
      }
      if (!sectionsPopulated) console.log('    ✗ Brief sections incomplete');
      if (!scorecardComplete) console.log('    ✗ Scorecard has unknown categories');
      if (evidenceStats.unsupportedFindings > 0) {
        console.log(`    ⚠ ${evidenceStats.unsupportedFindings} findings have no evidence (review manually)`);
      }
    }
  }

  // Print full table
  const allResults = loadResults();
  renderTable(allResults);

  return hasFailure ? 1 : 0;
}

// ─── Main handler ────────────────────────────────────────────

export async function handleGauntlet(opts: {
  run?: boolean;
  repos?: string[];
  goals?: string;
  budget?: string;
  verbose?: boolean;
  clear?: boolean;
}): Promise<number> {
  // Clear mode
  if (opts.clear) {
    if (fs.existsSync(RESULTS_PATH)) {
      fs.unlinkSync(RESULTS_PATH);
      console.log('  Gauntlet results cleared.');
    } else {
      console.log('  No results to clear.');
    }
    return 0;
  }

  // Report mode (default — just print existing results)
  if (!opts.run) {
    const results = loadResults();
    renderTable(results);
    return 0;
  }

  // Run mode
  if (!opts.repos || opts.repos.length === 0) {
    throw new Error('--repos is required in run mode. Pass one or more local paths or GitHub URLs.');
  }

  const goalStr = opts.goals ?? 'onboarding,audit,security-review';
  const goals = goalStr.split(',').map(g => g.trim()) as GoalType[];
  const validGoals = ['onboarding', 'audit', 'audit-generic', 'migration', 'component-map', 'ci-check', 'security-review', 'nextjs', 'accessibility'];
  for (const g of goals) {
    if (!validGoals.includes(g)) {
      throw new Error(`Invalid goal: ${g}. Valid: ${validGoals.join(', ')}`);
    }
  }

  const budget = parseInt(opts.budget ?? '45', 10);
  const verbose = opts.verbose ?? false;

  return runGauntlet(opts.repos, goals, budget, verbose);
}
