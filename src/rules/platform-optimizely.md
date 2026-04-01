# Optimizely-specific investigation rules

## Must-investigate areas

- **Content Graph configuration**: Are preview and delivery endpoints configured separately? Is the single key vs HMAC auth distinction clear?
- **Visual Builder / On-Page Editing integration**: Find the actual edit mode detection, preview routes, and CMS page component. Verify Draft Mode is used.
- **Component-to-content-type mapping**: How does the app resolve which React component renders which CMS content type? Is it a factory pattern? Is it type-safe?
- **@remkoj package version alignment**: All @remkoj/optimizely-cms-* packages should be the same version. Version misalignment is a common source of subtle bugs.
- **GraphQL codegen pipeline**: Is codegen configured? Are types generated? Is the developer expected to run codegen before dev?
- **Cache invalidation**: How does the app know when content has been published? Is there a webhook handler? What does it revalidate?
- **Channel/site definition**: How does the app know which CMS site it represents? Is this hardcoded or environment-driven?

## Common Optimizely issues to look for

- **Content Graph queries using published endpoint when they should use draft for preview** — preview will show stale content. Record as HIGH.
- **Missing Visual Builder configuration for on-page editing** — editing will be broken or unavailable. Record as HIGH if missing.
- **Content type mappings that are fragile or hardcoded** rather than discoverable via the factory pattern.
- **Mixed use of REST and Graph APIs without clear boundary** — indicates architectural confusion.
- **Empty component dictionary** — no CMS content types scaffolded yet. Record as info but flag as a major first task.
- **Committed .env file with real credentials** — if .env contains actual API keys and is not gitignored. Record as CRITICAL.
- **Next.js version significantly behind** — if 1+ major versions behind, record as MEDIUM with migration impact notes.
- **Missing or inadequate cache invalidation** — published content won't appear until redeployment. Record as HIGH.
- **No TypeScript strict mode** — if strict is false or not configured. Record as LOW.
- **Outdated @remkoj packages** — if behind latest, check for breaking changes and record accordingly.

## When to search documentation

- If @remkoj packages are more than 2 minor versions behind, fetch the changelog from GitHub to identify breaking changes and new features.
- If you find Content Graph query patterns you're unsure about, fetch the current Optimizely Content Graph documentation to verify the approach.
- If Visual Builder integration is present, check the current docs.developers.optimizely.com documentation to verify the integration matches current requirements.
