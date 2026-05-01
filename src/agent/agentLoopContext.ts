/**
 * AgentLoopContext — encapsulates all mutable closure state from runAgent().
 *
 * This class holds the 30+ variables that were previously closure-scoped in
 * runner.ts, plus the beforeToolCall, afterToolCall, and handleAgentEvent
 * hook methods. Extracting into a class enables instantiation for multiple
 * parallel workers in later stages while keeping the runner's behavior
 * identical.
 *
 * Zero behavior change from the closure-based implementation — every
 * conditional, counter, and side effect is preserved exactly.
 */

import { randomUUID } from 'node:crypto';
import type { Agent } from '@mariozechner/pi-agent-core';
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AgentEvent,
} from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';
import type { AgentState } from '../types/state.js';
import type { RunnerConfig, RunResult, StepEvent } from './runnerTypes.js';
import type { CompressionState } from './contextCompression.js';
import type { AssembledSections } from '../tools/piToolAdapter.js';
import { redactSecrets } from './redaction.js';
import { wrapInBoundary, validateFindingContent, sanitizeToolOutput } from './contextBoundary.js';
import { saveCheckpoint, buildCheckpointEntry } from '../output/sessionCheckpoint.js';
import { trackUsage } from './usageTracking.js';
import { RECORDING_GATE_PCT, EXTENSION_GATE_PCT, BUDGET_EXTENSION } from '../config/defaults.js';

/** Configuration passed to AgentLoopContext constructor. */
export interface AgentLoopContextConfig {
  toolCallBudget: number;
  config: RunnerConfig;
  state: AgentState;
  assembledRef: AssembledSections;
  piModel: Model<any>;
  piFastModel: Model<any>;
  compressionState: CompressionState;
  clearSummaryCache: () => void;
  outputDir: string;
  repoSlug: string;
  sessionId: string;
  checkpointInterval: number;
  webSearchBudget: number;
  urlFetchBudget: number;
}

export class AgentLoopContext {
  // ─── Budget tracking ──────────────────────────────────────────────
  stepCount = 0;
  currentBudget: number;
  terminationReason: RunResult['terminationReason'] = 'budget_exhausted';
  errorDetail: string | undefined;
  readonly halfBudget: number;

  // ─── Warning flags ────────────────────────────────────────────────
  budgetWarningRecordingSent = false;
  budgetWarningHalfSent = false;
  budgetWarning5Sent = false;
  progressSummarySent = false;
  budgetExhaustedFired = false;
  extensionGateFired = false;

  // ─── Model state ──────────────────────────────────────────────────
  modelSwitched = false;
  snipBoundaryActive = false;
  readonly canSwitchModel: boolean;

  // ─── Streaming / turn state ───────────────────────────────────────
  lastAssistantReasoning = '';
  lastAssistantThinking = '';
  lastAssistantModel = '';
  currentBatchId: string = randomUUID();
  turnStartMs = 0;
  totalLlmMs = 0;
  totalToolMs = 0;
  turnCount = 0;
  streamingText = '';

  // ─── Compression maps ─────────────────────────────────────────────
  readonly toolCallIdToFiles = new Map<string, Set<string>>();
  readonly toolCallIdToName = new Map<string, string>();
  readonly toolStartTimes = new Map<string, number>();

  // ─── Checkpoint state ─────────────────────────────────────────────
  checkpointSeq: number;

  // ─── Constants ────────────────────────────────────────────────────
  readonly TRACE_RESULT_CAP = 10_240;

  // ─── Injected dependencies (readonly) ─────────────────────────────
  readonly config: RunnerConfig;
  readonly state: AgentState;
  readonly assembledRef: AssembledSections;
  readonly piModel: Model<any>;
  readonly piFastModel: Model<any>;
  readonly compressionState: CompressionState;
  readonly outputDir: string;
  readonly repoSlug: string;
  readonly sessionId: string;
  readonly checkpointInterval: number;
  readonly webSearchBudget: number;
  readonly urlFetchBudget: number;

