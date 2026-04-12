/**
 * Per-goal brief writing via direct Portkey fetch.
 * Calls the OpenAI-compatible /chat/completions endpoint directly,
 * bypassing Pi Agent (no tool calling needed for brief writing).
 */

import { getProviderConfig, type ProviderConfig } from '../config/providerConfig.js';
import { withRetry } from '../agent/retry.js';
import type { GoalType } from '../types/state.js';
import type { Finding } from '../types/findings.js';
import type { Scorecard } from '../types/output.js';

export interface BriefWriteResult {
  goal: GoalType;
  sections: Record<string, string>;
  error?: string;
}

const GOAL_SECTIONS: Record<string, string[]> = {
  onboarding: ['project_overview', 'stack_and_architecture', 'key_files', 'cms_integration', 'preview_editing', 'configuration_environment', 'local_setup', 'first_week_reading', 'client_questions', 'next_actions'],
  audit: ['project_overview', 'stack_and_architecture', 'key_files', 'cms_integration', 'configuration_environment', 'migration_hotspots', 'next_actions'],
  migration: ['project_overview', 'stack_and_architecture', 'migration_hotspots', 'migration_order', 'next_actions'],
  'component-map': ['project_overview', 'component_inventory'],
  'ci-check': ['project_overview', 'next_actions'],
  'security-review': ['project_overview', 'stack_and_architecture', 'configuration_environment', 'next_actions'],
  nextjs: ['project_overview', 'stack_and_architecture', 'configuration_environment', 'next_actions'],
  accessibility: ['project_overview', 'stack_and_architecture', 'next_actions'],
};

export async function writeBriefSections(
  goal: GoalType,
  findings: Finding[],
  scorecard: Scorecard,
  config?: Partial<ProviderConfig>,
): Promise<BriefWriteResult> {
  const prompt = buildBriefPrompt(goal, findings, scorecard);

  try {
    const providerCfg = getProviderConfig(config);
    const requestBody = JSON.stringify({
      model: providerCfg.fastModelId,
      messages: [
        {
          role: 'system',
          content: 'You are a senior technical consultant writing a brief report. Output each section with a markdown ## heading followed by content. Use the section keys exactly as specified.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 4096,
      temperature: 0.3,
    });

    const json = await withRetry(
      async () => {
        const response = await fetch(`${providerCfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: providerCfg.headers,
          body: requestBody,
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'unknown');
          const err = new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
          (err as Error & { status: number }).status = response.status;
          throw err;
        }
        return (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
      },
      {
        onRetry: (attempt, err, delayMs) => {
          console.warn(`[brief:${goal}] Retry ${attempt} after ${delayMs}ms: ${err.message.slice(0, 100)}`);
        },
      },
    );

    const content = json.choices?.[0]?.message?.content ?? '';
    const sections = parseSections(content);
    return { goal, sections };
  } catch (err) {
    return { goal, sections: {}, error: (err as Error).message };
  }
}

export async function writeAllBriefs(
  goals: GoalType[],
  findings: Finding[],
  scorecards: Map<GoalType, Scorecard>,
  config?: Partial<ProviderConfig>,
): Promise<BriefWriteResult[]> {
  return Promise.all(
    goals.map((goal) => {
      const scorecard = scorecards.get(goal);
      if (!scorecard)
        return Promise.resolve({
          goal,
          sections: {},
          error: 'No scorecard',
        } as BriefWriteResult);
      return writeBriefSections(goal, findings, scorecard, config);
    }),
  );
}

function buildBriefPrompt(
  goal: GoalType,
  findings: Finding[],
  scorecard: Scorecard,
): string {
  const sectionKeys = GOAL_SECTIONS[goal] ?? GOAL_SECTIONS.onboarding;

  const findingsSummary = findings
    .filter((f) => (f.confidence ?? 7) > 2)
    .map(
      (f) =>
        `- [${f.severity}] ${f.title} (${f.category}): ${f.description.slice(0, 150)}`,
    )
    .join('\n');

  const scorecardSummary = scorecard.categories
    .map((c) => `- ${c.category}: ${c.score} (${c.findings.length} findings)`)
    .join('\n');

  return `Write the narrative sections for a "${goal}" brief about "${scorecard.repoName}".

Overall score: ${scorecard.overallScore}

Scorecard:
${scorecardSummary}

Findings:
${findingsSummary}

Write these sections (use exactly these keys as ## headings):
${sectionKeys.map((k) => `- ${k}`).join('\n')}

For each section, write 2-4 paragraphs of consultant-quality narrative. Reference specific findings by title. Be opinionated and actionable.`;
}

export function parseSections(content: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = content.split('\n');
  let currentKey = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^##\s+(.+)/);
    if (match) {
      if (currentKey && currentLines.length > 0) {
        sections[currentKey] = currentLines.join('\n').trim();
      }
      currentKey = match[1]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }
  if (currentKey && currentLines.length > 0) {
    sections[currentKey] = currentLines.join('\n').trim();
  }

  return sections;
}
