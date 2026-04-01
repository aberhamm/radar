import type { ModelProvider, ChatMessage, ToolDefinition, ToolCall } from '../types/provider.js';
import type { AgentState, GoalType, ModelUsageEntry } from '../types/state.js';
import type { Scorecard, RunMetrics } from '../types/output.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { buildGoalPrompt } from './goalPrompts.js';
import { getToolDefinitions, executeTool } from '../tools/registry.js';
import { computeScorecard } from '../output/scorecard.js';
import { renderBrief } from '../output/brief.js';
import { buildFullExport, serializeExport } from '../output/json.js';
import { loadModelConfig } from '../config/models.js';
import fs from 'node:fs';
import path from 'node:path';

export interface RunnerConfig {
  provider: ModelProvider;
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
}

export interface StepEvent {
  step: number;
  action: string;
  reasoning?: string;
  result?: string;
}

export interface RunResult {
  scorecard: Scorecard;
  briefMarkdown: string;
  exportJson: string;
  outputPaths: string[];
  metrics: RunMetrics;
  state: AgentState;
}

/**
 * DirectLoopRunner — the core agent loop.
 *
 * Observe → Reason → Act cycle:
 * 1. Send messages + tools to LLM
 * 2. If LLM returns tool_calls: execute tools, append results, loop
 * 3. If LLM returns text (end_turn/stop): reasoning or assemble_output signal
 * 4. If assemble_output was called: compute scorecard, render brief, export JSON
 * 5. Terminate when: output assembled, budget exhausted, or max retries exceeded
 */