  // ─── Mutable: set after construction ──────────────────────────────
  clearSummaryCache: () => void;
  agent!: Agent;

  constructor(cfg: AgentLoopContextConfig) {
    this.currentBudget = cfg.toolCallBudget;
    this.halfBudget = Math.floor(cfg.toolCallBudget / 2);
    this.canSwitchModel = cfg.piFastModel.id !== cfg.piModel.id;
    this.checkpointSeq = 0;

    this.config = cfg.config;
    this.state = cfg.state;
    this.assembledRef = cfg.assembledRef;
    this.piModel = cfg.piModel;
    this.piFastModel = cfg.piFastModel;
    this.compressionState = cfg.compressionState;
    this.clearSummaryCache = cfg.clearSummaryCache;
    this.outputDir = cfg.outputDir;
    this.repoSlug = cfg.repoSlug;
    this.sessionId = cfg.sessionId;
    this.checkpointInterval = cfg.checkpointInterval;
    this.webSearchBudget = cfg.webSearchBudget;
    this.urlFetchBudget = cfg.urlFetchBudget;
  }

  get isWorker(): boolean {
    return this.config.mode === 'worker';
  }

  // ─── Model switch ─────────────────────────────────────────────────

  /**
   * Switch the active model mid-loop by mutating the model object in place.
   *
   * Pi's _runLoop() captures `const model = this._state.model` once at the
   * start and passes it into the agent-loop config. setModel() replaces the
   * _state reference but the loop still holds the old object. By mutating
   * the original object's properties, the change is visible to the running
   * loop immediately — no abort/restart needed.
   */
  switchModelInPlace(): void {
    if (!this.canSwitchModel) return;
    Object.assign(this.piModel, {
      id: this.piFastModel.id,
      name: this.piFastModel.name,
      cost: this.piFastModel.cost,
      maxTokens: this.piFastModel.maxTokens,
      reasoning: this.piFastModel.reasoning ?? false,
    });
    this.agent.state.thinkingLevel = 'off';
  }

  // ─── beforeToolCall hook ──────────────────────────────────────────

