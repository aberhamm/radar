# CI health check rules

## Purpose

Quick, shallow health check for CI integration. Produces a pass/fail result, not a narrative brief.

## Categories (3 only)

- **Dependencies** — critical version gaps (2+ major versions behind), deprecated packages, known vulnerable versions
- **Security** — exposed secrets (hardcoded API keys, tokens in source), missing .gitignore entries (.env, credentials), NEXT_PUBLIC_ leaks of sensitive values
- **Configuration** — missing required config files (tsconfig, next.config), incomplete .env.example, build scripts missing from package.json

## Investigation approach

- Stay shallow. Read package.json, check .gitignore, scan for secrets patterns, verify config files exist.
- Do not investigate architecture, CMS integration, preview/editing, or deployment patterns.
- Stay under 15 tool calls. If you hit 10 and have enough evidence, stop investigating and record findings.

## Scoring

- **Red**: any critical or high finding in any category
- **Yellow**: only medium findings
- **Green**: only low or info findings
- **Overall pass/fail**: any red category = FAIL, otherwise PASS

## Output

- No narrative sections required. Only scorecard + findings.
- When calling assemble_output, provide empty sections `{}`. The scorecard and findings are the output.
- Every finding still needs evidence: file path, line number, code snippet.

## Evidence standards

Same as core.md — every finding needs:
- File path (relative to repo root)
- Line number (when applicable)
- Code snippet showing the issue
- Description explaining why it matters
