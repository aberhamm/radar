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
import { buildPiTools, type AssembledSections } from '../tools/piToolAdapter.js';
import { verifyFindingEvidence } from '../tools/analysis/verifyEvidence.js';
import { deduplicateFindings } from '../tools/analysis/deduplicateFindings.js';
import { detectAppRoots } from '../tools/analysis/detectAppRoots.js';
import { parsePackageJson } from '../tools/config/parsePackageJson.js';
import { listDirectory } from '../tools/repo/listDirectory.js';
import { getSpecialistPrompts } from '../tools/analysis/getSpecialistPrompts.js';
import { buildPiModel } from '../config/piModel.js';
import { computeScorecard } from '../output/scorecard.js';
import { renderBrief } from '../output/brief.js';
import { buildFullExport, serializeExport } from '../output/json.js';
import { saveSessionCost, buildSessionCostEntry } from '../output/sessionCosts.js';
import {
  saveCheckpoint, buildCheckpointEntry, buildSessionId,
  loadLatestCheckpoint, hydrateState, buildResumeSummary,
} from '../output/sessionCheckpoint.js';
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
  /** Scope investigation to a specific app root within a monorepo (relative path from repoPath) */
  appRoot?: string;
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
  /** Path to checkpoint JSONL file to resume from. */
  resumeFrom?: string;
  /** Save checkpoints every N tool calls (default: 5). Set 0 to disable. */
  checkpointInterval?: number;
  /** Pre-populated state from a prior pass (for tiered investigation).
   *  Findings, filesRead, fileReadCache carry over. Budgets reset. */
  initialState?: Partial<AgentState>;
  /** Pre-computed repo signals (app roots, package.json, file tree).
   *  When provided, runAgent skips its own runPreCompute() call. */
  preCompute?: PreComputeResult;
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
  type?: 'tool_call' | 'tool_start' | 'finding' | 'budget_warning' | 'text_response' | 'text_delta' | 'assemble_output' | 'model_switch' | 'verification';
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

// --- State merging ---

/**
 * Merge prior state into a fresh state object.
 * Carries over: findings, filesRead, fileReadCache, resolvedVersions, stackProfile, fetchedDocs, modelUsage.
 * Does NOT carry over: toolCallCount, toolCallBudget, webSearchCount, urlFetchCount, goal, investigationLog.
 * Includes input validation — rejects corrupt state shapes gracefully.
 */
export function mergeState(target: AgentState, source: Partial<AgentState>): void {
  if (source.findings && Array.isArray(source.findings)) {
    target.findings = [...source.findings];
  }
  if (source.filesRead && source.filesRead instanceof Set) {
    for (const f of source.filesRead) target.filesRead.add(f);
  }
  if (source.fileReadCache && source.fileReadCache instanceof Map) {
    for (const [k, v] of source.fileReadCache) {
      target.fileReadCache.set(k, v);
    }
  }
  if (source.resolvedVersions && typeof source.resolvedVersions === 'object') {
    target.resolvedVersions = { ...source.resolvedVersions };
  }
  if (source.stackProfile) {
    target.stackProfile = source.stackProfile;
  }
  if (source.fetchedDocs && Array.isArray(source.fetchedDocs)) {
    target.fetchedDocs = [...source.fetchedDocs];
  }
  if (source.modelUsage && source.modelUsage instanceof Map) {
    for (const [k, v] of source.modelUsage) {
      const existing = target.modelUsage.get(k);
      if (existing) {
        existing.calls += v.calls;
        existing.inputTokens += v.inputTokens;
        existing.outputTokens += v.outputTokens;
        existing.cachedTokens += v.cachedTokens;
      } else {
        target.modelUsage.set(k, { ...v });
      }
    }
  }
}

// --- Pre-computation layer ---

export interface PreComputeResult {
  appRoots?: Awaited<ReturnType<typeof detectAppRoots>>;
  packageJson?: Awaited<ReturnType<typeof parsePackageJson>>;
  fileTree?: Awaited<ReturnType<typeof listDirectory>>;
  specialists?: Awaited<ReturnType<typeof getSpecialistPrompts>>;
}

