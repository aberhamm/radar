import { Agent } from '@mariozechner/pi-agent-core';
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AgentEvent,
  AgentMessage,
} from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import type { AgentState, GoalType } from '../types/state.js';
import type { Scorecard, RunMetrics } from '../types/output.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildGoalPrompt } from './goalPrompts.js';
import { buildPiTools, type AssembledSections } from '../tools/piToolAdapter.js';
import { buildPiModel } from '../config/piModel.js';
import { computeScorecard } from '../output/scorecard.js';
import { renderBrief } from '../output/brief.js';
import { buildFullExport, serializeExport } from '../output/json.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load model pricing
interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cachedInputPerToken: number;
}
interface PricingConfig {
  models: Record<string, ModelPricing & { displayName: string }>;
  defaultPricing: ModelPricing;
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pricingPath = path.resolve(__dirname, '../config/model-pricing.json');
let pricingConfig: PricingConfig;
try {
  pricingConfig = JSON.parse(fs.readFileSync(pricingPath, 'utf-8'));
} catch {
  pricingConfig = {
    models: {},
    defaultPricing: { inputPerToken: 0.000003, outputPerToken: 0.000015, cachedInputPerToken: 0.0000003 },
  };
}

export interface RunnerConfig {
  repoPath: string;
  repoName: string;
  repoSource: 'github' | 'local';
  repoUrl?: string;
  goal: GoalType;
  platform?: string; // auto-detected if not provided
  toolCallBudget?: number;
  webSearchBudget?: number;
  urlFetchBudget?: number;
  docTokenBudget?: number;
  outputDir?: string;
  /** Callback for each step — enables live CLI output */
  onStep?: (step: StepEvent) => void;
  /** Enable verbose output with full reasoning and arguments */
  verbose?: boolean;
  /**
   * Called when tool call budget is exhausted. Return true to extend
   * by 50 more calls, false to stop and assemble with current findings.
   * If not provided, auto-assembles (CI-safe default).
   */
  onBudgetExhausted?: (state: { findings: number; toolCalls: number; budget: number }) => Promise<boolean>;
  /** Override Pi model (e.g. faux provider for testing). If omitted, builds from env vars. */
  model?: Model<any>;
  /** Override Pi fast model (e.g. faux provider for testing). If omitted, builds from env vars. */
  fastModel?: Model<any>;
}

export interface StepEvent {
  step: number;
  action: string;
  reasoning?: string;
  result?: string;
  /** Full reasoning text (only in verbose mode) */
  fullReasoning?: string;
  /** Full result text (only in verbose mode) */
  fullResult?: string;
  /** Tool call arguments (only in verbose mode) */
  args?: string;
  /** Type of event: tool_call, finding, budget_warning, text_response */
  type?: 'tool_call' | 'finding' | 'budget_warning' | 'text_response' | 'assemble_output';
}

export interface RunResult {
  scorecard: Scorecard;
  briefMarkdown: string;
  exportJson: string;
  outputPaths: string[];
  metrics: RunMetrics;
  state: AgentState;
  /** How the run ended: completed (assemble_output called), budget_exhausted, stuck, or error */
  terminationReason: 'completed' | 'budget_exhausted' | 'stuck' | 'error';
  /** Error message if terminationReason is 'error' */
  errorDetail?: string;
}

/**
 * Pi Agent Runner — delegates the investigation loop to Pi's Agent class.
 *
 * 1. Build Pi Model (from env vars or streamFn for tests)
 * 2. Wrap tools via piToolAdapter
 * 3. Use beforeToolCall/afterToolCall hooks for budget enforcement
 * 4. After agent.prompt() returns, assemble output from captured sections
 */
export async function runAgent(config: RunnerConfig): Promise<RunResult> {
  const startedAt = new Date();

  const toolCallBudget = config.toolCallBudget ?? 35;
  const webSearchBudget = config.webSearchBudget ?? 5;
  const urlFetchBudget = config.urlFetchBudget ?? 3;
  const docTokenBudget = config.docTokenBudget ?? 20_000;
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
  };

  // Detect platform if not provided
  const platform = config.platform ?? 'unknown';

  // Build prompts
  const systemPrompt = buildSystemPrompt(config.goal, platform);
  const goalPrompt = buildGoalPrompt(config.goal, config.repoPath, toolCallBudget, webSearchBudget);

  // Build Pi tools from registry
  const { tools, assembledRef } = buildPiTools(state);

  // Build Pi models (or use provided overrides, e.g. faux provider for testing)
  let apiKey: string | undefined;
  let piModel: Model<any>;
  let piFastModel: Model<any>;
  if (config.model) {
    piModel = config.model;
    piFastModel = config.fastModel ?? config.model; // fall back to same model in tests
  } else {
    const built = buildPiModel();
    piModel = built.model;
    piFastModel = built.fastModel;
    apiKey = built.apiKey;
  }

