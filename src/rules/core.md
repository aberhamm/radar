# Core investigation rules

## Starting an investigation

- Always begin by reading package.json to identify the stack.
- Always list the top-level directory structure to understand the project layout.
- Identify the CMS platform early — this shapes everything else you investigate.
- If you detect a monorepo, identify which workspace contains the main application before going deeper.

## Investigation priorities

- Preview and editing mode implementation is the #1 source of client escalations. Always investigate this thoroughly. Find the actual code paths, not just config.
- CMS/front-end boundaries are the #1 source of architectural confusion for new consultants. Always explain where CMS data enters the rendering layer.
- Secret and environment variable hygiene is a common audit finding. Always check for NEXT_PUBLIC_ leaks and missing .env documentation.

## Depth calibration

- If the project structure is clean and conventional, you can move faster.
- If you find non-standard patterns, custom abstractions, or unexpected architecture, slow down and investigate thoroughly.
- If something looks wrong or surprising, verify it with a second tool call before recording a finding.
- Don't investigate node_modules, build output, or generated files.

## Using web search and documentation

- When you find a significantly outdated core dependency (1+ major versions behind), search for the official migration guide or changelog for the versions between installed and latest. Use this to identify specific breaking changes relevant to this codebase.
- When you encounter an SDK pattern or API you don't have reference material for, fetch the official documentation before making an assessment.
- When you find a combination of package versions that might have compatibility issues, search for known issues.
- Prefer approved documentation domains over generic search results.
- Fetch documentation early in the investigation so it can inform subsequent tool calls. Don't wait until the end.
- Summarize what you learn from documentation in your findings — don't just link to it.
- Do not use web search for things you already know or that are covered by the static reference files.

## When to stop

- You have enough to populate every required section of the deliverable.
- You have investigated all high-priority areas identified in the rules.
- Additional tool calls would not change the severity or content of your findings.
- You are approaching your tool call budget limit — prioritize output assembly.
