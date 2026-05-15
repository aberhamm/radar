# Platform Onboarding Guide

How to add support for a new platform, framework, or platform version to Radar.

## When to use this

Any time the tool encounters a codebase it can't meaningfully assess because the rules, detection, or tooling don't cover that platform. Common triggers:

- Client engagement on a platform we don't support yet
- New major version of an existing platform with different patterns
- A team member asks "can the tool handle X?"

## What "platform support" means

Full platform support has five layers. Not all are required for every platform, but this is the complete picture:

| Layer | What it is | Example |
|-------|-----------|---------|
| Detection | Tool recognizes the platform from project files | `@sitecore-jss/*` in package.json → Sitecore JSS |
| Specialist checklist | Markdown rules the agent follows during investigation | `src/rules/specialists/cms-sitecore.md` |
| Reference files | Static knowledge the agent loads on demand | `src/references/sitecore/xm-cloud-architecture.md` |
| Tracked packages | Version comparison against npm/NuGet registry | `TRACKED_PACKAGES` in `queryNpmVersions.ts` |
| Custom tools | New tools for data sources existing tools can't read | XML config parser, serialized item reader |

## Step-by-step process

### 1. Identify detection signals

What files or packages indicate this platform? Be specific about version variants.

Questions to answer:
- What's in `package.json` (npm) or `.csproj` (NuGet) that's unique to this platform?
- Are there config files that only exist for this platform? (e.g., `xmcloud.build.json`, `next.config.ts`)
- Can you distinguish versions/variants from the same signals? (e.g., JSS 21.x = XP, JSS 22.12 = XM Cloud)

Where to implement:
- `src/tools/analysis/detectAppRoots.ts` — PLUGIN_MAP for package-based detection
- `src/tools/analysis/getSpecialistPrompts.ts` — SPECIALIST_MAPPINGS for checklist loading

### 2. Write the specialist checklist

Create `src/rules/specialists/{platform-name}.md`. This is what the agent follows during investigation.

Structure:
- Group by assessment area (e.g., "Version Compatibility," "Security," "Performance")
- Each item is an instruction the agent can act on with existing tools (read files, grep patterns, check versions)
- Include version-specific guidance inline ("If version X, check Y; if version Z, check W")
- Reference what severity to assign when a finding is recorded

Quality bar:
- Every checklist item should be verifiable from code/config (not requiring interviews or runtime access)
- Items should reference specific file paths or patterns to look for
- Avoid vague guidance ("check security") — be specific ("check for connection strings in committed config files")

### 3. Write reference files

Create `src/references/{platform}/` with topic-specific markdown files. These are loaded on demand by the agent when it needs deeper knowledge.

Good reference topics:
- Common antipatterns for the platform
- Architecture patterns and their tradeoffs
- Migration/upgrade guidance between versions
- Compatibility matrices (framework version X requires runtime version Y)

Keep each file focused on one topic. The agent loads them selectively, so smaller files mean less wasted context.

### 4. Add tracked packages

In `src/tools/dependency/queryNpmVersions.ts`, add packages to `TRACKED_PACKAGES`. For .NET platforms, this requires building a NuGet equivalent (see enhancement backlog).

Choose packages that:
- Are the primary SDK packages (not transitive dependencies)
- Have versions that matter for compatibility
- Are commonly installed in projects of this type

### 5. Add tools if needed

Only if the platform has data sources the existing tools can't read. Current tools handle:
- JSON, YAML, TypeScript, JavaScript (via file reading + pattern matching)
- package.json, tsconfig.json, .env files (dedicated parsers)
- npm registry (version lookup)

Platforms that need new tools:
- .NET projects → `.csproj` XML parser for NuGet references
- Sitecore XP → `App_Config/Include/*.config` XML parser for pipeline/settings patches
- Sitecore/Unicorn → `.yml` serialized item parser for content model
- Java/Gradle → `build.gradle` parser

Tool design rules (from CLAUDE.md):
- Tools are deterministic. They return facts, never call an LLM, never reason.
- Typed inputs and outputs.
- Return structured data the agent can reason about.

### 6. Validate against real repos

Before considering a platform "supported," run the tool against 2-3 real repos of that type and verify:
- Detection triggers correctly
- Specialist checklist produces relevant findings
- Findings have evidence with correct file paths and line numbers
- Severity assignments are calibrated (not everything is critical)
- The agent doesn't waste budget investigating irrelevant areas

## Platform variant handling

Some platforms need variant-level support (e.g., Sitecore XP vs XM Cloud). The current architecture supports this through:

1. **Detection-level branching** — detect the variant in `detectAppRoots` and set it as a distinct plugin or metadata
2. **Separate specialist files** — one per variant (e.g., `cms-sitecore-xp.md`, `cms-sitecore-xm-cloud.md`)
3. **Shared references** — reference files can be shared across variants when the knowledge applies to both

The CLI `--platform` flag can override auto-detection when the signals are ambiguous.

## Intake process: turning client inquiries into platform support

Every client engagement that mentions a platform we don't fully cover is a signal. The process:

1. **Capture the assessment scope** — what does the client's team expect to evaluate? (e.g., Neha's Honda RFP activity list)
2. **Map against existing coverage** — which items can the tool already produce findings for? Which are gaps?
3. **Classify the gaps:**
   - Missing rules/references (knowledge gap, no code needed)
   - Missing detection (can't tell it's this platform)
   - Missing tools (can't read the data source)
   - Out of scope (human-only work: stakeholder interviews, strategy)
4. **Add TODOs for automatable gaps** — reference this doc for the implementation pattern
5. **Request repo access** — rules validated against a real codebase are 10x more useful than hypothetical ones

The goal: when the same platform comes up in the next engagement, the tool is ready.

## Checklist summary

- [ ] Detection signals identified and implemented in `detectAppRoots.ts`
- [ ] Specialist mapping added to `getSpecialistPrompts.ts`
- [ ] Specialist checklist written at `src/rules/specialists/{name}.md`
- [ ] Reference files created at `src/references/{platform}/`
- [ ] Tracked packages added (if applicable)
- [ ] Custom tools built (if needed for new data sources)
- [ ] Validated against 2-3 real repos
- [ ] This doc updated with the new platform in the "Supported platforms" section below

## Supported platforms

| Platform | Variant | Detection | Specialist | References | Tools | Validated |
|----------|---------|-----------|-----------|------------|-------|-----------|
| Sitecore JSS (XM Cloud) | `sitecore-jss` | `@sitecore-jss/*` packages | `cms-sitecore.md` | 4 files | — | Yes (xmcloud-starter-js) |
| Optimizely CMS | `optimizely-cms` | `@remkoj/optimizely-*` packages | `cms-optimizely.md` | 4 files | — | Yes (optimizely-saas-starter) |
| Next.js | `nextjs` | `next` in dependencies | `nextjs.md` | 4 files | — | Yes |
| GraphQL | `graphql` | `graphql` in dependencies | `graphql.md` | — | — | Yes |
| Tailwind CSS | `tailwind` | `tailwindcss` in dependencies | `tailwind.md` | — | — | Yes |
| Prisma | `prisma` | `prisma` in dependencies | `prisma.md` | — | — | Yes |
| Sitecore XP (.NET) | — | Not yet implemented | — | — | — | — |
| Sitecore MVC | — | Not yet implemented | — | — | — | — |
