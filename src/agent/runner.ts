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
 * The beforeToolCall and afterToolCall hooks stay inline here because they
 * are the orchestration logic — they read and mutate 15+ closure variables
 * (budget counters, model switch flags, termination state). Extracting them
 * would require a large mutable context object that recreates the same
 * coupling with worse readability.
 *
 * Re-exports from extracted modules maintain backward compatibility:
 * all consumers continue importing from './runner.js'.
 */

import { Agent } from '@mariozechner/pi-agent-core';
import { randomUUID } from 'node:crypto';
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AgentEvent,
} from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import type { AgentState } from '../types/state.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildGoalPrompt } from './goalPrompts.js';
import { redactSecrets } from './redaction.js';
import { wrapInBoundary, BOUNDARY_SYSTEM_INSTRUCTION, validateFindingContent, sanitizeToolOutput } from './contextBoundary.js';
import { withRetry } from './retry.js';
import { buildPiTools, type AssembledSections } from '../tools/piToolAdapter.js';
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
  RECORDING_GATE_PCT,
  EXTENSION_GATE_PCT,
  BUDGET_EXTENSION,
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

import type { RunnerConfig, RunResult, StepEvent } from './runnerTypes.js';
import { runPreCompute, formatPreComputeContext, type PreComputeResult } from './preCompute.js';
import { mergeState } from './stateMerge.js';
import { createTransformContext, createOnPayload } from './contextCompression.js';
import { trackUsage, buildMetrics } from './usageTracking.js';
import { writeOutputFiles } from './outputWriter.js';
import { autoAssembleFromFindings } from './autoAssemble.js';

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

  const _rawOnStep = config.onStep;
  if (_rawOnStep) {
    config.onStep = (event) => _rawOnStep({ ...event, timestamp: new Date().toISOString() });
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
      });
    } catch {
      // Graceful — agent proceeds without pre-computed context
    }
  }

  // Build prompts
  const systemPrompt = await buildSystemPrompt(config.goal, platform) + '\n\n---\n\n' + BOUNDARY_SYSTEM_INSTRUCTION;
  let goalPrompt = buildGoalPrompt(config.goal, config.repoPath, toolCallBudget, webSearchBudget);

  if (preComputeContext) {
    goalPrompt += `\n\n---\n\n${preComputeContext}`;
  }

  if (config.resumeFrom && state.findings.length > 0) {
    const summary = buildResumeSummary(state);
    goalPrompt = `RESUME CONTEXT — This is a resumed investigation. Here is what was found before the interruption:\n\n${summary}\n\nContinue the investigation from where it left off. Do not re-investigate files already read. Focus on uncovered categories and assembling the final output.\n\n---\n\n${goalPrompt}`;
  }

  // Build Pi tools from registry, wiring finding progress events to onStep
  const { tools, assembledRef, cleanup, mutex } = buildPiTools(state, (progress) => {
    config.onStep?.({
      step: stepCount,
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
  });

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

  // ─── Phase 2: Budget & model switch state ─────────────────────────────
  // These mutable variables are shared across beforeToolCall, afterToolCall,
  // and the event subscriber. They stay as closure variables because the hooks
  // need direct access — this IS the orchestration state.

  let stepCount = 0;
  let currentBudget = toolCallBudget;
  let terminationReason: RunResult['terminationReason'] = 'budget_exhausted';
  let errorDetail: string | undefined;
  const halfBudget = Math.floor(toolCallBudget / 2);
  let budgetWarningRecordingSent = false;  // 40% budget used, 0 findings
  let budgetWarningHalfSent = false;       // 50% budget used
  let budgetWarning5Sent = false;          // 5 calls remaining
  let progressSummarySent = false;         // 70% budget used — progress checkpoint
  let modelSwitched = false;               // true once agent calls switch_to_fast_model
  let snipBoundaryActive = false;          // true after model switch — tighter compression
  const canSwitchModel = piFastModel.id !== piModel.id;
  // Maps for context compression: track which files each tool call touched
  const toolCallIdToFiles = new Map<string, Set<string>>();
  const toolCallIdToName = new Map<string, string>();

  /**
   * Switch the active model mid-loop by mutating the model object in place.
   *
   * Pi's _runLoop() captures `const model = this._state.model` once at the
   * start and passes it into the agent-loop config. setModel() replaces the
   * _state reference but the loop still holds the old object. By mutating
   * the original object's properties, the change is visible to the running
   * loop immediately — no abort/restart needed.
   */
  function switchModelInPlace(): void {
    if (!canSwitchModel) return;
    Object.assign(piModel, {
      id: piFastModel.id,
      name: piFastModel.name,
      cost: piFastModel.cost,
      maxTokens: piFastModel.maxTokens,
      reasoning: piFastModel.reasoning ?? false,
    });
    agent.state.thinkingLevel = 'off';
  }

  let lastAssistantReasoning = '';
  let lastAssistantThinking = '';
  let lastAssistantModel = '';
  const toolStartTimes = new Map<string, number>();
  const TRACE_RESULT_CAP = 10_240;
  let currentBatchId: string = randomUUID();
  let budgetExhaustedFired = false;
  let extensionGateFired = false;

  // Context compression (extracted module — shared mutable state via object references)
  const compressionState = { findings: state.findings, snipBoundaryActive: false };
  const { transformContext, clearSummaryCache } = createTransformContext(
    compressionState,
    { toolCallIdToFiles, toolCallIdToName },
  );

  // ─── Phase 3: Pi Agent hooks ──────────────────────────────────────────
  // beforeToolCall: gate tool calls based on budget, enforce recording deadlines.
  // afterToolCall: track counters, log steps, handle model switch, emit steering.

  const beforeToolCall = async (
    ctx: BeforeToolCallContext,
    _signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    const toolName = ctx.toolCall.name;

    if (terminationReason === 'completed' && toolName !== 'record_finding') {
      return { block: true, reason: 'Output assembly complete.' };
    }

    // Recording enforcement gate: when 60%+ budget is spent with zero findings,
    // offer budget extension first; only force recording mode if declined/unavailable.
    const WRITING_TOOLS = new Set(['record_finding', 'switch_to_fast_model', 'assemble_output']);
    if (
      state.findings.length === 0 &&
      state.toolCallCount >= Math.floor(currentBudget * RECORDING_GATE_PCT) &&
      state.toolCallCount < currentBudget &&
      !WRITING_TOOLS.has(toolName)
    ) {
      if (!budgetExhaustedFired && config.onBudgetExhausted) {
        budgetExhaustedFired = true;
        const shouldExtend = await config.onBudgetExhausted({
          findings: state.findings.length,
          toolCalls: state.toolCallCount,
          budget: currentBudget,
        });
        if (shouldExtend) {
          currentBudget += BUDGET_EXTENSION;
          state.toolCallBudget = currentBudget;
          budgetExhaustedFired = false;
          config.onStep?.({
            step: stepCount,
            action: 'budget_extended',
            type: 'budget_warning',
            newBudget: currentBudget,
            result: `Budget extended to ${currentBudget} tool calls. Continuing investigation.`,
          });
          return undefined;
        }
      }
      if (!modelSwitched && canSwitchModel) {
        modelSwitched = true;
        snipBoundaryActive = true;
        compressionState.snipBoundaryActive = true;
        clearSummaryCache();
        switchModelInPlace();
      }
      return {
        block: true,
        reason: `Investigation budget exhausted (${state.toolCallCount}/${currentBudget} calls used, 0 findings recorded). You MUST call record_finding now for what you have observed, then assemble_output.`,
      };
    }

    if (toolName === 'web_search' && state.webSearchCount >= webSearchBudget) {
      return { block: true, reason: 'Web search budget exhausted.' };
    }
    if (toolName === 'fetch_url' && state.urlFetchCount >= urlFetchBudget) {
      return { block: true, reason: 'URL fetch budget exhausted.' };
    }

    // Extension gate: at 80% budget, always offer extension (regardless of findings).
    // Separate from the 60% recording-enforcement gate and the 100% exhaustion gate.
    if (
      !extensionGateFired &&
      config.onBudgetExhausted &&
      state.toolCallCount >= Math.floor(currentBudget * EXTENSION_GATE_PCT) &&
      state.toolCallCount < currentBudget &&
      !WRITING_TOOLS.has(toolName)
    ) {
      extensionGateFired = true;
      const shouldExtend = await config.onBudgetExhausted({
        findings: state.findings.length,
        toolCalls: state.toolCallCount,
        budget: currentBudget,
      });
      if (shouldExtend) {
        currentBudget += BUDGET_EXTENSION;
        state.toolCallBudget = currentBudget;
        extensionGateFired = false;
        config.onStep?.({
          step: stepCount,
          action: 'budget_extended',
          type: 'budget_warning',
          newBudget: currentBudget,
          result: `Budget extended to ${currentBudget} tool calls. Continuing investigation.`,
        });
        return undefined;
      }
    }

    if (state.toolCallCount >= currentBudget) {
      if (toolName === 'assemble_output') {
        return undefined;
      }
      if (WRITING_TOOLS.has(toolName)) {
        return undefined;
      }

      if (!budgetExhaustedFired && config.onBudgetExhausted) {
        budgetExhaustedFired = true;
        const shouldExtend = await config.onBudgetExhausted({
          findings: state.findings.length,
          toolCalls: state.toolCallCount,
          budget: currentBudget,
        });
        if (shouldExtend) {
          currentBudget += BUDGET_EXTENSION;
          state.toolCallBudget = currentBudget;
          budgetExhaustedFired = false;
          config.onStep?.({
            step: stepCount,
            action: 'budget_extended',
            type: 'budget_warning',
            newBudget: currentBudget,
            result: `Budget extended to ${currentBudget} tool calls. Continuing investigation.`,
          });
          return undefined;
        }
      }

      if (checkpointInterval > 0) {
        try {
          saveCheckpoint(outputDir, repoSlug,
            buildCheckpointEntry(sessionId, ++checkpointSeq, 'budget_exhausted', state));
        } catch { /* best-effort */ }
      }
      return { block: true, reason: `Tool call budget exhausted (${currentBudget} calls used). Call assemble_output now.` };
    }

    return undefined;
  };

  // afterToolCall: runs after every tool execution — counters, logging, model switch, steering
  const afterToolCall = async (
    ctx: AfterToolCallContext,
    _signal?: AbortSignal,
  ): Promise<AfterToolCallResult | undefined> => {
    const toolName = ctx.toolCall.name;
    state.toolCallCount++;
    stepCount++;

    if (toolName === 'web_search') state.webSearchCount++;
    if (toolName === 'fetch_url') state.urlFetchCount++;

    // Track which files each toolCallId touched (for evidence pinning + stale collapsing)
    const tcId = ctx.toolCall.id;
    if (tcId) {
      toolCallIdToName.set(tcId, toolName);
      const args = ctx.args as Record<string, unknown>;
      const files = new Set<string>();
      if (toolName === 'read_file' && typeof args.path === 'string') {
        files.add(args.path.replace(/\\/g, '/').replace(/^\.\//, ''));
      } else if (toolName === 'read_files_batch' && Array.isArray(args.paths)) {
        for (const p of args.paths) if (typeof p === 'string') files.add(p.replace(/\\/g, '/').replace(/^\.\//, ''));
      } else if (toolName === 'grep_pattern' && typeof args.path === 'string') {
        files.add(args.path.replace(/\\/g, '/').replace(/^\.\//, ''));
      }
      if (files.size > 0) toolCallIdToFiles.set(tcId, files);
    }

    const reasoning = lastAssistantReasoning;
    const thinking = lastAssistantThinking;
    const resultText = ctx.result?.content?.[0]?.type === 'text'
      ? (ctx.result.content[0] as { type: 'text'; text: string }).text
      : '';
    const redactedResult = redactSecrets(resultText);
    const cleanResult = redactedResult.replaceAll(config.repoPath, '');
    const argsJson = JSON.stringify(ctx.args);
    const cappedResult = cleanResult.length > TRACE_RESULT_CAP
      ? cleanResult.slice(0, TRACE_RESULT_CAP) + `\n...[truncated ${cleanResult.length - TRACE_RESULT_CAP} chars]`
      : cleanResult;
    const startMs = tcId ? toolStartTimes.get(tcId) : undefined;
    const durationMs = startMs ? Date.now() - startMs : undefined;
    if (tcId) toolStartTimes.delete(tcId);

    state.investigationLog.push({
      step: stepCount,
      action: toolName,
      reasoning: reasoning.slice(0, 200),
      result: cleanResult.slice(0, 200),
      fullReasoning: reasoning || undefined,
      fullResult: cappedResult || undefined,
      args: argsJson !== '{}' && argsJson !== 'null' && argsJson !== 'undefined' ? argsJson : undefined,
      timestamp: new Date().toISOString(),
      model: lastAssistantModel || undefined,
      batchId: currentBatchId,
      durationMs,
      thinking: thinking || undefined,
    });

    // Keep compressionState.findings in sync (shared reference may diverge after dedup/filter)
    compressionState.findings = state.findings;

    const isFinding = toolName === 'record_finding';
    const isAssemble = toolName === 'assemble_output';
    const toolDetails = ctx.result?.details && typeof ctx.result.details === 'object' && Object.keys(ctx.result.details as object).length > 0
      ? ctx.result.details as Record<string, unknown>
      : undefined;
    const cappedRedacted = redactedResult.length > TRACE_RESULT_CAP
      ? redactedResult.slice(0, TRACE_RESULT_CAP) + `\n...[truncated]`
      : redactedResult;
    config.onStep?.({
      step: stepCount,
      action: toolName,
      reasoning: reasoning.slice(0, 100),
      result: redactedResult.slice(0, 100),
      type: isAssemble ? 'assemble_output' : isFinding ? 'finding' : 'tool_call',
      batchId: currentBatchId,
      ...(toolDetails ? { details: toolDetails } : {}),
      fullReasoning: reasoning,
      fullResult: cappedRedacted,
      args: argsJson,
      model: lastAssistantModel || undefined,
      durationMs,
      thinking: thinking || undefined,
    });

    if (checkpointInterval > 0 && state.toolCallCount % checkpointInterval === 0) {
      try {
        saveCheckpoint(outputDir, repoSlug,
          buildCheckpointEntry(sessionId, ++checkpointSeq, 'periodic', state));
      } catch { /* best-effort */ }
    }

    // Intent-based model switch: agent signals it's done investigating
    if (toolName === 'switch_to_fast_model' && !modelSwitched) {
      modelSwitched = true;
      snipBoundaryActive = true;
      compressionState.snipBoundaryActive = true;
      clearSummaryCache();
      if (canSwitchModel) {
        const fastId = piFastModel.id;
        switchModelInPlace();
        config.onStep?.({
          step: stepCount,
          action: 'model_switch',
          type: 'model_switch',
          result: `Switched to fast model (${fastId}) for writing phase. Agent signaled investigation complete. Snip boundary active — context compressed.`,
        });
      }
    }

    if (isFinding) {
      const args = ctx.args as { title?: string; description?: string };
      if (args.title && !validateFindingContent(args.title)) {
        config.onStep?.({
          step: stepCount,
          action: 'injection_warning',
          type: 'budget_warning',
          result: 'Potential prompt injection detected in finding content. Review manually.',
        });
      }
    }

    if (isAssemble && assembledRef.sections !== null) {
      terminationReason = 'completed';
      return { terminate: true };
    }

    if (redactedResult) {
      const sanitized = sanitizeToolOutput(redactedResult);
      const wrapped = wrapInBoundary(toolName, sanitized);
      return { content: [{ type: 'text', text: wrapped }] };
    }

    // Progress summary checkpoint at 70% budget
    const remaining = currentBudget - state.toolCallCount;
    if (
      !progressSummarySent &&
      assembledRef.sections === null &&
      state.toolCallCount >= Math.floor(currentBudget * 0.7) &&
      remaining > 0
    ) {
      progressSummarySent = true;
      const filesArr = [...state.filesRead].slice(0, 20);
      const findingTitles = state.findings.map((f) => `${f.category}: ${f.title}`);
      const categoriesCovered = new Set(state.findings.map((f) => f.category));
      const lines = [
        `PROGRESS CHECKPOINT — ${state.toolCallCount}/${currentBudget} tool calls used, ${remaining} remaining.`,
        `Files read (${state.filesRead.size} total): ${filesArr.join(', ')}${state.filesRead.size > 20 ? '...' : ''}`,
        `Findings recorded (${state.findings.length}): ${findingTitles.join('; ') || 'none yet'}`,
        `Categories covered: ${categoriesCovered.size > 0 ? [...categoriesCovered].join(', ') : 'none'}`,
        'Do NOT re-investigate files or areas already covered above. Focus remaining budget on uncovered categories, then record findings and assemble output.',
      ];
      agent.steer({
        role: 'user',
        content: lines.join('\n'),
        timestamp: Date.now(),
      });
    }

    // Budget warning steering messages
    if (remaining <= 5 && remaining > 0 && !budgetWarning5Sent && assembledRef.sections === null) {
      budgetWarning5Sent = true;
      if (!modelSwitched && canSwitchModel) {
        modelSwitched = true;
        snipBoundaryActive = true;
        compressionState.snipBoundaryActive = true;
        clearSummaryCache();
        const fastId = piFastModel.id;
        switchModelInPlace();
        config.onStep?.({
          step: stepCount,
          action: 'model_switch',
          type: 'model_switch',
          result: `Switched to fast model (${fastId}) — budget critical. Snip boundary active.`,
        });
      }
      agent.steer({
        role: 'user',
        content: state.findings.length === 0
          ? `CRITICAL: Only ${remaining} tool calls left and you have 0 findings recorded. Call record_finding IMMEDIATELY for each observation, then assemble_output. Do not investigate further.`
          : `CRITICAL: Only ${remaining} tool calls left. You MUST call assemble_output NOW with your written content for all required sections. Use your investigation so far — do not investigate further.`,
        timestamp: Date.now(),
      });
    } else if (remaining <= halfBudget && remaining > 0 && !budgetWarningHalfSent && assembledRef.sections === null) {
      budgetWarningHalfSent = true;
      agent.steer({
        role: 'user',
        content: `You have ${remaining} tool calls remaining out of ${currentBudget}. If you haven't called switch_to_fast_model yet, do it now. Then record your findings and call assemble_output.`,
        timestamp: Date.now(),
      });
    } else if (
      !budgetWarningRecordingSent &&
      assembledRef.sections === null &&
      state.findings.length === 0 &&
      state.toolCallCount >= Math.floor(currentBudget * 0.4) &&
      remaining > 0
    ) {
      budgetWarningRecordingSent = true;
      agent.steer({
        role: 'user',
        content: `You have used ${state.toolCallCount}/${currentBudget} tool calls and recorded 0 findings. Start calling record_finding NOW for what you have already observed. Investigate a category, then immediately record findings for it before moving to the next category. Do not defer all recording to the end.`,
        timestamp: Date.now(),
      });
    }

    return undefined;
  };

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
    beforeToolCall,
    afterToolCall,
  });

  // Per-turn timing instrumentation
  let turnStartMs = 0;
  let totalLlmMs = 0;
  let totalToolMs = 0;
  let turnCount = 0;

  // Subscribe to Pi Agent events for usage tracking, text streaming, and batchId rotation
  let streamingText = '';
  agent.subscribe((event: AgentEvent, _signal: AbortSignal) => {
    if (event.type === 'message_start' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      currentBatchId = randomUUID();
      streamingText = '';
      lastAssistantThinking = '';
      turnStartMs = Date.now();
      turnCount++;
    }

    if (event.type === 'message_update') {
      const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (ame?.type === 'text_delta' && ame.delta) {
        streamingText += ame.delta;
        config.onStep?.({
          step: stepCount,
          action: 'text_delta',
          type: 'text_delta',
          reasoning: streamingText,
        });
      } else if (ame?.type === 'thinking_delta' && ame.delta) {
        lastAssistantThinking += ame.delta;
      }
    }

    if (event.type === 'tool_execution_start') {
      const te = event as { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
      if (te.toolCallId) toolStartTimes.set(te.toolCallId, Date.now());
      config.onStep?.({
        step: stepCount,
        action: te.toolName ?? 'unknown',
        type: 'tool_start',
        args: te.args ? JSON.stringify(te.args) : undefined,
        batchId: currentBatchId,
      });
    }

    if (event.type === 'message_end' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      if (turnStartMs > 0) {
        totalLlmMs += Date.now() - turnStartMs;
        turnStartMs = 0;
      }

      const msg = event.message;
      lastAssistantModel = msg.model ?? '';
      trackUsage(state, msg.model, {
        inputTokens: msg.usage.input,
        outputTokens: msg.usage.output,
        cachedTokens: msg.usage.cacheRead,
      });

      if (Array.isArray(msg.content)) {
        const textParts = (msg.content as { type: string; text?: string }[])
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!);
        if (textParts.length > 0) {
          lastAssistantReasoning = textParts.join('\n').trim();

          if (lastAssistantReasoning) {
            config.onStep?.({
              step: stepCount,
              action: 'reasoning',
              type: 'text_response',
              reasoning: lastAssistantReasoning.slice(0, 100),
              fullReasoning: lastAssistantReasoning,
              model: lastAssistantModel || undefined,
              thinking: lastAssistantThinking || undefined,
            });
          }
        }

        // Extract thinking blocks from final message as fallback if deltas were missed
        if (!lastAssistantThinking) {
          const thinkingParts = (msg.content as { type: string; thinking?: string }[])
            .filter((c) => c.type === 'thinking' && c.thinking)
            .map((c) => c.thinking!);
          if (thinkingParts.length > 0) {
            lastAssistantThinking = thinkingParts.join('\n').trim();
          }
        }
      }
    }
  });

  // ─── Phase 5: Agent execution ─────────────────────────────────────────
  // Run the agent loop with retry on transient API errors.
  // If the agent finishes without calling assemble_output, nudge it up to
  // 2 times, then fall back to auto-assembly from recorded findings.

  try {
    await withRetry(() => agent.prompt(goalPrompt), {
      onRetry: (attempt, error, delayMs, classification) => {
        const status = classification.statusCode ? ` [${classification.statusCode}]` : '';
        const stale = classification.staleConnection ? ' (stale connection)' : '';
        config.onStep?.({
          step: stepCount,
          action: 'retry',
          type: 'budget_warning',
          result: `API error${status}${stale} (attempt ${attempt}/${classification.maxRetries}): ${error.message}. Retrying in ${Math.round(delayMs / 1000)}s...`,
        });
      },
    });

    if (assembledRef.sections === null && (terminationReason as string) !== 'completed') {
      if (!modelSwitched && canSwitchModel) {
        modelSwitched = true;
        switchModelInPlace();
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
          onRetry: (attempt, error, _delayMs, classification) => {
            const status = classification.statusCode ? ` [${classification.statusCode}]` : '';
            config.onStep?.({
              step: stepCount,
              action: 'retry',
              type: 'budget_warning',
              result: `Retry nudge${status} attempt ${attempt}: ${error.message}`,
            });
          },
        });
        if (assembledRef.sections !== null) {
          terminationReason = 'completed';
          break;
        }
      }
      if (assembledRef.sections === null) {
        assembledRef.sections = autoAssembleFromFindings(state);
        terminationReason = state.findings.length > 0 ? 'completed' : 'stuck';
        config.onStep?.({
          step: stepCount,
          action: 'auto_assemble',
          type: 'assemble_output',
          result: `Auto-assembled from ${state.findings.length} findings (LLM did not call assemble_output).`,
        });
      }
    }
  } catch (err) {
    if (terminationReason === 'completed') {
      // Expected — assemble_output triggered termination
    } else {
      terminationReason = 'error';
      errorDetail = (err as Error).message;
      if (checkpointInterval > 0) {
        try {
          saveCheckpoint(outputDir, repoSlug,
            buildCheckpointEntry(sessionId, ++checkpointSeq, 'error', state));
        } catch { /* best-effort */ }
      }
      config.onStep?.({
        step: stepCount,
        action: 'error',
        type: 'budget_warning',
        result: `Agent error: ${errorDetail}. Producing partial output.`,
      });
      if (assembledRef.sections === null && state.findings.length > 0) {
        assembledRef.sections = autoAssembleFromFindings(state);
      }
    }
  }

  // ─── Phase 6: Post-processing ─────────────────────────────────────────
  // Drain concurrent tool calls, verify evidence, deduplicate findings,
  // compute scorecard, render brief, and write all output files.

  // Drain the mutex: parallel tool calls (record_finding + assemble_output in same batch)
  // may still be running after termination. Without draining, those findings would be lost.
  await mutex.drain();

  const sections = assembledRef.sections ?? {};

  config.onStep?.({
    step: ++stepCount,
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
      step: ++stepCount,
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
      step: ++stepCount,
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
    step: ++stepCount,
    action: 'post_process',
    type: 'verification',
    result: 'Computing scorecard and rendering output...',
  });

  const scorecard = computeScorecard(config.repoName, config.goal, state.findings);

  scorecard.metadata.repoUrl = config.repoUrl;
  scorecard.metadata.detectedPlatform = platform;
  scorecard.metadata.toolCallsUsed = state.toolCallCount;
  scorecard.metadata.webSearchesUsed = state.webSearchCount;
  scorecard.metadata.urlFetchesUsed = state.urlFetchCount;
  scorecard.metadata.documentationSources = state.fetchedDocs.map((d) => ({ url: d.url, title: d.title }));

  const completedAt = new Date();
  const metrics = buildMetrics(state, startedAt, completedAt, totalLlmMs, turnCount);

  const briefMarkdown = renderBrief(
    scorecard,
    sections,
    state.investigationLog,
    state.fetchedDocs,
    state.toolCallCount,
    currentBudget,
    metrics,
  );

  const fullExport = buildFullExport(state, scorecard, sections, metrics, terminationReason, currentBudget, sources);
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

  if (terminationReason === 'error' || terminationReason === 'stuck') {
    const debugPath = path.join(outputDir, `${config.repoName.replace(/[^a-zA-Z0-9-]/g, '-')}-debug.log`);
    const debugContent = [
      `Termination: ${terminationReason}`,
      errorDetail ? `Error: ${errorDetail}` : '',
      `Tool calls: ${state.toolCallCount} / ${currentBudget}`,
      `Findings: ${state.findings.length}`,
      `Steps: ${stepCount}`,
      `Sections: ${Object.keys(sections).length}`,
    ].join('\n');
    fs.writeFileSync(debugPath, debugContent, 'utf-8');
    outputPaths.push(debugPath);
  }

  cleanup();

  return {
    scorecard,
    briefMarkdown,
    exportJson,
    outputPaths,
    metrics,
    state,
    terminationReason,
    errorDetail,
    sources,
  };
}