  async beforeToolCall(
    ctx: BeforeToolCallContext,
    _signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    const toolName = ctx.toolCall.name;

    if (this.isWorker && (toolName === 'assemble_output' || toolName === 'switch_to_fast_model')) {
      return { block: true, reason: 'Tool not available in worker mode.' };
    }

    if (this.terminationReason === 'completed' && toolName !== 'record_finding') {
      return { block: true, reason: 'Output assembly complete.' };
    }

    const WRITING_TOOLS = new Set(['record_finding', 'switch_to_fast_model', 'assemble_output']);
    // Recording enforcement gate — full mode only (workers have fixed budgets)
    if (
      !this.isWorker &&
      this.state.findings.length === 0 &&
      this.state.toolCallCount >= Math.floor(this.currentBudget * RECORDING_GATE_PCT) &&
      this.state.toolCallCount < this.currentBudget &&
      !WRITING_TOOLS.has(toolName)
    ) {
      if (!this.budgetExhaustedFired && this.config.onBudgetExhausted) {
        this.budgetExhaustedFired = true;
        const shouldExtend = await this.config.onBudgetExhausted({
          findings: this.state.findings.length,
          toolCalls: this.state.toolCallCount,
          budget: this.currentBudget,
        });
        if (shouldExtend) {
          this.currentBudget += BUDGET_EXTENSION;
          this.state.toolCallBudget = this.currentBudget;
          this.budgetExhaustedFired = false;
          this.config.onStep?.({
            step: this.stepCount,
            action: 'budget_extended',
            type: 'budget_warning',
            newBudget: this.currentBudget,
            result: `Budget extended to ${this.currentBudget} tool calls. Continuing investigation.`,
          });
          return undefined;
        }
      }
      if (!this.modelSwitched && this.canSwitchModel) {
        this.modelSwitched = true;
        this.snipBoundaryActive = true;
        this.compressionState.snipBoundaryActive = true;
        this.clearSummaryCache();
        this.switchModelInPlace();
      }
      return {
        block: true,
        reason: `Investigation budget exhausted (${this.state.toolCallCount}/${this.currentBudget} calls used, 0 findings recorded). You MUST call record_finding now for what you have observed, then assemble_output.`,
      };
    }

    if (toolName === 'web_search' && this.state.webSearchCount >= this.webSearchBudget) {
      return { block: true, reason: 'Web search budget exhausted.' };
    }
    if (toolName === 'fetch_url' && this.state.urlFetchCount >= this.urlFetchBudget) {
      return { block: true, reason: 'URL fetch budget exhausted.' };
    }

    // Extension gate — full mode only
    if (
      !this.isWorker &&
      !this.extensionGateFired &&
      this.config.onBudgetExhausted &&
      this.state.toolCallCount >= Math.floor(this.currentBudget * EXTENSION_GATE_PCT) &&
      this.state.toolCallCount < this.currentBudget &&
      !WRITING_TOOLS.has(toolName)
    ) {
      this.extensionGateFired = true;
      const shouldExtend = await this.config.onBudgetExhausted({
        findings: this.state.findings.length,
        toolCalls: this.state.toolCallCount,
        budget: this.currentBudget,
      });
      if (shouldExtend) {
        this.currentBudget += BUDGET_EXTENSION;
        this.state.toolCallBudget = this.currentBudget;
        this.extensionGateFired = false;
        this.config.onStep?.({
          step: this.stepCount,
          action: 'budget_extended',
          type: 'budget_warning',
          newBudget: this.currentBudget,
          result: `Budget extended to ${this.currentBudget} tool calls. Continuing investigation.`,
        });
        return undefined;
      }
    }

    if (this.state.toolCallCount >= this.currentBudget) {
      if (!this.isWorker && toolName === 'assemble_output') {
        return undefined;
      }
      if (!this.isWorker && WRITING_TOOLS.has(toolName)) {
        return undefined;
      }

      if (!this.isWorker && !this.budgetExhaustedFired && this.config.onBudgetExhausted) {
        this.budgetExhaustedFired = true;
        const shouldExtend = await this.config.onBudgetExhausted({
          findings: this.state.findings.length,
          toolCalls: this.state.toolCallCount,
          budget: this.currentBudget,
        });
        if (shouldExtend) {
          this.currentBudget += BUDGET_EXTENSION;
          this.state.toolCallBudget = this.currentBudget;
          this.budgetExhaustedFired = false;
          this.config.onStep?.({
            step: this.stepCount,
            action: 'budget_extended',
            type: 'budget_warning',
            newBudget: this.currentBudget,
            result: `Budget extended to ${this.currentBudget} tool calls. Continuing investigation.`,
          });
          return undefined;
        }
      }

      if (this.checkpointInterval > 0) {
        try {
          saveCheckpoint(this.outputDir, this.repoSlug,
            buildCheckpointEntry(this.sessionId, ++this.checkpointSeq, 'budget_exhausted', this.state));
        } catch { /* best-effort */ }
      }
      const msg = this.isWorker
        ? `Worker budget exhausted (${this.currentBudget} calls used). Call record_finding for remaining observations.`
        : `Tool call budget exhausted (${this.currentBudget} calls used). Call assemble_output now.`;
      return { block: true, reason: msg };
    }

    return undefined;
  }

  // ─── afterToolCall hook ───────────────────────────────────────────

