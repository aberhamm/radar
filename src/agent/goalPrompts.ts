import type { GoalType } from '../types/state.js';

/**
 * Goal prompt templates — the initial user message given to the agent
 * based on the selected analysis goal.
 */

const PROMPTS: Record<string, (localPath: string) => string> = {
  onboarding: (localPath) => `You have access to a repository at ${localPath}.
Produce a consultant onboarding brief for a developer joining this project for the first time.

You are a senior consultant, not a linter. Your brief should demonstrate deep understanding
of the codebase — not just list files and versions. Explain architectural decisions,
flag patterns that will cause pain, and provide opinionated recommendations.

Your consulting rules specify the required sections and quality bar.
Investigate the repository using your tools, record findings as you go, and assemble the brief
when you have sufficient information.

Start by understanding the stack, then investigate CMS integration, preview/editing,
security, configuration, dependencies, and architecture. Follow your platform-specific
rules once you identify the CMS.

IMPORTANT: Record findings throughout your investigation, not just at the end.
After every 3-4 investigation steps, call record_finding for what you've observed.
You must record at least 8 findings across all scorecard categories before assembling output.
Every scorecard category must have at least one finding — even if it's info-level
documenting what you verified and why it's healthy.`,

  audit: (localPath) => `You have access to a repository at ${localPath}.
Produce a scored architecture audit for this project.

Every category in the scorecard must have a score based on real findings with evidence.
If a category is healthy, score it green with a finding that documents what you verified.
If you find real issues, document them with file paths and code evidence.

Your consulting rules define the scoring criteria and required categories.
You must record at least 8 findings. Every category needs at least one.`,

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

  'security-review': (localPath) => `You have access to a repository at ${localPath}.
Conduct a security-focused code review of this project.

You are a security consultant, not a linter. Your review should identify real
security vulnerabilities, misconfigurations, and risks — with evidence from the code.

Investigate all six security scorecard categories: secrets & environment,
authentication & authorization, security headers, dependency security,
input validation, and data exposure. Follow your security review rules.

After every 2-3 tool calls, explain WHAT YOU FOUND — concrete facts from the results.
Never just announce what you're about to do ("Let me check X") or label without explaining
("This is critical"). State what the data shows and what security implications it has.

IMPORTANT: Record findings throughout your investigation.
You must record at least 6 findings — one per security category minimum.
Every scorecard category must have at least one finding.`,

  nextjs: (localPath) => `You have access to a repository at ${localPath}.
Conduct a Next.js-focused architecture audit of this project.

You are a Next.js specialist, not a generic linter. Your audit should assess
framework usage patterns, rendering strategy, data fetching architecture,
and performance readiness — with evidence from the code.

This audit is framework-focused, not CMS-focused. Investigate router architecture,
data fetching patterns, rendering strategy, performance optimization, configuration
quality, dependency currency, and TypeScript/DX patterns. Follow your Next.js audit rules.

After every 2-3 tool calls, explain WHAT YOU FOUND — concrete facts from the results.
Never just announce what you're about to do ("Let me check X") or label without explaining
("This is critical"). State what the data shows and why it matters.

IMPORTANT: Record findings throughout your investigation.
You must record at least 8 findings across all scorecard categories.
Every scorecard category must have at least one finding.`,

  universal: (localPath) => `You have access to a repository at ${localPath}.
Conduct a comprehensive multi-goal analysis of this codebase.

You are a senior consultant, not a linter. Your investigation should demonstrate deep
understanding of this codebase — not just list files and versions. After every few tool calls,
explain what the results show and why it matters. Describe concrete facts from the data, not
what you're about to do next.

Your findings will feed into 8 different goal scorecards: onboarding, audit, migration,
component-map, ci-check, security-review, Next.js, and accessibility.

Investigate all 9 core categories: stack, cms-integration, preview-editing, security,
configuration, architecture, dependencies, deployment, and nextjs patterns.
Follow your universal investigation rules.

INVESTIGATION STYLE:
- After each batch of 2-3 tool calls, explain WHAT YOU FOUND — concrete facts from the results.
- NEVER write reasoning that only announces what you're about to do ("Let me check X") or
  labels something without explaining it ("This is a critical finding").
- GOOD: "The pom.xml targets AEM SDK 2023.9 which is 14 months behind current. The uber-jar
  dependency pins to a specific patch version rather than using the SDK BOM, which means
  security patches require manual version bumps across all modules."
- Connect findings across categories — a dependency gap may also be a security exposure.

IMPORTANT: Record findings throughout your investigation.
You must record at least 15 findings across all 9 core categories.
Every required category must have at least one finding.
After this pass, specialist agents will add depth for niche categories
(routing, data-fetching, performance, accessibility, forms, aria).`,

  'audit-generic': (localPath) => `You have access to a repository at ${localPath}.
Produce a scored architecture audit for this project.

This project may use ANY technology stack. Do not assume it uses a CMS, Next.js, or any
specific framework. Start by identifying the stack from package manifests and project structure,
then investigate accordingly.

Every category in the scorecard must have a score based on real findings with evidence.
If a category is healthy, score it green with a finding that documents what you verified.
If you find real issues, document them with file paths and code evidence.

Your consulting rules define the scoring criteria and required categories.
You must record at least 8 findings. Every category needs at least one.`,

  accessibility: (localPath) => `You have access to a repository at ${localPath}.
Conduct a WCAG 2.1 AA accessibility audit of this project's codebase.

You are an accessibility specialist reviewing code for patterns that will produce
accessibility failures at runtime. This is a code audit — you are looking at component
patterns, ARIA usage, semantic HTML, keyboard handling, and form accessibility.

Investigate all six scorecard categories: images & media, semantic structure,
keyboard & focus, forms & inputs, color & contrast, and dynamic content.
Follow your accessibility audit rules.

After every 2-3 tool calls, explain WHAT YOU FOUND — concrete facts from the results.
Never just announce what you're about to do ("Let me check X") or label without explaining
("This is critical"). State what the data shows and what WCAG criteria are at risk.

Frame findings in terms of WCAG criteria and compliance risk, not just best practice.
Accessibility is a legal requirement in many jurisdictions.

IMPORTANT: Record findings throughout your investigation.
You must record at least 8 findings across all scorecard categories.
Every scorecard category must have at least one finding.`,
};