/**
 * Run deterministic tools before the agent loop to seed the initial context.
 * Saves 3-5 LLM round-trips by pre-computing what the agent would discover
 * in its first few turns. Failures are graceful — the agent proceeds without
 * whatever tool failed.
 */
export async function runPreCompute(repoPath: string, appRoot?: string): Promise<PreComputeResult> {
  const result: PreComputeResult = {};

  // When an appRoot is specified, scope scanning to that subdirectory
  const scanPath = appRoot ? path.join(repoPath, appRoot) : repoPath;
  const pkgJsonPath = appRoot ? path.join(appRoot, 'package.json') : 'package.json';
  const listPath = appRoot ?? '.';

  // Phase 1: Run independent tools in parallel
  const [appRootsResult, packageJsonResult, fileTreeResult] = await Promise.allSettled([
    detectAppRoots(repoPath, appRoot ? { repoPath: appRoot } : {}),
    parsePackageJson(repoPath, { path: pkgJsonPath }),
    listDirectory(repoPath, { path: listPath, depth: 2 }),
  ]);

  if (appRootsResult.status === 'fulfilled') {
    const roots = appRootsResult.value;
    // Cap at 15 roots to prevent context overflow in large monorepos
    if (roots.roots.length > 15) {
      const total = roots.roots.length;
      // Keep root-level + shallowest entries
      roots.roots = roots.roots.slice(0, 15);
      roots.roots.push({
        path: `... and ${total - 15} more (${total} total)`,
        type: 'unknown',
        hasPackageJson: false,
      });
    }
    result.appRoots = roots;
  }
  if (packageJsonResult.status === 'fulfilled') result.packageJson = packageJsonResult.value;
  if (fileTreeResult.status === 'fulfilled') result.fileTree = fileTreeResult.value;

  // Phase 2: Chain specialist prompts from app roots (requires Phase 1)
  if (result.appRoots && result.appRoots.roots.length > 0) {
    try {
      // Only pass real roots (not the "... and N more" placeholder)
      const realRoots = result.appRoots.roots.filter(r => !r.path.startsWith('...'));
      result.specialists = await getSpecialistPrompts({
        roots: realRoots,
        isMonorepo: !!result.appRoots.monorepoTool,
        monorepoTool: result.appRoots.monorepoTool,
      });
    } catch { /* graceful — agent will call get_specialist_prompts itself */ }
  }

  return result;
}

/**
 * Format pre-computed results as a concise context block for the goal prompt.
 */