export async function runAgent(config: RunnerConfig): Promise<RunResult> {
  const startedAt = new Date();
  const modelConfig = loadModelConfig();

  const toolCallBudget = config.toolCallBudget ?? 50;
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

  // Build system prompt from rules
  const systemPrompt = buildSystemPrompt(config.goal, platform);

  // Build goal prompt
  const goalPrompt = buildGoalPrompt(
    config.goal,
    config.repoPath,
    toolCallBudget,
    webSearchBudget,
  );

  // Initialize conversation
  const tools: ToolDefinition[] = getToolDefinitions();
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: goalPrompt },
  ];

  let stepCount = 0;
  let assembleOutputSections: Record<string, string> | null = null;
  let consecutiveEmptyResponses = 0;
  const MAX_EMPTY_RESPONSES = 2;

  // Agent loop
  while (state.toolCallCount < toolCallBudget) {
    stepCount++;

    // Call LLM
    const response = await config.provider.chat(messages, {
      tools,
      model: modelConfig.agent,
      maxTokens: 8192,
    });

    // Track usage
    trackUsage(state, response.model, {
      inputTokens: response.usage.promptTokens,
      outputTokens: response.usage.completionTokens,
      cachedTokens: response.usage.cachedTokens ?? 0,
    });

    const finishReason = response.finishReason;

    // Case 1: Tool calls — check for tool calls presence regardless of finish reason,
    // as some providers return 'stop' even when tool calls are present
    if (response.toolCalls.length > 0) {
      consecutiveEmptyResponses = 0;

      // Append assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.toolCalls,
      });

      // Execute each tool call
      for (const toolCall of response.toolCalls) {
        state.toolCallCount++;

        // Check budget enforcement
        if (toolCall.function.name === 'web_search' && state.webSearchCount >= webSearchBudget) {
          const result = JSON.stringify({ error: 'Web search budget exhausted.' });
          messages.push({ role: 'tool', content: result, tool_call_id: toolCall.id });
          continue;
        }
        if (toolCall.function.name === 'fetch_url' && state.urlFetchCount >= urlFetchBudget) {
          const result = JSON.stringify({ error: 'URL fetch budget exhausted.' });
          messages.push({ role: 'tool', content: result, tool_call_id: toolCall.id });
          continue;
        }

        // Check for assemble_output
        if (toolCall.function.name === 'assemble_output') {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            assembleOutputSections = args.sections ?? {};
          } catch {
            assembleOutputSections = {};
          }
          messages.push({
            role: 'tool',
            content: JSON.stringify({ status: 'acknowledged', message: 'Output assembly triggered.' }),
            tool_call_id: toolCall.id,
          });
          continue;
        }

        // Execute the tool
        const result = await executeTool(toolCall, state);

        // Log investigation step
        const reasoning = response.content ?? '';
        state.investigationLog.push({
          step: stepCount,
          action: toolCall.function.name,
          reasoning: reasoning.slice(0, 200),
          result: result.slice(0, 200),
        });

        config.onStep?.({
          step: stepCount,
          action: toolCall.function.name,
          reasoning: reasoning.slice(0, 100),
          result: result.slice(0, 100),
        });

        messages.push({ role: 'tool', content: result, tool_call_id: toolCall.id });
      }

      // If assemble_output was called, break out of the loop
      if (assembleOutputSections !== null) {
        break;
      }

      // Budget warning: nudge the agent to wrap up when near the limit
      const remaining = toolCallBudget - state.toolCallCount;
      if (remaining <= 5 && remaining > 0 && assembleOutputSections === null) {
        messages.push({
          role: 'user',
          content: `🛑 CRITICAL: Only ${remaining} tool calls left. You MUST call assemble_output NOW with your written content for all 12 onboarding sections. Use your investigation so far — do not investigate further.`,
        });
      } else if (remaining <= 15 && remaining > 0 && assembleOutputSections === null) {
        messages.push({
          role: 'user',
          content: `⚠️ You have ${remaining} tool calls remaining out of ${toolCallBudget}. Stop investigating. Record your findings now with record_finding, then call assemble_output with written content for every required section of the brief.`,
        });
      }

      continue;
    }

    // Case 2: Text response (end_turn/stop) — agent is thinking or done
    if (response.content && (finishReason === 'stop' || finishReason === 'end_turn')) {
      consecutiveEmptyResponses = 0;

      // Append the assistant's reasoning as a message
      messages.push({ role: 'assistant', content: response.content });

      // Nudge the agent to continue if it hasn't assembled output yet
      if (assembleOutputSections === null) {
        messages.push({
          role: 'user',
          content:
            'Continue your investigation. When you have enough findings, call the assemble_output tool.',
        });
      }
      continue;
    }

    // Case 3: Empty or malformed response
    consecutiveEmptyResponses++;
    if (consecutiveEmptyResponses >= MAX_EMPTY_RESPONSES) {
      // Force termination — agent is stuck
      break;
    }

    // Retry with a nudge
    messages.push({
      role: 'user',
      content: 'Please continue investigating or call assemble_output if ready.',
    });
  }

  // Post-loop: assemble output
  const sections = assembleOutputSections ?? {};
  const scorecard = computeScorecard(config.repoName, config.goal, state.findings);

  const completedAt = new Date();
  const metrics = buildMetrics(state, startedAt, completedAt, modelConfig.agent);

  const briefMarkdown = renderBrief(
    scorecard,
    sections,
    state.investigationLog,
    state.fetchedDocs,
    state.toolCallCount,
    toolCallBudget,
  );

  const fullExport = buildFullExport(state, scorecard, sections, metrics);
  const exportJson = serializeExport(fullExport);

  // Write output files
  const outputPaths = writeOutputFiles(
    outputDir,
    config.repoName,
    scorecard,
    briefMarkdown,
    exportJson,
    state,
  );

  return {
    scorecard,
    briefMarkdown,
    exportJson,
    outputPaths,
    metrics,
    state,
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
  agentModel: string,
): RunMetrics {
  const models: RunMetrics['models'] = {};
  for (const [modelId, usage] of state.modelUsage.entries()) {
    const costPerInputToken = 0.003 / 1000; // rough estimate
    const costPerOutputToken = 0.015 / 1000;
    const estimated =
      usage.inputTokens * costPerInputToken +
      usage.outputTokens * costPerOutputToken;

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