const CATEGORY_COVERAGE: Partial<Record<GoalType | 'universal', string>> = {
  'security-review': 'security, architecture, configuration, dependencies',
  'audit-generic': 'stack, security, configuration, architecture, dependencies, deployment',
  nextjs: 'routing, architecture, data-fetching, nextjs, stack, performance, configuration, dependencies',
  accessibility: 'accessibility, architecture, forms, aria',
  universal: 'stack, cms-integration, preview-editing, security, configuration, architecture, dependencies, deployment, nextjs',
};

function getCategoryCoverageList(goal: GoalType): string {
  return CATEGORY_COVERAGE[goal] ?? 'stack, cms-integration, preview-editing, security, configuration, architecture, dependencies, deployment, routing';
}

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
Call detect_app_roots early to identify frameworks, versions, and plugins.
Then call get_specialist_prompts with those results to get targeted investigation checklists for the detected stack.
Follow the specialist checklists alongside your standard consulting rules — they ensure deep, framework-specific coverage.
Then investigate according to your consulting rules — check every category.
Record findings as you go using the record_finding tool. Call it once per finding — you can pass multiple findings in one call if needed, but do not batch all findings at the end.

BUDGET MANAGEMENT:
- Your tool call budget is ${toolCallBudget} calls total.
- Spend the first 60% investigating (read files, analyze patterns, check dependencies).
- Spend the next 25% recording findings (minimum 8 across all categories).
- Spend the final 15% assembling the brief (assemble_output with all required sections).
- When you call assemble_output, provide detailed written content for every required section.

MODEL SWITCHING:
- When you have gathered enough evidence and are ready to start writing findings, call switch_to_fast_model ONCE.
- This switches to a cheaper, faster model for the writing phase (recording findings + assembling output).
- Call it AFTER your last investigation tool call and BEFORE your first record_finding call.
- Do not call it too early — finish all investigation first. Do not skip it — it saves cost.

CONFIDENCE CALIBRATION:
When recording findings, set the confidence field (1-10):
- 9-10: You read the code directly and confirmed the issue exists.
- 7-8: Strong pattern match — multiple indicators point to this, but you didn't verify every code path.
- 5-6: Likely based on indirect evidence — flag it, but note it needs manual confirmation.
- 3-4: Speculative — you suspect this based on limited evidence. These go to an appendix.
- 1-2: Not enough evidence — don't record these.
Set confidence based on how much evidence you actually gathered, not how severe the issue is.
A critical security issue you haven't confirmed in code should be confidence 5-6, not 9-10.

CATEGORY COVERAGE — you MUST record at least one finding in each of these scorecard categories:
  ${getCategoryCoverageList(goal)}
Even if a category is healthy, record an info-level finding documenting what you verified.
Before calling assemble_output, check that every category above has at least one finding.

TOOL PATH ARGUMENTS:
- Always pass RELATIVE paths from the repo root (e.g. "src/components", "package.json").
- Never pass absolute filesystem paths (e.g. "C:\\projects\\..." or "/home/...").
- Use "." to refer to the repo root itself.

npm version data is available via the query_npm_versions and
compare_versions tools.

You can search the web and fetch documentation using the web_search
and fetch_url tools. Use these when you find outdated dependencies,
unfamiliar SDK patterns, or version-specific issues that your
reference material doesn't cover. Prefer approved documentation
sources. Your web search budget is ${webSearchBudget} searches.

DOCUMENTATION URLS — use fetch_url to check these when relevant:
- Next.js upgrade guide: https://nextjs.org/docs/app/building-your-application/upgrading
- Next.js App Router docs: https://nextjs.org/docs/app
- Next.js security headers: https://nextjs.org/docs/app/building-your-application/configuring/headers
- Sitecore JSS changelog: https://github.com/Sitecore/jss/blob/main/CHANGELOG.md
- Sitecore JSS migration: https://github.com/Sitecore/jss/blob/main/docs/upgrades/22.0.md
- Sitecore XM Cloud starter: https://github.com/Sitecore/xmcloud-starter-js/blob/main/package.json
- Optimizely CMS docs: https://docs.developers.optimizely.com/content-management-system
- Optimizely Graph docs: https://docs.developers.optimizely.com/digital-experience-platform/v1.4.0-optimizely-graph/docs
- Optimizely starter deps: https://github.com/remkoj/optimizely-saas-starter/blob/main/package.json
- React Server Components: https://react.dev/reference/rsc/server-components
Note: GitHub blob URLs are automatically converted to raw content for cleaner results.
Fetch documentation EARLY in investigation when you identify the CMS platform or find
outdated dependencies. Don't wait until the end — fetched docs should inform your findings.`;

  return preamble;
}
