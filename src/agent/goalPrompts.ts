import type { GoalType } from '../types/state.js';

/**
 * Goal prompt templates — the initial user message given to the agent
 * based on the selected analysis goal.
 */

const PROMPTS: Record<string, (localPath: string) => string> = {
  onboarding: (localPath) => `You have access to a repository at ${localPath}.
Produce a consultant onboarding brief for a developer joining this project for the first time.

Your consulting rules specify the required sections and quality bar.
Investigate the repository using your tools, record findings, and assemble the brief
when you have sufficient information.

Start by understanding the stack, then investigate CMS integration, preview/editing,
and configuration. Follow your platform-specific rules once you identify the CMS.`,

  audit: (localPath) => `You have access to a repository at ${localPath}.
Produce a scored architecture audit for this project.

Every category in the scorecard must have a score based on real findings with evidence.
If a category is healthy, score it green with a brief note — do not inflate findings.
If you find real issues, document them with file paths and code evidence.

Your consulting rules define the scoring criteria and required categories.`,

  migration: (localPath) => `You have access to a repository at ${localPath}.
Assess this project's migration readiness and produce a migration report.

Focus on: dependency currency, framework version, router architecture,
deprecated patterns, and migration-hostile code. Use the npm version tools
to check current versions. Consult your reference material for known
migration gotchas.

Produce a prioritized list of migration hotspots with estimated complexity.`,

  'component-map': (localPath) => `You have access to a repository at ${localPath}.
Map all components in this project: their file paths, CMS content type bindings,
client/server directives, and data fetching patterns.

Produce a structured component inventory showing how each component connects
to the CMS and the rendering pipeline.`,

  'ci-check': (localPath) => `You have access to a repository at ${localPath}.
Run a quick health check suitable for CI integration.

Focus on: dependency currency (any critical version gaps), security issues
(exposed secrets, missing .gitignore entries), and configuration completeness.
Keep investigation shallow and fast — stay under 15 tool calls.

Produce a pass/fail result with a summary of any blocking issues found.`,
};

/**
 * Build the goal-specific user prompt for the agent.
 * Includes the shared preamble about tools, npm data, web search, and budget.
 */
export function buildGoalPrompt(
  goal: GoalType,
  localPath: string,
  toolCallBudget: number,
  webSearchBudget: number,
): string {
  const goalPrompt = PROMPTS[goal];
  if (!goalPrompt) {
    throw new Error(`Unknown goal type: ${goal}`);
  }

  const preamble = `${goalPrompt(localPath)}

Begin by understanding the project structure and stack.
Then investigate according to your consulting rules.
Record findings as you go using the record_finding tool.
When you have enough information to populate every required section
of the deliverable, call the assemble_output tool.

npm version data is available via the query_npm_versions and
compare_versions tools.

You can search the web and fetch documentation using the web_search
and fetch_url tools. Use these when you find outdated dependencies,
unfamiliar SDK patterns, or version-specific issues that your
reference material doesn't cover. Prefer approved documentation
sources. Your web search budget is ${webSearchBudget} searches.

Your tool call budget is ${toolCallBudget} calls. Prioritize accordingly.`;

  return preamble;
}
