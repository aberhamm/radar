/**
 * Synthesis runner — a lightweight agent that reviews merged findings from
 * parallel cluster workers, identifies cross-cutting patterns, and produces
 * the assembled output sections.
 *
 * Uses the fast model (Haiku) since this is writing, not investigating.
 * Limited tool set: record_finding, assemble_output, read_file, read_files_batch.
 */

import { Agent } from '@mariozechner/pi-agent-core';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import type { AgentState, GoalType } from '../types/state.js';
import type { Finding } from '../types/findings.js';
import type { StepEvent, RunResult } from './runnerTypes.js';
import { buildPiModel } from '../config/piModel.js';
import { buildPiTools, type AssembledSections } from '../tools/piToolAdapter.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { BOUNDARY_SYSTEM_INSTRUCTION } from './contextBoundary.js';
import { withRetry } from './retry.js';
import { autoAssembleFromFindings } from './autoAssemble.js';
import { AgentLoopContext } from './agentLoopContext.js';
import { createTransformContext, createOnPayload } from './contextCompression.js';
import { buildMetrics } from './usageTracking.js';

export interface SynthesisConfig {
  repoPath: string;
  repoName: string;
  goal: GoalType;
  findings: Finding[];
  toolCallBudget?: number;
  outputDir?: string;
  onStep?: (step: StepEvent) => void;
  model?: Model<any>;
  fastModel?: Model<any>;
}

export interface SynthesisResult {
  sections: Record<string, string>;
  crossCuttingFindings: Finding[];
  metrics: RunResult['metrics'];
  terminationReason: RunResult['terminationReason'];
}

function serializeFindings(findings: Finding[]): string {
  return findings.map((f, i) => {
    const evidence = f.evidence.map(e => `  - ${e.filePath}${e.lineNumber ? ':' + e.lineNumber : ''}: ${e.description}`).join('\n');
    return `[${i + 1}] ${f.id} (${f.category}, ${f.severity}, confidence: ${f.confidence ?? '?'})
  ${f.title}
  ${f.description.slice(0, 200)}${f.description.length > 200 ? '...' : ''}
${evidence}`;
  }).join('\n\n');
}

export async function runSynthesis(config: SynthesisConfig): Promise<SynthesisResult> {
  const startedAt = new Date();
  const budget = config.toolCallBudget ?? 10;
  const outputDir = config.outputDir ?? './output';

  const state: AgentState = {
    goal: config.goal,
    repo: { source: 'local', localPath: config.repoPath, name: config.repoName },
    resolvedVersions: {},
    findings: [...config.findings],
    filesRead: new Set(),
    toolCallCount: 0,
    totalToolCallsExecuted: 0,
    toolCallBudget: budget,
    webSearchCount: 0,
    webSearchBudget: 0,
    urlFetchCount: 0,
    urlFetchBudget: 0,
    docTokensUsed: 0,
    docTokenBudget: 0,
    fetchedDocs: [],
    investigationLog: [],
    modelUsage: new Map(),
    fileReadCache: new Map(),
  };

  const { tools: allTools, assembledRef, cleanup, mutex } = buildPiTools(state);

  // Synthesis only needs: record_finding, assemble_output, read_file, read_files_batch
  const SYNTHESIS_TOOLS = new Set(['record_finding', 'assemble_output', 'read_file', 'read_files_batch']);
  const tools: AgentTool[] = allTools.filter(t => SYNTHESIS_TOOLS.has(t.name));

  let piModel: Model<any>;
  let piFastModel: Model<any>;
  let apiKey: string | undefined;
  if (config.fastModel) {
    piModel = config.fastModel;
    piFastModel = config.fastModel;
  } else if (config.model) {
    piModel = config.model;
    piFastModel = config.model;
  } else {
    const built = buildPiModel();
    piModel = built.fastModel;
    piFastModel = built.fastModel;
    apiKey = built.apiKey;
  }

  const ctx = new AgentLoopContext({
    toolCallBudget: budget,
    config: {
      repoPath: config.repoPath,
      repoName: config.repoName,
      repoSource: 'local',
      goal: config.goal,
      toolCallBudget: budget,
      outputDir,
      onStep: config.onStep ? (event) => config.onStep!({ ...event, workerId: 'synthesis', timestamp: new Date().toISOString() }) : undefined,
    },
    state,
    assembledRef,
    piModel,
    piFastModel,
    compressionState: { findings: state.findings, snipBoundaryActive: false },
    clearSummaryCache: () => {},
    outputDir,
    repoSlug: config.repoName.replace(/[^a-zA-Z0-9_-]/g, '-'),
    sessionId: `synthesis-${Date.now()}`,
    checkpointInterval: 0,
    webSearchBudget: 0,
    urlFetchBudget: 0,
  });

  const { transformContext, clearSummaryCache } = createTransformContext(
    ctx.compressionState,
    { toolCallIdToFiles: ctx.toolCallIdToFiles, toolCallIdToName: ctx.toolCallIdToName },
  );
  ctx.clearSummaryCache = clearSummaryCache;

  const systemPrompt = await buildSystemPrompt(config.goal, 'unknown') + '\n\n---\n\n' + BOUNDARY_SYSTEM_INSTRUCTION;

  const findingSummary = serializeFindings(config.findings);
  const goalPrompt = `You are the SYNTHESIS agent. ${config.findings.length} findings have been gathered by parallel investigation workers.

Your job:
1. Review all findings below for cross-cutting patterns (issues that span multiple categories).
2. If you spot a cross-cutting connection, call record_finding to add it (category: the most relevant one, tag it "cross-cutting").
3. Call assemble_output with written narrative sections for the brief.

You may use read_file or read_files_batch to verify cross-category connections, but do NOT investigate new areas. Your budget is ${budget} tool calls.

FINDINGS FROM WORKERS:
${findingSummary}

Call assemble_output when ready. Include an executive-summary section that synthesizes the overall picture.`;

  const agent = new Agent({
    initialState: { systemPrompt, model: piModel, thinkingLevel: 'off', tools },
    toolExecution: 'parallel',
    transformContext,
    onPayload: createOnPayload(),
    sessionId: ctx.sessionId,
    ...(apiKey ? { getApiKey: async () => apiKey } : {}),
    beforeToolCall: ctx.beforeToolCall.bind(ctx),
    afterToolCall: ctx.afterToolCall.bind(ctx),
  });
  ctx.agent = agent;
  agent.subscribe(ctx.handleAgentEvent.bind(ctx));

  try {
    await withRetry(() => agent.prompt(goalPrompt), {
      onRetry: (attempt, error, delayMs, classification) => {
        config.onStep?.({
          step: ctx.stepCount,
          action: 'retry',
          type: 'budget_warning',
          workerId: 'synthesis',
          result: `Synthesis retry (attempt ${attempt}): ${error.message}`,
        });
      },
    });
  } catch {
    // Synthesis is best-effort
  }

  await mutex.drain();
  cleanup();

  const sections = assembledRef.sections ?? autoAssembleFromFindings(state);
  const crossCuttingFindings = state.findings.filter(f =>
    !config.findings.some(orig => orig.id === f.id),
  );

  const completedAt = new Date();
  const metrics = buildMetrics(state, startedAt, completedAt, ctx.totalLlmMs, ctx.turnCount);

  return {
    sections,
    crossCuttingFindings,
    metrics,
    terminationReason: assembledRef.sections !== null ? 'completed' : 'budget_exhausted',
  };
}