  async afterToolCall(
    ctx: AfterToolCallContext,
    _signal?: AbortSignal,
  ): Promise<AfterToolCallResult | undefined> {
    const toolName = ctx.toolCall.name;
    this.state.toolCallCount++;
    this.stepCount++;

    if (toolName === 'web_search') this.state.webSearchCount++;
    if (toolName === 'fetch_url') this.state.urlFetchCount++;

    // Track which files each toolCallId touched (for evidence pinning + stale collapsing)
    const tcId = ctx.toolCall.id;
    if (tcId) {
      this.toolCallIdToName.set(tcId, toolName);
      const args = ctx.args as Record<string, unknown>;
      const files = new Set<string>();
      if (toolName === 'read_file' && typeof args.path === 'string') {
        files.add(args.path.replace(/\\/g, '/').replace(/^\.\//, ''));
      } else if (toolName === 'read_files_batch' && Array.isArray(args.paths)) {
        for (const p of args.paths) if (typeof p === 'string') files.add(p.replace(/\\/g, '/').replace(/^\.\//, ''));
      } else if (toolName === 'grep_pattern' && typeof args.path === 'string') {
        files.add(args.path.replace(/\\/g, '/').replace(/^\.\//, ''));
      }
      if (files.size > 0) this.toolCallIdToFiles.set(tcId, files);
    }

    const reasoning = this.lastAssistantReasoning;
    const thinking = this.lastAssistantThinking;
    const resultText = ctx.result?.content?.[0]?.type === 'text'
      ? (ctx.result.content[0] as { type: 'text'; text: string }).text
      : '';
    const redactedResult = redactSecrets(resultText);
    const cleanResult = redactedResult.replaceAll(this.config.repoPath, '');
    const argsJson = JSON.stringify(ctx.args);
    const cappedResult = cleanResult.length > this.TRACE_RESULT_CAP
      ? cleanResult.slice(0, this.TRACE_RESULT_CAP) + `\n...[truncated ${cleanResult.length - this.TRACE_RESULT_CAP} chars]`
      : cleanResult;
    const startMs = tcId ? this.toolStartTimes.get(tcId) : undefined;
    const durationMs = startMs ? Date.now() - startMs : undefined;
    if (tcId) this.toolStartTimes.delete(tcId);

    this.state.investigationLog.push({
      step: this.stepCount,
      action: toolName,
      reasoning: reasoning.slice(0, 200),
      result: cleanResult.slice(0, 200),
      fullReasoning: reasoning || undefined,
      fullResult: cappedResult || undefined,
      args: argsJson !== '{}' && argsJson !== 'null' && argsJson !== 'undefined' ? argsJson : undefined,
      timestamp: new Date().toISOString(),
      model: this.lastAssistantModel || undefined,
      batchId: this.currentBatchId,
      durationMs,
      thinking: thinking || undefined,
    });

    // Keep compressionState.findings in sync (shared reference may diverge after dedup/filter)
    this.compressionState.findings = this.state.findings;

    const isFinding = toolName === 'record_finding';
    const isAssemble = toolName === 'assemble_output';
    const toolDetails = ctx.result?.details && typeof ctx.result.details === 'object' && Object.keys(ctx.result.details as object).length > 0
      ? ctx.result.details as Record<string, unknown>
      : undefined;
    const cappedRedacted = redactedResult.length > this.TRACE_RESULT_CAP
      ? redactedResult.slice(0, this.TRACE_RESULT_CAP) + `\n...[truncated]`
      : redactedResult;
    this.config.onStep?.({
      step: this.stepCount,
      action: toolName,
      reasoning: reasoning.slice(0, 100),
      result: redactedResult.slice(0, 100),
      type: isAssemble ? 'assemble_output' : isFinding ? 'finding' : 'tool_call',
      batchId: this.currentBatchId,
      ...(toolDetails ? { details: toolDetails } : {}),
      fullReasoning: reasoning,
      fullResult: cappedRedacted,
      args: argsJson,
      model: this.lastAssistantModel || undefined,
      durationMs,
      thinking: thinking || undefined,
    });

    if (this.checkpointInterval > 0 && this.state.toolCallCount % this.checkpointInterval === 0) {
      try {
        saveCheckpoint(this.outputDir, this.repoSlug,
          buildCheckpointEntry(this.sessionId, ++this.checkpointSeq, 'periodic', this.state));
      } catch { /* best-effort */ }
    }

    // Intent-based model switch — full mode only (workers don't switch)
    if (!this.isWorker && toolName === 'switch_to_fast_model' && !this.modelSwitched) {
      this.modelSwitched = true;
      this.snipBoundaryActive = true;
      this.compressionState.snipBoundaryActive = true;
      this.clearSummaryCache();
      if (this.canSwitchModel) {
        const fastId = this.piFastModel.id;
        this.switchModelInPlace();
        this.config.onStep?.({
          step: this.stepCount,
          action: 'model_switch',
          type: 'model_switch',
          result: `Switched to fast model (${fastId}) for writing phase. Agent signaled investigation complete. Snip boundary active — context compressed.`,
        });
      }
    }

    if (isFinding) {
      const args = ctx.args as { title?: string; description?: string };
      if (args.title && !validateFindingContent(args.title)) {
        this.config.onStep?.({
          step: this.stepCount,
          action: 'injection_warning',
          type: 'budget_warning',
          result: 'Potential prompt injection detected in finding content. Review manually.',
        });
      }
    }

    if (isAssemble && this.assembledRef.sections !== null) {
      this.terminationReason = 'completed';
      return { terminate: true };
    }

    if (redactedResult) {
      const sanitized = sanitizeToolOutput(redactedResult);
      const wrapped = wrapInBoundary(toolName, sanitized);
      return { content: [{ type: 'text', text: wrapped }] };
    }

    // Steering messages — full mode only (workers have hard budgets, no steering)
    if (!this.isWorker) {
      const remaining = this.currentBudget - this.state.toolCallCount;
      if (
        !this.progressSummarySent &&
        this.assembledRef.sections === null &&
        this.state.toolCallCount >= Math.floor(this.currentBudget * 0.7) &&
        remaining > 0
      ) {
        this.progressSummarySent = true;
        const filesArr = [...this.state.filesRead].slice(0, 20);
        const findingTitles = this.state.findings.map((f) => `${f.category}: ${f.title}`);
        const categoriesCovered = new Set(this.state.findings.map((f) => f.category));
        const lines = [
          `PROGRESS CHECKPOINT — ${this.state.toolCallCount}/${this.currentBudget} tool calls used, ${remaining} remaining.`,
          `Files read (${this.state.filesRead.size} total): ${filesArr.join(', ')}${this.state.filesRead.size > 20 ? '...' : ''}`,
          `Findings recorded (${this.state.findings.length}): ${findingTitles.join('; ') || 'none yet'}`,
          `Categories covered: ${categoriesCovered.size > 0 ? [...categoriesCovered].join(', ') : 'none'}`,
          'Do NOT re-investigate files or areas already covered above. Focus remaining budget on uncovered categories, then record findings and assemble output.',
        ];
        this.agent.steer({
          role: 'user',
          content: lines.join('\n'),
          timestamp: Date.now(),
        });
      }

      if (remaining <= 5 && remaining > 0 && !this.budgetWarning5Sent && this.assembledRef.sections === null) {
        this.budgetWarning5Sent = true;
        if (!this.modelSwitched && this.canSwitchModel) {
          this.modelSwitched = true;
          this.snipBoundaryActive = true;
          this.compressionState.snipBoundaryActive = true;
          this.clearSummaryCache();
          const fastId = this.piFastModel.id;
          this.switchModelInPlace();
          this.config.onStep?.({
            step: this.stepCount,
            action: 'model_switch',
            type: 'model_switch',
            result: `Switched to fast model (${fastId}) — budget critical. Snip boundary active.`,
          });
        }
        this.agent.steer({
          role: 'user',
          content: this.state.findings.length === 0
            ? `CRITICAL: Only ${remaining} tool calls left and you have 0 findings recorded. Call record_finding IMMEDIATELY for each observation, then assemble_output. Do not investigate further.`
            : `CRITICAL: Only ${remaining} tool calls left. You MUST call assemble_output NOW with your written content for all required sections. Use your investigation so far — do not investigate further.`,
          timestamp: Date.now(),
        });
      } else if (remaining <= this.halfBudget && remaining > 0 && !this.budgetWarningHalfSent && this.assembledRef.sections === null) {
        this.budgetWarningHalfSent = true;
        this.agent.steer({
          role: 'user',
          content: `You have ${remaining} tool calls remaining out of ${this.currentBudget}. If you haven't called switch_to_fast_model yet, do it now. Then record your findings and call assemble_output.`,
          timestamp: Date.now(),
        });
      } else if (
        !this.budgetWarningRecordingSent &&
        this.assembledRef.sections === null &&
        this.state.findings.length === 0 &&
        this.state.toolCallCount >= Math.floor(this.currentBudget * 0.4) &&
        remaining > 0
      ) {
        this.budgetWarningRecordingSent = true;
        this.agent.steer({
          role: 'user',
          content: `You have used ${this.state.toolCallCount}/${this.currentBudget} tool calls and recorded 0 findings. Start calling record_finding NOW for what you have already observed. Investigate a category, then immediately record findings for it before moving to the next category. Do not defer all recording to the end.`,
          timestamp: Date.now(),
        });
      }
    }

    return undefined;
  }

  // ─── Event handler ────────────────────────────────────────────────

  handleAgentEvent(event: AgentEvent, _signal: AbortSignal): void {
    if (event.type === 'message_start' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      this.currentBatchId = randomUUID();
      this.streamingText = '';
      this.lastAssistantThinking = '';
      this.turnStartMs = Date.now();
      this.turnCount++;
    }

    if (event.type === 'message_update') {
      const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent;
      if (ame?.type === 'text_delta' && ame.delta) {
        this.streamingText += ame.delta;
        this.config.onStep?.({
          step: this.stepCount,
          action: 'text_delta',
          type: 'text_delta',
          reasoning: this.streamingText,
        });
      } else if (ame?.type === 'thinking_delta' && ame.delta) {
        this.lastAssistantThinking += ame.delta;
      }
    }

    if (event.type === 'tool_execution_start') {
      const te = event as { toolCallId?: string; toolName?: string; args?: Record<string, unknown> };
      if (te.toolCallId) this.toolStartTimes.set(te.toolCallId, Date.now());
      this.config.onStep?.({
        step: this.stepCount,
        action: te.toolName ?? 'unknown',
        type: 'tool_start',
        args: te.args ? JSON.stringify(te.args) : undefined,
        batchId: this.currentBatchId,
      });
    }

    if (event.type === 'message_end' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      if (this.turnStartMs > 0) {
        this.totalLlmMs += Date.now() - this.turnStartMs;
        this.turnStartMs = 0;
      }

      const msg = event.message;
      this.lastAssistantModel = msg.model ?? '';
      trackUsage(this.state, msg.model, {
        inputTokens: msg.usage.input,
        outputTokens: msg.usage.output,
        cachedTokens: msg.usage.cacheRead,
      });

      if (Array.isArray(msg.content)) {
        const textParts = (msg.content as { type: string; text?: string }[])
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text!);
        if (textParts.length > 0) {
          this.lastAssistantReasoning = textParts.join('\n').trim();

          if (this.lastAssistantReasoning) {
            this.config.onStep?.({
              step: this.stepCount,
              action: 'reasoning',
              type: 'text_response',
              reasoning: this.lastAssistantReasoning.slice(0, 100),
              fullReasoning: this.lastAssistantReasoning,
              model: this.lastAssistantModel || undefined,
              thinking: this.lastAssistantThinking || undefined,
            });
          }
        }

        // Extract thinking blocks from final message as fallback if deltas were missed
        if (!this.lastAssistantThinking) {
          const thinkingParts = (msg.content as { type: string; thinking?: string }[])
            .filter((c) => c.type === 'thinking' && c.thinking)
            .map((c) => c.thinking!);
          if (thinkingParts.length > 0) {
            this.lastAssistantThinking = thinkingParts.join('\n').trim();
          }
        }
      }
    }
  }
}