export function formatPreComputeContext(pre: PreComputeResult): string {
  const sections: string[] = ['PRE-COMPUTED CONTEXT (skip detect_app_roots, get_specialist_prompts, parse_package_json, and list_directory for root — this data is already available):'];

  if (pre.appRoots) {
    const roots = pre.appRoots.roots.map(r => {
      const parts = [r.type, r.frameworkVersion ? `v${r.frameworkVersion}` : null, r.plugins?.length ? `plugins: ${r.plugins.join(', ')}` : null].filter(Boolean);
      return `  ${r.path}: ${parts.join(', ')}`;
    }).join('\n');
    sections.push(`App Roots (${pre.appRoots.roots.length}):\n${roots}`);
    if (pre.appRoots.monorepoTool) sections.push(`Monorepo: ${pre.appRoots.monorepoTool}`);
  }

  if (pre.specialists && pre.specialists.specialists.length > 0) {
    const specs = pre.specialists.specialists.map(s =>
      `  ${s.name} (${s.relevance}): ${s.checklist.slice(0, 150)}${s.checklist.length > 150 ? '...' : ''}`
    ).join('\n');
    sections.push(`Specialist Checklists:\n${specs}`);
  }

  if (pre.packageJson) {
    const pkg = pre.packageJson;
    const depCount = Object.keys(pkg.dependencies).length;
    const devCount = Object.keys(pkg.devDependencies).length;
    const scripts = Object.keys(pkg.scripts).join(', ');
    sections.push(`Package: ${pkg.name} — ${depCount} deps, ${devCount} devDeps, scripts: [${scripts}]`);
  }

  if (pre.fileTree && pre.fileTree.entries) {
    const dirs = pre.fileTree.entries.filter(e => e.type === 'directory').map(e => e.path);
    const files = pre.fileTree.entries.filter(e => e.type === 'file').map(e => e.path);
    sections.push(`File tree (depth 2): ${dirs.length} dirs, ${files.length} files\n  Dirs: ${dirs.slice(0, 20).join(', ')}${dirs.length > 20 ? '...' : ''}\n  Root files: ${files.slice(0, 15).join(', ')}${files.length > 15 ? '...' : ''}`);
  }

  return sections.join('\n\n');
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
    fileReadCache: new Map(),
  };

  // Session checkpoint tracking
  let sessionId = buildSessionId(config.repoName, config.goal);
  let checkpointSeq = 0;
  const checkpointInterval = config.checkpointInterval ?? 5;
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
      // Merge carry-over fields (findings, filesRead, fileReadCache, etc.)
      mergeState(state, hydrated);
      // Restore checkpoint-specific fields that mergeState intentionally skips
      state.toolCallCount = hydrated.toolCallCount;
      state.webSearchCount = hydrated.webSearchCount;
      state.urlFetchCount = hydrated.urlFetchCount;
      state.docTokensUsed = hydrated.docTokensUsed;
      state.investigationLog = hydrated.investigationLog;
      // Restore budgets to allow extending beyond the original
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

  // Detect platform if not provided
  const platform = config.platform ?? 'unknown';

  // Pre-compute deterministic tool results to seed the agent's initial context.
  // Saves 3-5 LLM round-trips by providing app roots, package.json, file tree,
  // and specialist checklists before the agent starts reasoning.
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
  const systemPrompt = buildSystemPrompt(config.goal, platform) + '\n\n---\n\n' + BOUNDARY_SYSTEM_INSTRUCTION;
  let goalPrompt = buildGoalPrompt(config.goal, config.repoPath, toolCallBudget, webSearchBudget);

  // Inject pre-computed context into the goal prompt
  if (preComputeContext) {
    goalPrompt += `\n\n---\n\n${preComputeContext}`;
  }

  // If resuming with prior findings, prepend context summary
  if (config.resumeFrom && state.findings.length > 0) {
    const summary = buildResumeSummary(state);
    goalPrompt = `RESUME CONTEXT — This is a resumed investigation. Here is what was found before the interruption:\n\n${summary}\n\nContinue the investigation from where it left off. Do not re-investigate files already read. Focus on uncovered categories and assembling the final output.\n\n---\n\n${goalPrompt}`;
  }

  // Build Pi tools from registry
  const { tools, assembledRef, cleanup, mutex } = buildPiTools(state);

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
  let budgetWarningRecordingSent = false; // 40% — nudge to start recording
  let budgetWarningHalfSent = false;
  let budgetWarning5Sent = false;
  let modelSwitched = false; // true once agent calls switch_to_fast_model
  let snipBoundaryActive = false; // true after model switch — aggressive context compression
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

    // If assemble_output already fired, abort on the next tool call.
    // This allows tools in the same batch as assemble_output to complete
    // while preventing additional turns from starting.
    if (terminationReason === 'completed' && toolName !== 'record_finding') {
      agent.abort();
      return { block: true, reason: 'Output assembly complete.' };
    }

    // Recording enforcement gate: when 60%+ budget is spent with zero findings,
    // block investigation tools to force the agent into recording mode.
    // Only record_finding, switch_to_fast_model, and assemble_output are allowed.
    // At 100% budget, fall through to the budget exhaustion check instead so
    // the user gets the extend prompt (the gate alone can't extend budget).
    const RECORDING_GATE_PCT = 0.60;
    const WRITING_TOOLS = new Set(['record_finding', 'switch_to_fast_model', 'assemble_output']);
    if (
      state.findings.length === 0 &&
      state.toolCallCount >= Math.floor(currentBudget * RECORDING_GATE_PCT) &&
      state.toolCallCount < currentBudget &&
      !WRITING_TOOLS.has(toolName)
    ) {
      if (!modelSwitched && canSwitchModel) {
        modelSwitched = true;
        snipBoundaryActive = true;
        summaryCache.clear();
        switchModelInPlace();
      }
      return {
        block: true,
        reason: `Investigation budget exhausted (${state.toolCallCount}/${currentBudget} calls used, 0 findings recorded). You MUST call record_finding now for what you have observed, then assemble_output.`,
      };
    }

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

      // Budget exhausted — ask whether to extend.
      // Fire for ANY tool (including record_finding) so the user always gets
      // the extend prompt when budget is fully spent, even mid-recording.
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
      // Decline or no callback — save checkpoint before blocking.
      // Still allow record_finding and switch_to_fast_model through so the
      // agent can finish writing even without an extension.
      if (WRITING_TOOLS.has(toolName)) {
        return undefined;
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

  // afterToolCall: counter tracking, budget warnings, assemble_output abort
  const afterToolCall = async (
    ctx: AfterToolCallContext,
    _signal?: AbortSignal,
  ): Promise<AfterToolCallResult | undefined> => {
    const toolName = ctx.toolCall.name;
    state.toolCallCount++;
    stepCount++;

    // Track web tool budgets here (not in execute()) so the check-then-act in
    // beforeToolCall is race-free: beforeToolCall reads the counter, afterToolCall
    // increments it, and Pi doesn't fire a new batch until afterToolCall completes.
    // Note: filesRead.add() stays in execute() because recordFinding checks it
    // inside its own execute() and can race with afterToolCall.
    if (toolName === 'web_search') state.webSearchCount++;
    if (toolName === 'fetch_url') state.urlFetchCount++;

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

    // Periodic checkpoint (best-effort, never blocks the loop)
    if (checkpointInterval > 0 && state.toolCallCount % checkpointInterval === 0) {
      try {
        saveCheckpoint(outputDir, repoSlug,
          buildCheckpointEntry(sessionId, ++checkpointSeq, 'periodic', state));
      } catch { /* best-effort */ }
    }

    // Intent-based model switch: agent signals it's done investigating
    if (toolName === 'switch_to_fast_model' && !modelSwitched) {
      modelSwitched = true;
      snipBoundaryActive = true; // Activate aggressive context compression for writing phase
      // Clear summary cache so old entries get re-compressed at tighter limits
      summaryCache.clear();
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

    // If assemble_output was called, set termination flag.
    // DON'T abort immediately — other tools in the same parallel batch
    // (e.g., record_finding) may not have executed yet, and Pi's abort
    // cancels pending tool executions at the framework level.
    // Instead, abort via beforeToolCall on the NEXT turn.
    if (isAssemble && assembledRef.sections !== null) {
      terminationReason = 'completed';
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
        snipBoundaryActive = true;
        summaryCache.clear();
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
  const KEEP_RECENT = 16;
  const MID_AGE_WINDOW = 15;
  const MID_SUMMARY_MAX = 600;
  const OLD_SUMMARY_MAX = 200;
  // After model switch, moderate compression — writing phase still needs investigation context
  // to write meaningful findings. 80/40 was too aggressive and starved the fast model.
  const SNIP_MID_MAX = 300;
  const SNIP_OLD_MAX = 150;
  const summaryCache = new Map<string, string>();

  function compressToolResult(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return text.slice(0, maxChars) + '...[pruned]';
  }

  const transformContext = async (messages: AgentMessage[]): Promise<AgentMessage[]> => {
    if (messages.length <= KEEP_RECENT) return messages;

    const tier2Start = Math.max(0, messages.length - KEEP_RECENT - MID_AGE_WINDOW);
    const tier1Start = messages.length - KEEP_RECENT;

    // When snip boundary is active (post model switch), use much tighter limits
    const effectiveMidMax = snipBoundaryActive ? SNIP_MID_MAX : MID_SUMMARY_MAX;
    const effectiveOldMax = snipBoundaryActive ? SNIP_OLD_MAX : OLD_SUMMARY_MAX;

    return messages.map((msg, i) => {
      // Tier 1: recent — keep intact
      if (i >= tier1Start) return msg;
      if (!msg || typeof msg !== 'object' || !('role' in msg)) return msg;
      if ((msg as { role: string }).role !== 'toolResult') return msg;

      const tr = msg as unknown as { role: string; toolCallId?: string; content: { type: string; text?: string }[]; [k: string]: unknown };
      const maxChars = i >= tier2Start ? effectiveMidMax : effectiveOldMax;

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

  // --- Per-turn timing instrumentation ---
  let turnStartMs = 0;
  let totalLlmMs = 0;
  let totalToolMs = 0;
  let turnCount = 0;

  // Subscribe to events for usage tracking, reasoning capture, and batchId rotation
  let streamingText = ''; // accumulates text deltas within a single message
  agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_start' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      // New assistant turn — rotate the batchId so parallel tool calls in this turn share it
      currentBatchId = randomUUID();
      streamingText = '';
      turnStartMs = Date.now();
      turnCount++;
    }

    // Stream text deltas to dashboard in real-time (no waiting for message_end)
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
      }
    }

    // Emit tool_start immediately when Pi begins executing a tool (before it completes)
    if (event.type === 'tool_execution_start') {
      const te = event as { toolName?: string; args?: Record<string, unknown> };
      config.onStep?.({
        step: stepCount,
        action: te.toolName ?? 'unknown',
        type: 'tool_start',
        args: te.args ? JSON.stringify(te.args) : undefined,
        batchId: currentBatchId,
      });
    }

    if (event.type === 'message_end' && event.message && 'role' in event.message && event.message.role === 'assistant') {
      // Track per-turn LLM latency
      if (turnStartMs > 0) {
        totalLlmMs += Date.now() - turnStartMs;
        turnStartMs = 0;
      }

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
      // Save error checkpoint before handling
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
      // Auto-assemble from whatever findings we have
      if (assembledRef.sections === null && state.findings.length > 0) {
        assembledRef.sections = autoAssembleFromFindings(state);
      }
    }
  }

  // Drain the mutex: when record_finding and assemble_output are in the same batch,
  // the mutex may still be processing record_finding calls after assemble_output
  // triggers termination. Without draining, those findings would be lost.
  await mutex.drain();

  // Post-loop: assemble output (partial if error/stuck)
  const sections = assembledRef.sections ?? {};

  // --- Post-loop: verification, dedup, scorecard, output ---
  // Emit progress events so the UI doesn't appear frozen.

  config.onStep?.({
    step: ++stepCount,
    action: 'post_process',
    type: 'verification',
    result: `Verifying evidence for ${state.findings.length} findings...`,
  });

  // Post-investigation verification pass: re-verify all evidence against actual files.
  // Removes findings where ALL evidence is unverifiable (likely hallucinated).
  // Parallelize file reads — each finding's evidence is independent.
  const verificationResults = await Promise.all(
    state.findings.map((finding) => verifyFindingEvidence(config.repoPath, finding)),
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

  // Deduplicate findings with overlapping evidence and similar content.
  // Merges near-duplicate findings (same category + severity + overlapping file paths)
  // into one finding with combined evidence — prevents inflated risk counts.
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

  config.onStep?.({
    step: ++stepCount,
    action: 'post_process',
    type: 'verification',
    result: 'Computing scorecard and rendering output...',
  });

  const scorecard = computeScorecard(config.repoName, config.goal, state.findings);

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

  const fullExport = buildFullExport(state, scorecard, sections, metrics, terminationReason, currentBudget);
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

  // Persist session cost for cross-run tracking
  try {
    const costEntry = buildSessionCostEntry(config.repoName, config.goal, metrics);
    saveSessionCost(outputDir, costEntry);
  } catch { /* best-effort — don't fail the run for cost tracking */ }

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

  // Clean up spilled tool results from this run's tmpdir
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
  llmLatencyMs?: number,
  llmTurns?: number,
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
    ...(llmLatencyMs != null ? { llmLatencyMs } : {}),
    ...(llmTurns != null ? { llmTurns } : {}),
  };
}

export function writeOutputFiles(
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
