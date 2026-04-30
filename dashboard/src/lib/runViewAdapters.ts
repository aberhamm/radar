import type { Scorecard, RunMetrics, StepEvent, CategoryScore, ScoreLevel } from './agentSession';
import { transformRunData, normalizeFindings, type TransformedRunData, type Finding } from './runTransform';

// ─── Shared types ───────────────────────────────────────────────

export interface MultiGoalGoal {
  id: string;
  goal: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  briefMarkdown: string;
  findingsCount: number;
  findings: Finding[];
}

export interface MultiGoalDataGoal {
  id: string;
  goal: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  briefMarkdown: string;
  findingsCount: number;
  findings: unknown[];
}

export interface PassSummary {
  name: string;
  eventCount: number;
  budget?: number;
  terminationReason?: string;
}

export interface MultiGoalData {
  parentId: string;
  repoName: string;
  repoUrl?: string;
  startedAt: string;
  completedAt?: string;
  goals: MultiGoalDataGoal[];
  events?: StepEvent[];
  rundata?: TransformedRunData;
  passSummary?: PassSummary[];
  toolCallCount?: number;
  findings: unknown[];
  totalFindings: number;
}

// ─── RunView mode discriminant ──────────────────────────────────

export interface SingleRunData {
  briefMarkdown: string;
  scorecard: Scorecard;
  metrics: RunMetrics;
  events: StepEvent[];
  goal: string;
  findings: unknown[];
  runId?: string;
  repoUrl?: string;
  investigationRunData?: TransformedRunData;
}

export interface MultiRunData {
  parentId: string;
  repoName: string;
  repoUrl?: string;
  goals: MultiGoalGoal[];
  events: StepEvent[];
  passSummary?: PassSummary[];
  findings: Finding[];
  totalFindings: number;
  metrics: RunMetrics;
  worstScore: ScoreLevel;
  mergedScorecard: Scorecard;
  runData: TransformedRunData | undefined;
}

export type RunViewMode =
  | { kind: 'single'; data: SingleRunData }
  | { kind: 'multi';  data: MultiRunData };

// ─── Multi-goal aggregation helpers ─────────────────────────────

const SCORE_ORDER: Record<string, number> = { red: 3, yellow: 2, green: 1 };
const SEV_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

export function aggregateMetrics(goals: MultiGoalGoal[], toolCallCount: number, startedAt: string, completedAt?: string): RunMetrics {
  const allMetrics = goals.map(g => g.metrics).filter(Boolean);
  if (allMetrics.length === 0) {
    return { startedAt: '', completedAt: '', durationMs: 0, toolCalls: 0, models: {}, totalEstimatedCostUsd: 0 };
  }

  const first = allMetrics[0];
  const allIdentical = allMetrics.every(m =>
    m.totalEstimatedCostUsd === first.totalEstimatedCostUsd &&
    m.durationMs === first.durationMs,
  );

  if (allIdentical) {
    return {
      ...first,
      startedAt,
      completedAt: completedAt ?? '',
      toolCalls: toolCallCount,
    };
  }

  const mergedModels: RunMetrics['models'] = {};
  for (const m of allMetrics) {
    for (const [modelId, info] of Object.entries(m.models)) {
      if (!mergedModels[modelId]) {
        mergedModels[modelId] = { ...info };
      } else {
        mergedModels[modelId].calls += info.calls;
        mergedModels[modelId].inputTokens += info.inputTokens;
        mergedModels[modelId].outputTokens += info.outputTokens;
        mergedModels[modelId].cachedTokens += info.cachedTokens;
        mergedModels[modelId].estimatedCostUsd += info.estimatedCostUsd;
      }
    }
  }

  return {
    startedAt,
    completedAt: completedAt ?? '',
    durationMs: allMetrics.reduce((sum, m) => sum + m.durationMs, 0),
    toolCalls: toolCallCount,
    models: mergedModels,
    totalEstimatedCostUsd: allMetrics.reduce((sum, m) => sum + m.totalEstimatedCostUsd, 0),
  };
}

export function buildMergedScorecard(goals: MultiGoalGoal[], repoName: string, startedAt: string, worstScore: ScoreLevel): Scorecard {
  const catMap = new Map<string, CategoryScore>();
  for (const g of goals) {
    for (const cat of g.scorecard.categories) {
      const existing = catMap.get(cat.category);
      if (!existing || (SCORE_ORDER[cat.score] ?? 0) > (SCORE_ORDER[existing.score] ?? 0)) {
        catMap.set(cat.category, cat);
      }
    }
  }

  const seen = new Set<string>();
  const allRisks = goals.flatMap(g => (g.scorecard.topRisks ?? [])).filter(r => {
    if (!r.findingId || seen.has(r.findingId)) return false;
    seen.add(r.findingId);
    return true;
  }).sort((a, b) => (SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0));

  return {
    repoName,
    goalType: 'all',
    generatedAt: startedAt,
    overallScore: worstScore,
    categories: [...catMap.values()],
    topRisks: allRisks,
    metadata: {
      repoName,
      analysisDate: startedAt,
      agentVersion: '',
      goalType: 'all',
      detectedPlatform: '',
      toolCallsUsed: 0,
      webSearchesUsed: 0,
      urlFetchesUsed: 0,
      documentationSources: [],
    },
    findings: goals.flatMap(g => g.findings ?? []),
  };
}

export function computeWorstScore(goals: MultiGoalGoal[]): ScoreLevel {
  return goals.reduce<ScoreLevel>((worst, g) => {
    const s = g.scorecard.overallScore;
    return (SCORE_ORDER[s] ?? 0) > (SCORE_ORDER[worst] ?? 0) ? s : worst;
  }, 'green');
}

// ─── Adapter: MultiGoalData → MultiRunData ──────────────────────

export function toMultiRunData(data: MultiGoalData): MultiRunData {
  const goalsWithFindings: MultiGoalGoal[] = data.goals.map(g => ({
    ...g,
    findings: g.findings?.length > 0 ? normalizeFindings(g.findings) : [],
  }));

  const events = data.events ?? [];
  const toolCallCount = data.toolCallCount ?? events.filter(e => e.type === 'tool_call').length;
  const worstScore = computeWorstScore(goalsWithFindings);
  const metrics = aggregateMetrics(goalsWithFindings, toolCallCount, data.startedAt, data.completedAt);
  const mergedScorecard = buildMergedScorecard(goalsWithFindings, data.repoName, data.startedAt, worstScore);
  const findings = data.findings?.length > 0 ? normalizeFindings(data.findings) : [];

  // Prefer pre-computed rundata; fall back to transforming raw events
  const runData = data.rundata
    ? data.rundata
    : events.length > 0
      ? transformRunData(events, {
          scorecard: data.goals[0]?.scorecard,
          metrics: data.goals[0]?.metrics,
          terminationReason: 'completed',
          briefMarkdown: '',
          outputPaths: [],
          state: { findings: data.findings },
        })
      : undefined;

  return {
    parentId: data.parentId,
    repoName: data.repoName,
    repoUrl: data.repoUrl,
    goals: goalsWithFindings,
    events,
    passSummary: data.passSummary,
    findings,
    totalFindings: data.totalFindings,
    metrics,
    worstScore,
    mergedScorecard,
    runData,
  };
}