  let stepCount = 0;
  let currentBudget = toolCallBudget;
  let terminationReason: RunResult['terminationReason'] = 'budget_exhausted';
  let errorDetail: string | undefined;
  const halfBudget = Math.floor(toolCallBudget / 2);
  let budgetWarningHalfSent = false;
  let budgetWarning5Sent = false;

  // beforeToolCall: budget enforcement
  const beforeToolCall = async (
    ctx: BeforeToolCallContext,
    _signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    const toolName = ctx.toolCall.name;

    // Web search budget
    if (toolName === 'web_search' && state.webSearchCount >= webSearchBudget) {
      return { block: true, reason: 'Web search budget exhausted.' };
    }
    // URL fetch budget
    if (toolName === 'fetch_url' && state.urlFetchCount >= urlFetchBudget) {
      return { block: true, reason: 'URL fetch budget exhausted.' };
    }

    // Tool call budget
    if (state.toolCallCount >= currentBudget) {
      // Budget exhausted — ask whether to extend
      if (config.onBudgetExhausted) {
        const shouldExtend = await config.onBudgetExhausted({
          findings: state.findings.length,
          toolCalls: state.toolCallCount,
          budget: currentBudget,
        });
        if (shouldExtend) {
          currentBudget += 50;
          state.toolCallBudget = currentBudget;
          config.onStep?.({
            step: stepCount,
            action: 'budget_extended',
            type: 'budget_warning',
            result: `Budget extended to ${currentBudget} tool calls. Continuing investigation.`,
          });
          // Allow this tool call to proceed
          return undefined;
        }
      }
      // Decline or no callback — block
      return { block: true, reason: `Tool call budget exhausted (${currentBudget} calls used). Call assemble_output now.` };
    }

    return undefined;
  };

  // afterToolCall: counter tracking, budget warnings, assemble_output abort
  const afterToolCall = async (
    ctx: AfterToolCallContext,
    _signal?: AbortSignal,
  ): Promise<AfterToolCallResult | undefined> => {
    const toolName = ctx.toolCall.name;
    state.toolCallCount++;
    stepCount++;

    // Log investigation step
    const reasoning = '';
    const resultText = ctx.result?.content?.[0]?.type === 'text'
      ? (ctx.result.content[0] as { type: 'text'; text: string }).text
      : '';
    const cleanResult = resultText.replaceAll(config.repoPath, '');
    state.investigationLog.push({
      step: stepCount,
      action: toolName,
      reasoning: reasoning.slice(0, 200),
      result: cleanResult.slice(0, 200),
    });

    // Emit step event
    const isFinding = toolName === 'record_finding';
    const isAssemble = toolName === 'assemble_output';
    config.onStep?.({
      step: stepCount,
      action: toolName,
      reasoning: reasoning.slice(0, 100),
      result: resultText.slice(0, 100),
      type: isAssemble ? 'assemble_output' : isFinding ? 'finding' : 'tool_call',
      ...(config.verbose ? {
        fullReasoning: reasoning,
        fullResult: resultText,
        args: JSON.stringify(ctx.args),
      } : {}),
    });

    // If assemble_output was called, abort the agent loop
    if (isAssemble && assembledRef.sections !== null) {
      terminationReason = 'completed';
      agent.abort();
      return undefined;
    }

    // Budget warning steering messages
    const remaining = currentBudget - state.toolCallCount;
    if (remaining <= 5 && remaining > 0 && !budgetWarning5Sent && assembledRef.sections === null) {
      budgetWarning5Sent = true;
      agent.steer({
        role: 'user',
        content: `CRITICAL: Only ${remaining} tool calls left. You MUST call assemble_output NOW with your written content for all 12 onboarding sections. Use your investigation so far — do not investigate further.`,
        timestamp: Date.now(),
      });
    } else if (remaining <= halfBudget && remaining > 0 && !budgetWarningHalfSent && assembledRef.sections === null) {
      budgetWarningHalfSent = true;
      // Switch to fast model for the assembly/writing phase — cheaper, investigation is done
      if (piFastModel.id !== piModel.id) {
        agent.setModel(piFastModel);
        config.onStep?.({
          step: stepCount,
          action: 'model_switch',
          type: 'budget_warning',
          result: `Switched to fast model (${piFastModel.id}) for assembly phase.`,
        });
      }
      agent.steer({
        role: 'user',
        content: `You have ${remaining} tool calls remaining out of ${currentBudget}. Start wrapping up your investigation. Record your findings with record_finding, then call assemble_output with written content for every required section of the brief.`,
        timestamp: Date.now(),
      });
    }

    return undefined;
  };

