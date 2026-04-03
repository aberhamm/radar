import { Agent } from '@mariozechner/pi-agent-core';
import { randomUUID } from 'node:crypto';
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
import { redactSecrets } from './redaction.js';
import { wrapInBoundary, BOUNDARY_SYSTEM_INSTRUCTION, validateFindingContent, sanitizeToolOutput } from './contextBoundary.js';
import { withRetry } from './retry.js';
import { renderInvestigationHtml } from '../output/investigationHtml.js';
import { buildPiTools, type AssembledSections, cleanupSpillDir } from '../tools/piToolAdapter.js';
import { verifyFindingEvidence } from '../tools/analysis/verifyEvidence.js';
import { buildPiModel } from '../config/piModel.js';
import { computeScorecard } from '../output/scorecard.js';
import { renderBrief } from '../output/brief.js';
import { buildFullExport, serializeExport } from '../output/json.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setMaxListeners } from 'node:events';

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
  /** Type of event: tool_call, finding, budget_warning, text_response, assemble_output, model_switch */
  type?: 'tool_call' | 'finding' | 'budget_warning' | 'text_response' | 'assemble_output' | 'model_switch' | 'verification';
  /** Identifies which tool calls ran in the same parallel batch (same assistant turn) */
  batchId?: string;
  /** New budget after extension (only on budget_extended events) */
  newBudget?: number;
  /** ISO timestamp when this event was emitted */
  timestamp?: string;
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
  // Pi's Agent adds abort listeners per tool call; raise the limit to avoid warnings
  setMaxListeners(100);
  const startedAt = new Date();

  // Wrap onStep to inject timestamps automatically
  const _rawOnStep = config.onStep;
  if (_rawOnStep) {
    config.onStep = (event) => _rawOnStep({ ...event, timestamp: new Date().toISOString() });
  }

  const toolCallBudget = config.toolCallBudget ?? 45;
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
  const systemPrompt = buildSystemPrompt(config.goal, platform) + '\n\n---\n\n' + BOUNDARY_SYSTEM_INSTRUCTION;
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
  let modelSwitched = false; // true once agent calls switch_to_fast_model
  const canSwitchModel = piFastModel.id !== piModel.id;

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
    // Mutate piModel (the object the loop holds a reference to)
    Object.assign(piModel, {
      id: piFastModel.id,
      name: piFastModel.name,
      cost: piFastModel.cost,
      maxTokens: piFastModel.maxTokens,
    });
  }
  // Capture assistant reasoning text from message events for the investigation log.
  // Pi sends text content blocks alongside tool calls in the same assistant message.
  let lastAssistantReasoning = '';
  /** Shared batchId for all tool calls in the same parallel assistant turn */
  let currentBatchId: string = randomUUID();

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
      // Always allow assemble_output through — it's the exit path
      if (toolName === 'assemble_output') {
        return undefined;
      }

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
            newBudget: currentBudget,
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

    // Log investigation step — use captured reasoning from last assistant message.
    // Don't clear it here: parallel tool calls in the same message share the same reasoning.
    // It gets overwritten naturally when the next message_end event fires.
    const reasoning = lastAssistantReasoning;
    const resultText = ctx.result?.content?.[0]?.type === 'text'
      ? (ctx.result.content[0] as { type: 'text'; text: string }).text
      : '';
    // Apply secret redaction before the result goes anywhere (log, LLM context, step events)
    const redactedResult = redactSecrets(resultText);
    const cleanResult = redactedResult.replaceAll(config.repoPath, '');
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
      result: redactedResult.slice(0, 100),
      type: isAssemble ? 'assemble_output' : isFinding ? 'finding' : 'tool_call',
      batchId: currentBatchId,
      ...(config.verbose ? {
        fullReasoning: reasoning,
        fullResult: redactedResult,
        args: JSON.stringify(ctx.args),
      } : {}),
    });

    // Intent-based model switch: agent signals it's done investigating
    if (toolName === 'switch_to_fast_model' && !modelSwitched) {
      modelSwitched = true;
      if (canSwitchModel) {
        const fastId = piFastModel.id;
        switchModelInPlace();
        config.onStep?.({
          step: stepCount,
          action: 'model_switch',
          type: 'model_switch',
          result: `Switched to fast model (${fastId}) for writing phase. Agent signaled investigation complete.`,
        });
      }
    }

    // Check for potential prompt injection in record_finding content
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

    // If assemble_output was called, abort the agent loop
    if (isAssemble && assembledRef.sections !== null) {
      terminationReason = 'completed';
      agent.abort();
      return undefined;
    }

    // Sanitize → boundary-wrap → return to LLM context.
    // sanitizeToolOutput flags instruction-like patterns in repo files.
    // wrapInBoundary adds delimiters so the LLM treats output as data.
    if (redactedResult) {
      const sanitized = sanitizeToolOutput(redactedResult);
      const wrapped = wrapInBoundary(toolName, sanitized);
      return { content: [{ type: 'text', text: wrapped }] };
    }

    // Budget warning steering messages
    const remaining = currentBudget - state.toolCallCount;
    if (remaining <= 5 && remaining > 0 && !budgetWarning5Sent && assembledRef.sections === null) {
      budgetWarning5Sent = true;
      // Force switch to fast model if agent hasn't done it yet
      if (!modelSwitched && canSwitchModel) {
        modelSwitched = true;
        const fastId = piFastModel.id;
        switchModelInPlace();
        config.onStep?.({
          step: stepCount,
          action: 'model_switch',
          type: 'model_switch',
          result: `Switched to fast model (${fastId}) — budget critical.`,
        });
      }
      agent.steer({
        role: 'user',
        content: `CRITICAL: Only ${remaining} tool calls left. You MUST call assemble_output NOW with your written content for all required sections. Use your investigation so far — do not investigate further.`,
        timestamp: Date.now(),
      });
    } else if (remaining <= halfBudget && remaining > 0 && !budgetWarningHalfSent && assembledRef.sections === null) {
      budgetWarningHalfSent = true;
      agent.steer({
        role: 'user',
        content: `You have ${remaining} tool calls remaining out of ${currentBudget}. If you haven't called switch_to_fast_model yet, do it now. Then record your findings and call assemble_output.`,
        timestamp: Date.now(),
      });
    }

    return undefined;
  };

  /**
   * Tiered context compression: control conversation history size with 3 tiers.
   *
   *   Tier 1 (recent):  last KEEP_RECENT messages — full fidelity
   *   Tier 2 (mid-age): next MID_AGE_WINDOW messages — tool results summarized (600 chars)
   *   Tier 3 (old):     everything older — tool results dropped to 120 chars
   *
   * Only tool result messages are compressed; assistant/user messages pass through.
   * Summaries are cached by tool call ID to avoid recomputing on each turn.
   */
  const KEEP_RECENT = 10;
  const MID_AGE_WINDOW = 15;
  const MID_SUMMARY_MAX = 600;
  const OLD_SUMMARY_MAX = 120;
  const summaryCache = new Map<string, string>();

  function compressToolResult(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '...[pruned]';
  }

  const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    if (messages.length <= KEEP_RECENT) return messages;

    const tier2Start = Math.max(0, messages.length - KEEP_RECENT - MID_AGE_WINDOW);
    const tier1Start = messages.length - KEEP_RECENT;

    return messages.map((msg, i) => {
      // Tier 1: recent — keep intact
      if (i >= tier1Start) return msg;
      if (!msg || typeof msg !== 'object' || !('role' in msg)) return msg;
      if ((msg as { role: string }).role !== 'toolResult') return msg;

      const tr = msg as unknown as { role: string; toolCallId?: string; content: { type: string; text?: string }[]; [k: string]: unknown };
      const maxChars = i >= tier2Start ? MID_SUMMARY_MAX : OLD_SUMMARY_MAX;

      return {
        ...tr,
        content: tr.content.map((c) => {
          if (c.type !== 'text' || !c.text || c.text.length <= maxChars) return c;
          // Check cache
          const cacheKey = tr.toolCallId ? `${tr.toolCallId}:${maxChars}` : undefined;
          if (cacheKey && summaryCache.has(cacheKey)) {
            return { ...c, text: summaryCache.get(cacheKey)! };
          }
          const compressed = compressToolResult(c.text, maxChars);
          if (cacheKey) summaryCache.set(cacheKey, compressed);
          return { ...c, text: compressed };
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
    toolExecution: 'parallel',
    transformContext,
    onPayload,
    ...(apiKey ? { getApiKey: async () => apiKey } : {}),
    beforeToolCall,
    afterToolCall,
  });

  // Subscribe to events for usage tracking, reasoning capture, and batchId rotation
  agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_start' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      // New assistant turn — rotate the batchId so parallel tool calls in this turn share it
      currentBatchId = randomUUID();
    }
    if (event.type === 'message_end' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      const msg = event.message;
      trackUsage(state, msg.model, {
        inputTokens: msg.usage.input,
        outputTokens: msg.usage.output,
        cachedTokens: msg.usage.cacheRead,
      });

      // Capture text content blocks as reasoning for the investigation log.
      // Pi sends text alongside tool calls in the same assistant message.
      if (Array.isArray(msg.content)) {
        const textParts = (msg.content as { type: string; text?: string }[])
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!);
        if (textParts.length > 0) {
          lastAssistantReasoning = textParts.join('\n').trim();

          // Emit as a text_response step for verbose mode
          if (config.verbose && lastAssistantReasoning) {
            config.onStep?.({
              step: stepCount,
              action: 'reasoning',
              type: 'text_response',
              reasoning: lastAssistantReasoning.slice(0, 100),
              fullReasoning: lastAssistantReasoning,
            });
          }
        }
      }
    }
  });

  try {
    // Run the agent with retry on transient API errors (429, 529, connection)
    await withRetry(() => agent.prompt(goalPrompt), {
      maxRetries: 3,
      onRetry: (attempt, error, delayMs) => {
        config.onStep?.({
          step: stepCount,
          action: 'retry',
          type: 'budget_warning',
          result: `Transient API error (attempt ${attempt}): ${error.message}. Retrying in ${Math.round(delayMs / 1000)}s...`,
        });
      },
    });

    // If agent finished without calling assemble_output, try nudging
    // (terminationReason may have been set to 'completed' by afterToolCall hook)
    if (assembledRef.sections === null && (terminationReason as string) !== 'completed') {
      // Ensure fast model for retry nudges — just needs to write, not reason
      // Post-loop: setModel works here since continue() starts a new _runLoop
      if (!modelSwitched && canSwitchModel) {
        modelSwitched = true;
        switchModelInPlace();
        agent.setModel(piModel); // also update _state for the new _runLoop
      }
      // Retry with nudge (max 2)
      for (let retry = 0; retry < 2; retry++) {
        agent.followUp({
          role: 'user',
          content: 'You must call assemble_output now with written content for all required sections. Use your investigation findings to write the brief.',
          timestamp: Date.now(),
        });
        await withRetry(() => agent.continue(), {
          maxRetries: 2,
          onRetry: (attempt, error) => {
            config.onStep?.({
              step: stepCount,
              action: 'retry',
              type: 'budget_warning',
              result: `Retry nudge attempt ${attempt}: ${error.message}`,
            });
          },
        });
        if (assembledRef.sections !== null) {
          terminationReason = 'completed';
          break;
        }
      }
      if (assembledRef.sections === null) {
        // LLM nudges failed — auto-assemble from recorded findings without LLM
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
      // Auto-assemble from whatever findings we have
      if (assembledRef.sections === null && state.findings.length > 0) {
        assembledRef.sections = autoAssembleFromFindings(state);
      }
    }
  }

  // Post-loop: assemble output (partial if error/stuck)
  const sections = assembledRef.sections ?? {};

  // Post-investigation verification pass: re-verify all evidence against actual files.
  // Removes findings where ALL evidence is unverifiable (likely hallucinated).
  const removedFindingIds: string[] = [];
  for (let i = state.findings.length - 1; i >= 0; i--) {
    const { finding: verified, allUnverifiable } = await verifyFindingEvidence(
      config.repoPath,
      state.findings[i],
    );
    if (allUnverifiable) {
      removedFindingIds.push(state.findings[i].id);
      state.findings.splice(i, 1);
    } else {
      state.findings[i] = verified;
    }
  }
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

  // Clean up spilled tool results from tmpdir
  cleanupSpillDir();

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

/**
 * Build brief sections from recorded findings when the LLM never called assemble_output.
 * Groups findings by category and produces minimal but usable section content.
 */
function autoAssembleFromFindings(state: AgentState): Record<string, string> {
  const sections: Record<string, string> = {};

  // Group findings by category
  const byCategory = new Map<string, typeof state.findings>();
  for (const f of state.findings) {
    const cat = f.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(f);
  }

  // Build a section for each category with findings
  for (const [category, findings] of byCategory) {
    const lines: string[] = [];
    for (const f of findings) {
      lines.push(`### ${f.title}`);
      lines.push('');
      lines.push(`**Severity:** ${f.severity}`);
      lines.push('');
      lines.push(f.description);
      if (f.evidence.length > 0) {
        lines.push('');
        lines.push('**Evidence:**');
        for (const e of f.evidence) {
          const loc = e.lineNumber ? `${e.filePath}:${e.lineNumber}` : e.filePath;
          lines.push(`- \`${loc}\` — ${e.description}`);
        }
      }
      lines.push('');
    }
    sections[category] = lines.join('\n');
  }

  // Add an executive summary
  const severityCounts: Record<string, number> = {};
  for (const f of state.findings) {
    severityCounts[f.severity] = (severityCounts[f.severity] ?? 0) + 1;
  }
  const severityLine = Object.entries(severityCounts)
    .map(([sev, count]) => `${count} ${sev}`)
    .join(', ');
  sections['executive-summary'] =
    `This brief was auto-assembled from ${state.findings.length} findings (${severityLine}). ` +
    `Categories covered: ${[...byCategory.keys()].join(', ')}.`;

  return sections;
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

  // Investigation log HTML (static, browsable)
  const htmlLogPath = path.join(outputDir, `${slug}-investigation.html`);
  const htmlContent = renderInvestigationHtml({
    repoName: state.repo.name,
    entries: state.investigationLog,
    scorecard,
    toolCallCount: state.toolCallCount,
    findingCount: state.findings.length,
  });
  fs.writeFileSync(htmlLogPath, htmlContent, 'utf-8');
  paths.push(htmlLogPath);

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
