/**
 * Agent runner — the top-level orchestrator for a single investigation run.
 *
 * This is the main entry point (runAgent) that wires together all the pieces:
 *   - State initialization and checkpoint resume   (stateMerge, sessionCheckpoint)
 *   - Pre-computation of repo signals              (preCompute)
 *   - Prompt assembly                              (systemPrompt, goalPrompts)
 *   - Tool registration                            (piToolAdapter)
 *   - Dual-model cost optimization                 (piModel, switchModelInPlace)
 *   - Budget enforcement via Pi hooks              (beforeToolCall / afterToolCall)
 *   - Context compression                          (contextCompression)
 *   - Post-loop verification and dedup             (verifyEvidence, deduplicateFindings)
 *   - Output rendering and persistence             (scorecard, brief, outputWriter)
 *
 * Mutable orchestration state (budget counters, model switch flags, termination
 * state) and the hook methods (beforeToolCall, afterToolCall, handleAgentEvent)
 * are encapsulated in AgentLoopContext — an instantiable class that enables
 * parallel workers in later stages while keeping the runner's behavior identical.
 *
 * Re-exports from extracted modules maintain backward compatibility:
 * all consumers continue importing from './runner.js'.
 */

import { Agent } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import type { AgentState } from '../types/state.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildGoalPrompt, buildClusterPrompt } from './goalPrompts.js';
import { BOUNDARY_SYSTEM_INSTRUCTION } from './contextBoundary.js';
import { withRetry } from './retry.js';
import { buildPiTools } from '../tools/piToolAdapter.js';
import { verifyFindingEvidence } from '../tools/analysis/verifyEvidence.js';
import { resolveAndRead, type ResolveResult } from '../tools/utils/resolveAndRead.js';
import { deduplicateFindings } from '../tools/analysis/deduplicateFindings.js';
import { buildPiModel } from '../config/piModel.js';
import {
  TOOL_CALL_BUDGET,
  WEB_SEARCH_BUDGET,
  URL_FETCH_BUDGET,
  DOC_TOKEN_BUDGET,
  CHECKPOINT_INTERVAL,
} from '../config/defaults.js';
import { computeScorecard } from '../output/scorecard.js';
import { renderBrief } from '../output/brief.js';
import { buildFullExport, serializeExport, type SourceFile } from '../output/json.js';
import { detectLanguage } from '../tools/utils/detectLanguage.js';
import { readFile as readFileAsync } from 'node:fs/promises';
import { saveSessionCost, buildSessionCostEntry } from '../output/sessionCosts.js';
import {
  saveCheckpoint, buildCheckpointEntry, buildSessionId,
  loadLatestCheckpoint, hydrateState, buildResumeSummary,
} from '../output/sessionCheckpoint.js';
import fs from 'node:fs';
import path from 'node:path';
import { setMaxListeners } from 'node:events';

import type { RunnerConfig, RunResult } from './runnerTypes.js';
import { runPreCompute, formatPreComputeContext, type PreComputeResult } from './preCompute.js';
import { mergeState } from './stateMerge.js';
import { createTransformContext, createOnPayload } from './contextCompression.js';
import { buildMetrics } from './usageTracking.js';
import { writeOutputFiles } from './outputWriter.js';
import { autoAssembleFromFindings } from './autoAssemble.js';
import { AgentLoopContext } from './agentLoopContext.js';
import { logger } from '../lib/logger.js';