  /**
   * Context pruning: truncate tool result content in older messages to control
   * conversation history size. Keep the most recent KEEP_RECENT messages intact
   * (the agent needs recent results for reasoning). Older tool results get
   * replaced with a short summary.
   */
  const KEEP_RECENT = 10; // messages to keep at full fidelity
  const OLD_RESULT_MAX = 200; // chars to keep from old tool results

  const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    if (messages.length <= KEEP_RECENT) return messages;
    const cutoff = messages.length - KEEP_RECENT;
    return messages.map((msg, i) => {
      if (i >= cutoff) return msg; // recent — keep intact
      if (!msg || typeof msg !== 'object' || !('role' in msg)) return msg;
      if ((msg as { role: string }).role !== 'toolResult') return msg;
      // Truncate old tool result content
      const tr = msg as unknown as { role: string; content: { type: string; text?: string }[]; [k: string]: unknown };
      return {
        ...tr,
        content: tr.content.map((c) => {
          if (c.type === 'text' && c.text && c.text.length > OLD_RESULT_MAX) {
            return { ...c, text: c.text.slice(0, OLD_RESULT_MAX) + '...[pruned]' };
          }
          return c;
        }),
      } as AgentMessage;
    });
  };

  /**
   * Prompt caching: inject cache_control breakpoints into the system prompt
   * so the static prefix (system + tool defs) is cached across turns.
   * Portkey forwards these annotations to Bedrock's Anthropic API.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onPayload = (payload: any) => {
    if (!payload || typeof payload !== 'object') return undefined;
    // Add cache_control to system prompt (OpenAI-compatible format)
    if (Array.isArray(payload.messages) && payload.messages.length > 0) {
      // For Anthropic via Portkey: add cache breakpoint to system message
      if (typeof payload.system === 'string') {
        payload.system = [{ type: 'text', text: payload.system, cache_control: { type: 'ephemeral' } }];
      } else if (Array.isArray(payload.system) && payload.system.length > 0) {
        const last = payload.system[payload.system.length - 1];
        if (last && typeof last === 'object') {
          last.cache_control = { type: 'ephemeral' };
        }
      }
    }
    return payload;
  };

  // Create Pi Agent
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: piModel,
      thinkingLevel: 'off',
      tools,
    },
    toolExecution: 'sequential',
    transformContext,
    onPayload,
    ...(apiKey ? { getApiKey: async () => apiKey } : {}),
    beforeToolCall,
    afterToolCall,
  });

  // Subscribe to events for usage tracking
  agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_end' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      const msg = event.message;
      trackUsage(state, msg.model, {
        inputTokens: msg.usage.input,
        outputTokens: msg.usage.output,
        cachedTokens: msg.usage.cacheRead,
      });
    }
  });

  try {
    // Run the agent
    await agent.prompt(goalPrompt);

    // If agent finished without calling assemble_output, try nudging
    // (terminationReason may have been set to 'completed' by afterToolCall hook)
    if (assembledRef.sections === null && (terminationReason as string) !== 'completed') {
      // Switch to fast model for retry nudges — just needs to write, not reason
      if (piFastModel.id !== piModel.id) {
        agent.setModel(piFastModel);
      }
      // Retry with nudge (max 2)
      for (let retry = 0; retry < 2; retry++) {
        agent.followUp({
          role: 'user',
          content: 'You must call assemble_output now with written content for all required sections. Use your investigation findings to write the brief.',
          timestamp: Date.now(),
        });
        await agent.continue();
        if (assembledRef.sections !== null) {
          terminationReason = 'completed';
          break;
        }
      }
      if (assembledRef.sections === null) {
        terminationReason = 'stuck';
      }
    }
  } catch (err) {
    // Pi aborts throw — check if it was our intentional abort from assemble_output
    if (terminationReason === 'completed') {
      // Expected — assemble_output called agent.abort()
    } else {
      terminationReason = 'error';
      errorDetail = (err as Error).message;
      config.onStep?.({
        step: stepCount,
        action: 'error',
        type: 'budget_warning',
        result: `Agent error: ${errorDetail}. Producing partial output.`,
      });
    }
  }

  // Post-loop: assemble output (partial if error/stuck)
  const sections = assembledRef.sections ?? {};
  const scorecard = computeScorecard(config.repoName, config.goal, state.findings);

  const completedAt = new Date();
  const metrics = buildMetrics(state, startedAt, completedAt);

  const briefMarkdown = renderBrief(
    scorecard,
    sections,
    state.investigationLog,
    state.fetchedDocs,
    state.toolCallCount,
    currentBudget,
  );

  const fullExport = buildFullExport(state, scorecard, sections, metrics);
  fullExport.metadata.terminationReason = terminationReason;
  fullExport.metadata.toolCallsUsed = state.toolCallCount;
  fullExport.metadata.toolCallBudget = currentBudget;
  const exportJson = serializeExport(fullExport);

  // Write output files (always — even on error, for partial results)
  const outputPaths = writeOutputFiles(
    outputDir,
    config.repoName,
    scorecard,
    briefMarkdown,
    exportJson,
    state,
  );

  // Write debug log on error/stuck for diagnostics
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

  return {
    scorecard,
    briefMarkdown,
    exportJson,
    outputPaths,
    metrics,
    state,
    terminationReason,
    errorDetail,
  };
}

function trackUsage(
  state: AgentState,
  model: string,
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number },
): void {
  const existing = state.modelUsage.get(model) ?? {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
  };
  state.modelUsage.set(model, {
    calls: existing.calls + 1,
    inputTokens: existing.inputTokens + usage.inputTokens,
    outputTokens: existing.outputTokens + usage.outputTokens,
    cachedTokens: existing.cachedTokens + usage.cachedTokens,
  });
}

function buildMetrics(
  state: AgentState,
  startedAt: Date,
  completedAt: Date,
): RunMetrics {
  const models: RunMetrics['models'] = {};
  for (const [modelId, usage] of state.modelUsage.entries()) {
    const pricing = pricingConfig.models[modelId] ?? pricingConfig.defaultPricing;
    const inputCost = usage.inputTokens * pricing.inputPerToken;
    const outputCost = usage.outputTokens * pricing.outputPerToken;
    const cachedDiscount = usage.cachedTokens * (pricing.inputPerToken - pricing.cachedInputPerToken);
    const estimated = inputCost + outputCost - cachedDiscount;

    models[modelId] = {
      bedrockModelId: modelId,
      calls: usage.calls,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedTokens: usage.cachedTokens,
      estimatedCostUsd: Math.round(estimated * 10000) / 10000,
    };
  }

  const totalCost = Object.values(models).reduce(
    (sum, m) => sum + m.estimatedCostUsd,
    0,
  );

  return {
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    toolCalls: state.toolCallCount,
    models,
    totalEstimatedCostUsd: Math.round(totalCost * 10000) / 10000,
  };
}

function writeOutputFiles(
  outputDir: string,
  repoName: string,
  scorecard: Scorecard,
  briefMarkdown: string,
  exportJson: string,
  state: AgentState,
): string[] {
  fs.mkdirSync(outputDir, { recursive: true });

  const paths: string[] = [];
  const slug = repoName.replace(/[^a-zA-Z0-9-]/g, '-');

  // Scorecard JSON
  const scorecardPath = path.join(outputDir, `${slug}-scorecard.json`);
  fs.writeFileSync(scorecardPath, JSON.stringify(scorecard, null, 2), 'utf-8');
  paths.push(scorecardPath);

  // Brief markdown
  const briefPath = path.join(outputDir, `${slug}-brief.md`);
  fs.writeFileSync(briefPath, briefMarkdown, 'utf-8');
  paths.push(briefPath);

  // Findings JSON
  const findingsPath = path.join(outputDir, `${slug}-findings.json`);
  fs.writeFileSync(findingsPath, JSON.stringify(state.findings, null, 2), 'utf-8');
  paths.push(findingsPath);

  // Full export JSON
  const exportPath = path.join(outputDir, `${slug}-export.json`);
  fs.writeFileSync(exportPath, exportJson, 'utf-8');
  paths.push(exportPath);

  // Investigation log markdown
  const logPath = path.join(outputDir, `${slug}-investigation.md`);
  const logContent = renderInvestigationLog(state);
  fs.writeFileSync(logPath, logContent, 'utf-8');
  paths.push(logPath);

  return paths;
}

function renderInvestigationLog(state: AgentState): string {
  const lines: string[] = [];
  lines.push(`# Investigation Log: ${state.repo.name}`);
  lines.push('');
  lines.push(`**Goal:** ${state.goal}`);
  lines.push(`**Tool calls:** ${state.toolCallCount} / ${state.toolCallBudget}`);
  lines.push(`**Findings:** ${state.findings.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const entry of state.investigationLog) {
    lines.push(`## Step ${entry.step}: ${entry.action}`);
    lines.push('');
    lines.push(`**Reasoning:** ${entry.reasoning}`);
    lines.push('');
    lines.push(`**Result:** ${entry.result}`);
    lines.push('');
  }

  return lines.join('\n');
}