// Re-export public API so existing consumers don't break
export type { RunnerConfig, StepEvent, RunResult } from './runnerTypes.js';
export type { PreComputeResult } from './preCompute.js';
export { runPreCompute, formatPreComputeContext } from './preCompute.js';
export { mergeState } from './stateMerge.js';
export { writeOutputFiles } from './outputWriter.js';
export async function runAgent(config: RunnerConfig): Promise<RunResult> {
  // ─── Phase 1: Setup ──────────────────────────────────────────────────
  // Initialize state, restore checkpoints, run pre-computation, build prompts.

  setMaxListeners(100);
  const startedAt = new Date();

  logger.info('Agent run starting', {
    context: `goal=${config.goal} repo=${config.repoName}`,
  });

  const _rawOnStep = config.onStep;
  if (_rawOnStep) {
    const _workerId = config.workerId;
    config.onStep = (event) => _rawOnStep({
      ...event,
      timestamp: new Date().toISOString(),
      ...(_workerId ? { workerId: _workerId } : {}),
    });
  }

  const toolCallBudget = config.toolCallBudget ?? TOOL_CALL_BUDGET;
  const webSearchBudget = config.webSearchBudget ?? WEB_SEARCH_BUDGET;
  const urlFetchBudget = config.urlFetchBudget ?? URL_FETCH_BUDGET;
  const docTokenBudget = config.docTokenBudget ?? DOC_TOKEN_BUDGET;
  const outputDir = config.outputDir ?? './output';

  // Initialize state
  const state: AgentState = {
    goal: config.goal,
    repo: {
      source: config.repoSource,
      url: config.repoUrl,
      localPath: config.repoPath,
      name: config.repoName,
    },
    resolvedVersions: {},
    findings: [],
    filesRead: new Set(),
    toolCallCount: 0,
    totalToolCallsExecuted: 0,
    toolCallBudget,
    webSearchCount: 0,
    webSearchBudget,
    urlFetchCount: 0,
    urlFetchBudget,
    docTokensUsed: 0,
    docTokenBudget,
    fetchedDocs: [],
    investigationLog: [],
    modelUsage: new Map(),
    fileReadCache: new Map(),
  };

  // Session checkpoint tracking
  let sessionId = buildSessionId(config.repoName, config.goal);
  let checkpointSeq = 0;
  const checkpointInterval = config.checkpointInterval ?? CHECKPOINT_INTERVAL;
  const repoSlug = config.repoName.replace(/[^a-zA-Z0-9_-]/g, '-');

  // Apply initial state from prior pass (tiered investigation)
  if (config.initialState) {
    mergeState(state, config.initialState);
    config.onStep?.({
      step: 0,
      action: 'initial_state',
      type: 'tool_call',
      result: `Loaded initial state: ${state.findings.length} findings, ${state.filesRead.size} files read.`,
    });
  }

  // Resume from checkpoint if provided
  if (config.resumeFrom) {
    const checkpoint = loadLatestCheckpoint(config.resumeFrom);
    if (checkpoint) {
      const hydrated = hydrateState(checkpoint.state);
      mergeState(state, hydrated);
      state.toolCallCount = hydrated.toolCallCount;
      state.webSearchCount = hydrated.webSearchCount;
      state.urlFetchCount = hydrated.urlFetchCount;
      state.docTokensUsed = hydrated.docTokensUsed;
      state.investigationLog = hydrated.investigationLog;
      state.toolCallBudget = Math.max(hydrated.toolCallBudget, toolCallBudget);
      state.webSearchBudget = hydrated.webSearchBudget;
      state.urlFetchBudget = hydrated.urlFetchBudget;
      state.docTokenBudget = hydrated.docTokenBudget;
      sessionId = checkpoint.sessionId;
      checkpointSeq = checkpoint.seq;
      config.onStep?.({
        step: 0,
        action: 'resume',
        type: 'budget_warning',
        result: `Resumed from checkpoint seq=${checkpoint.seq} (${state.findings.length} findings, ${state.toolCallCount}/${state.toolCallBudget} tool calls used).`,
      });
    } else {
      config.onStep?.({
        step: 0,
        action: 'resume_failed',
        type: 'budget_warning',
        result: `No valid checkpoint found at ${config.resumeFrom}. Starting fresh.`,
      });
    }
  }

  const platform = config.platform ?? 'unknown';

  // Pre-compute deterministic tool results to seed the agent's initial context.
  let preComputeContext = '';
  if (!config.resumeFrom) {
    try {
      const preComputed = config.preCompute ?? await runPreCompute(config.repoPath, config.appRoot);
      preComputeContext = formatPreComputeContext(preComputed);
      config.onStep?.({
        step: 0,
        action: 'pre_compute',
        type: 'tool_call',
        result: `Pre-computed: ${preComputed.appRoots ? preComputed.appRoots.roots.length + ' app roots' : 'no roots'}, ${preComputed.specialists ? preComputed.specialists.specialists.length + ' specialists' : 'no specialists'}, ${preComputed.packageJson ? 'package.json' : 'no package.json'}, ${preComputed.fileTree ? preComputed.fileTree.entries.length + ' entries' : 'no tree'}`,
        details: {
          roots: preComputed.appRoots?.roots.map(r => ({
            path: r.path,
            type: r.type,
            framework: r.framework,
            frameworkVersion: r.frameworkVersion,
            plugins: r.plugins,
          })),
          specialists: preComputed.specialists?.specialists.map(s => ({
            name: s.name,
            relevance: s.relevance,
          })),
          monorepoTool: preComputed.appRoots?.monorepoTool,
          packageName: preComputed.packageJson?.name,
        },
      });
    } catch {
      // Graceful — agent proceeds without pre-computed context
    }
  }

  // Build prompts
  const systemPrompt = await buildSystemPrompt(config.goal, platform) + '\n\n---\n\n' + BOUNDARY_SYSTEM_INSTRUCTION;
  let goalPrompt = config.mode === 'worker' && config.workerId && config.allowedCategories?.length
    ? buildClusterPrompt(config.workerId, config.allowedCategories as import('../types/findings.js').FindingCategory[], config.repoPath, toolCallBudget, webSearchBudget)
    : buildGoalPrompt(config.goal, config.repoPath, toolCallBudget, webSearchBudget);

  if (preComputeContext) {
    goalPrompt += `\n\n---\n\n${preComputeContext}`;
  }

  if (config.resumeFrom && state.findings.length > 0) {
    const summary = buildResumeSummary(state);
    goalPrompt = `RESUME CONTEXT — This is a resumed investigation. Here is what was found before the interruption:\n\n${summary}\n\nContinue the investigation from where it left off. Do not re-investigate files already read. Focus on uncovered categories and assembling the final output.\n\n---\n\n${goalPrompt}`;
  }

  const isWorker = config.mode === 'worker';

  // Build Pi tools from registry, wiring finding progress events to onStep
  const { tools, assembledRef, cleanup, mutex } = buildPiTools(state, (progress) => {
    config.onStep?.({
      step: ctx.stepCount,  // ctx captured by closure — safe because callback fires after ctx init
      action: 'record_finding',
      type: 'finding_progress',
      timestamp: new Date().toISOString(),
      details: { ...progress },
      result: progress.phase === 'finding_recorded'
        ? `Finding ${progress.findingIndex}/${progress.findingTotal} recorded: ${progress.findingId}`
        : progress.phase === 'verifying_evidence'
          ? `Verifying evidence ${progress.evidenceIndex}/${progress.evidenceTotal} for ${progress.findingId}: ${progress.evidenceFile}`
          : `Evidence ${progress.evidenceIndex}/${progress.evidenceTotal} ${progress.evidenceStatus}: ${progress.evidenceFile}`,
    });
  }, { mode: config.mode ?? 'full' });

  // Build Pi models (or use provided overrides, e.g. faux provider for testing)
  let apiKey: string | undefined;
  let piModel: Model<any>;
  let piFastModel: Model<any>;
  if (config.model) {
    piModel = config.model;
    piFastModel = config.fastModel ?? config.model;
  } else {
    const built = buildPiModel();
    piModel = built.model;
    piFastModel = built.fastModel;
    apiKey = built.apiKey;
  }

  // ─── Phase 2: Orchestration context ────────────────────────────────────
  // All mutable state (budget counters, model switch flags, warning sentinels)
  // and hook methods (beforeToolCall, afterToolCall, handleAgentEvent) are
  // encapsulated in AgentLoopContext for reuse by parallel workers.

  logger.debug('Setup phase complete', {
    context: `budget=${toolCallBudget} precompute=${!!preComputeContext} resumed=${!!config.resumeFrom}`,
  });

  const ctx = new AgentLoopContext({
    toolCallBudget,
    config,
    state,
    assembledRef,
    piModel,
    piFastModel,
    compressionState: { findings: state.findings, snipBoundaryActive: false },
    clearSummaryCache: () => {},  // placeholder — set after createTransformContext
    outputDir,
    repoSlug,
    sessionId,
    checkpointInterval,
    webSearchBudget,
    urlFetchBudget,
  });

  // Sync checkpoint seq from resume (if any)
  ctx.checkpointSeq = checkpointSeq;

  // Context compression (extracted module — shared mutable state via object references)
  const { transformContext: rawTransformContext, clearSummaryCache } = createTransformContext(
    ctx.compressionState,
    { toolCallIdToFiles: ctx.toolCallIdToFiles, toolCallIdToName: ctx.toolCallIdToName },
  );
  const transformContext = async (messages: Parameters<typeof rawTransformContext>[0]) => {
    const startMs = Date.now();
    const result = await rawTransformContext(messages);
    const elapsed = Date.now() - startMs;
    if (elapsed > 0) {
      ctx.lastCompressionMs = elapsed;
      ctx.compressionStats.totalMs += elapsed;
      ctx.compressionStats.calls++;
      ctx.compressionStats.totalMessagesDropped += messages.length - result.length;
    }
    return result;
  };
  ctx.clearSummaryCache = clearSummaryCache;

  const onPayload = createOnPayload();

  // ─── Phase 4: Agent creation & event subscription ────────────────────
  // Wire up all hooks, context compression, and prompt caching into the Pi Agent.

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: piModel,
      thinkingLevel: 'low',
      tools,
    },
    toolExecution: 'parallel',
    transformContext,
    onPayload,
    sessionId,
    ...(apiKey ? { getApiKey: async () => apiKey } : {}),
    beforeToolCall: ctx.beforeToolCall.bind(ctx),
    afterToolCall: ctx.afterToolCall.bind(ctx),
  });
  ctx.agent = agent;

  agent.subscribe(ctx.handleAgentEvent.bind(ctx));

  // ─── Phase 5: Agent execution ─────────────────────────────────────────
  // Run the agent loop with retry on transient API errors.
  // If the agent finishes without calling assemble_output, nudge it up to
  // 2 times, then fall back to auto-assembly from recorded findings.

  logger.debug('Execution phase starting', {
    context: `model=${piModel.id} fastModel=${piFastModel.id} tools=${tools.length}`,
  });
  logger.info('Agent loop starting', { context: `budget=${toolCallBudget} mode=${config.mode ?? 'full'}` });

  try {
    await withRetry(() => agent.prompt(goalPrompt), {
      onRetry: (attempt, error, delayMs, classification) => {
        ctx.recordRetry(delayMs, classification.statusCode);
        const status = classification.statusCode ? ` [${classification.statusCode}]` : '';
        const stale = classification.staleConnection ? ' (stale connection)' : '';
        config.onStep?.({
          step: ctx.stepCount,
          action: 'retry',
          type: 'budget_warning',
          result: `API error${status}${stale} (attempt ${attempt}/${classification.maxRetries}): ${error.message}. Retrying in ${Math.round(delayMs / 1000)}s...`,
        });
      },
    });

    // Post-loop retry nudges — full mode only (workers just record findings)
    if (!isWorker && assembledRef.sections === null && (ctx.terminationReason as string) !== 'completed') {
      if (!ctx.modelSwitched && ctx.canSwitchModel) {
        ctx.modelSwitched = true;
        ctx.switchModelInPlace();
        agent.state.model = piModel;
      }
      for (let retry = 0; retry < 2; retry++) {
        agent.followUp({
          role: 'user',
          content: 'You must call assemble_output now with written content for all required sections. Use your investigation findings to write the brief.',
          timestamp: Date.now(),
        });
        await withRetry(() => agent.continue(), {
          maxRetries: 2,
          onRetry: (attempt, error, delayMs, classification) => {
            ctx.recordRetry(delayMs, classification.statusCode);
            const status = classification.statusCode ? ` [${classification.statusCode}]` : '';
            config.onStep?.({
              step: ctx.stepCount,
              action: 'retry',
              type: 'budget_warning',
              result: `Retry nudge${status} attempt ${attempt}: ${error.message}`,
            });
          },
        });
        if (assembledRef.sections !== null) {
          ctx.terminationReason = 'completed';
          break;
        }
      }
      if (assembledRef.sections === null) {
        assembledRef.sections = autoAssembleFromFindings(state);
        ctx.terminationReason = state.findings.length > 0 ? 'completed' : 'stuck';
        config.onStep?.({
          step: ctx.stepCount,
          action: 'auto_assemble',
          type: 'assemble_output',
          result: `Auto-assembled from ${state.findings.length} findings (LLM did not call assemble_output).`,
        });
      }
    }
  } catch (err) {
    if (ctx.terminationReason === 'completed') {
      // Expected — assemble_output triggered termination
    } else {
      ctx.terminationReason = 'error';
      ctx.errorDetail = (err as Error).message;
      logger.error('Agent loop error', { context: ctx.errorDetail });
      if (checkpointInterval > 0) {
        try {
          saveCheckpoint(outputDir, repoSlug,
            buildCheckpointEntry(sessionId, ++ctx.checkpointSeq, 'error', state));
        } catch { /* best-effort */ }
      }
      config.onStep?.({
        step: ctx.stepCount,
        action: 'error',
        type: 'budget_warning',
        result: `Agent error: ${ctx.errorDetail}. Producing partial output.`,
      });
      if (assembledRef.sections === null && state.findings.length > 0) {
        assembledRef.sections = autoAssembleFromFindings(state);
      }
    }
  }

  // Drain the mutex before returning — ensures in-flight record_finding calls complete.
  await mutex.drain();

  // Worker mode: return minimal result with findings + metrics, skip full post-processing.
  if (isWorker) {
    cleanup();
    const completedAt = new Date();
    const metrics = buildMetrics(state, startedAt, completedAt, ctx.totalLlmMs, ctx.turnCount, ctx.getToolMetrics(), ctx.getDiagnostics());
    return {
      scorecard: computeScorecard(config.repoName, config.goal, state.findings),
      briefMarkdown: '',
      exportJson: '',
      outputPaths: [],
      metrics,
      state,
      terminationReason: state.findings.length > 0 ? 'completed' : ctx.terminationReason,
      errorDetail: ctx.errorDetail,
    };
  }

  // ─── Phase 6: Post-processing (full mode only) ───────────────────────
  // Verify evidence, deduplicate findings, compute scorecard, render brief,
  // and write all output files.

  logger.debug('Post-processing phase starting', {
    context: `findings=${state.findings.length} toolCalls=${state.toolCallCount} termination=${ctx.terminationReason}`,
  });

  const sections = assembledRef.sections ?? {};

  config.onStep?.({
    step: ++ctx.stepCount,
    action: 'post_process',
    type: 'verification',
    result: `Verifying evidence for ${state.findings.length} findings...`,
  });

  const uniqueEvidencePaths = new Set<string>();
  for (const f of state.findings) {
    for (const ev of f.evidence) uniqueEvidencePaths.add(ev.filePath);
  }
  const fileContentCache = new Map<string, ResolveResult>();
  await Promise.all([...uniqueEvidencePaths].map(async (fp) => {
    fileContentCache.set(fp, await resolveAndRead(config.repoPath, fp));
  }));

  const verificationResults = await Promise.all(
    state.findings.map((finding) => verifyFindingEvidence(config.repoPath, finding, fileContentCache)),
  );

  const removedFindingIds: string[] = [];
  const verifiedFindings = [];
  for (let i = 0; i < verificationResults.length; i++) {
    const { finding: verified, allUnverifiable } = verificationResults[i];
    if (allUnverifiable) {
      removedFindingIds.push(state.findings[i].id);
    } else {
      verifiedFindings.push(verified);
    }
  }
  state.findings = verifiedFindings;

  if (removedFindingIds.length > 0 || state.findings.some((f) => f.verificationNotes?.length)) {
    config.onStep?.({
      step: ++ctx.stepCount,
      action: 'verification_pass',
      type: 'verification',
      result: removedFindingIds.length > 0
        ? `Verification: removed ${removedFindingIds.length} finding(s) with all-unverifiable evidence [${removedFindingIds.join(', ')}]. ${state.findings.length} findings retained.`
        : `Verification: all ${state.findings.length} findings verified.`,
    });
  }

  const dedupResult = deduplicateFindings(state.findings);
  state.findings = dedupResult.findings;
  if (dedupResult.mergedCount > 0) {
    config.onStep?.({
      step: ++ctx.stepCount,
      action: 'deduplication',
      type: 'verification',
      result: `Deduplication: merged ${dedupResult.mergedCount} duplicate finding(s). ${state.findings.length} findings retained.`,
    });
  }

  // ─── Source file capture ──────────────────────────────────────────────
  // Read full content of every evidence-referenced file for the dashboard
  // file viewer. Uses direct fs.readFile (bypasses the 60K resolveAndRead
  // budget) with a 500KB per-file safety cap.
  const MAX_SOURCE_BYTES = 500_000;
  const sourcePaths = new Set<string>();
  for (const f of state.findings) {
    for (const ev of f.evidence) sourcePaths.add(ev.filePath);
  }
  const sources: Record<string, SourceFile> = {};
  await Promise.all([...sourcePaths].map(async (fp) => {
    try {
      const abs = path.resolve(config.repoPath, fp);
      if (!abs.startsWith(path.resolve(config.repoPath))) return;
      const raw = await readFileAsync(abs, 'utf-8');
      if (raw.length > MAX_SOURCE_BYTES) return;
      const lineCount = raw.split('\n').length;
      sources[fp] = { content: raw, lineCount, language: detectLanguage(fp) };
    } catch { /* file may have been deleted since investigation — skip */ }
  }));

  config.onStep?.({
    step: ++ctx.stepCount,
    action: 'post_process',
    type: 'verification',
    result: 'Computing scorecard and rendering output...',
  });

  const scorecard = computeScorecard(config.repoName, config.goal, state.findings);

  scorecard.metadata.repoUrl = config.repoUrl;
  scorecard.metadata.detectedPlatform = platform;
  scorecard.metadata.toolCallsUsed = state.totalToolCallsExecuted;
  scorecard.metadata.webSearchesUsed = state.webSearchCount;
  scorecard.metadata.urlFetchesUsed = state.urlFetchCount;
  scorecard.metadata.documentationSources = state.fetchedDocs.map((d) => ({ url: d.url, title: d.title }));

  const completedAt = new Date();
  const metrics = buildMetrics(state, startedAt, completedAt, ctx.totalLlmMs, ctx.turnCount, ctx.getToolMetrics(), ctx.getDiagnostics());

  const briefMarkdown = renderBrief(
    scorecard,
    sections,
    state.investigationLog,
    state.fetchedDocs,
    state.toolCallCount,
    ctx.currentBudget,
    metrics,
  );

  const fullExport = buildFullExport(state, scorecard, sections, metrics, ctx.terminationReason, ctx.currentBudget, sources);
  const exportJson = serializeExport(fullExport);

  const outputPaths = writeOutputFiles(
    outputDir,
    config.repoName,
    scorecard,
    briefMarkdown,
    exportJson,
    state,
    sources,
  );

  try {
    const costEntry = buildSessionCostEntry(config.repoName, config.goal, metrics);
    saveSessionCost(outputDir, costEntry);
  } catch { /* best-effort — don't fail the run for cost tracking */ }

  if (ctx.terminationReason === 'error' || ctx.terminationReason === 'stuck') {
    const debugPath = path.join(outputDir, `${config.repoName.replace(/[^a-zA-Z0-9-]/g, '-')}-debug.log`);
    const debugContent = [
      `Termination: ${ctx.terminationReason}`,
      ctx.errorDetail ? `Error: ${ctx.errorDetail}` : '',
      `Tool calls: ${state.toolCallCount} / ${ctx.currentBudget}`,
      `Findings: ${state.findings.length}`,
      `Steps: ${ctx.stepCount}`,
      `Sections: ${Object.keys(sections).length}`,
    ].join('\n');
    fs.writeFileSync(debugPath, debugContent, 'utf-8');
    outputPaths.push(debugPath);
  }

  cleanup();

  logger.info('Agent run completed', {
    context: `termination=${ctx.terminationReason} findings=${state.findings.length}`,
    duration: metrics.durationMs,
  });

  return {
    scorecard,
    briefMarkdown,
    exportJson,
    outputPaths,
    metrics,
    state,
    terminationReason: ctx.terminationReason,
    errorDetail: ctx.errorDetail,
    sources,
  };
}
