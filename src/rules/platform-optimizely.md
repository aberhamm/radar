# Optimizely-specific investigation rules

## Platform context

Optimizely SaaS (formerly Optimizely Content Cloud / CMS 12 SaaS) is a headless CMS with:
- **Content Graph** — GraphQL API for content delivery and preview (replaces Content Delivery API)
- **Visual Builder** — On-page editing experience (replaces Content Area / CMS edit mode)
- **Content types** — Defined in the CMS, consumed via GraphQL types in the frontend
- **@remkoj packages** — Community-maintained SDK ecosystem (`@remkoj/optimizely-cms-react`, `@remkoj/optimizely-cms-nextjs`, `@remkoj/optimizely-graph-client`, etc.)

## Must-investigate areas

- **Content Graph configuration**: Are preview and delivery endpoints configured separately? Is the single key vs HMAC auth distinction clear? Check for `OPTIMIZELY_GRAPH_SECRET` (preview) vs `OPTIMIZELY_GRAPH_APP_KEY` (delivery). Both should be environment-driven.
- **Visual Builder / On-Page Editing integration**: Find the actual edit mode detection, preview routes, and CMS page component. Verify Next.js Draft Mode is used for preview. Look for `draftMode()` calls and `isEditMode` / `isPreviewMode` checks.
- **Component-to-content-type mapping**: How does the app resolve which React component renders which CMS content type? Is it a factory pattern via `@remkoj/optimizely-cms-react`'s `setupFactory()` or `ComponentFactory`? Is it type-safe? Is there a component dictionary with registered types?
- **@remkoj package version alignment**: All `@remkoj/optimizely-cms-*` and `@remkoj/optimizely-graph-*` packages should be the same version. Version misalignment is a common source of subtle bugs — these packages share internal protocols.
- **GraphQL codegen pipeline**: Is `@graphql-codegen` configured? Are types generated from Content Graph schema? Is the developer expected to run codegen before dev? Check for `codegen.ts` or `.graphqlrc` configuration files.
- **Cache invalidation / revalidation**: How does the app know when content has been published? Is there a webhook handler (e.g., `/api/revalidate` or `/api/content/published`)? What does it revalidate — specific paths, tags, or everything? Is `revalidateTag()` or `revalidatePath()` used?
- **Channel/site definition**: How does the app know which CMS site/channel it represents? Is this hardcoded or environment-driven via `OPTIMIZELY_CMS_URL` / `SITE_DOMAIN`?
- **Content area / block rendering**: How are content areas (rich content zones with nested blocks) rendered? Is `ContentAreaComponent` from `@remkoj/optimizely-cms-nextjs` used, or a custom implementation?
- **Image handling**: Are images served from Optimizely's CDN? Is there a custom loader for `next/image`? Check for `optimizely.com` or `cmsoptimizely.com` in image domains configuration.

## Common Optimizely issues to look for

- **Content Graph queries using published endpoint when they should use draft for preview** — preview will show stale content. The preview endpoint requires `OPTIMIZELY_GRAPH_SECRET`; delivery uses `OPTIMIZELY_GRAPH_APP_KEY`. Record as HIGH.
- **Missing Visual Builder configuration for on-page editing** — editing will be broken or unavailable. Look for `@remkoj/optimizely-cms-nextjs` page wrapper and edit mode detection. Record as HIGH if missing.
- **Content type mappings that are fragile or hardcoded** rather than discoverable via the factory pattern from `@remkoj/optimizely-cms-react`. Hardcoded switch statements break when content types are added in the CMS.
- **Mixed use of REST and Graph APIs without clear boundary** — indicates architectural confusion. REST Content Delivery API is legacy; Content Graph (GraphQL) is the current approach.
- **Empty component dictionary** — no CMS content types scaffolded yet (`getFactory()` returns factory with zero registrations). Record as info but flag as a major first task.
- **Committed .env file with real credentials** — if .env contains actual `OPTIMIZELY_GRAPH_SECRET` or `OPTIMIZELY_GRAPH_APP_KEY` values and is not gitignored. Record as CRITICAL.
- **Next.js version significantly behind** — if 1+ major versions behind, record as MEDIUM with migration impact notes. @remkoj packages often require specific Next.js versions.
- **Missing or inadequate cache invalidation** — published content won't appear until redeployment if there's no webhook handler or ISR configuration. Record as HIGH.
- **No TypeScript strict mode** — if strict is false or not configured. Record as LOW.
- **Outdated @remkoj packages** — if behind latest, check for breaking changes and record accordingly. These packages evolve rapidly.
- **Missing Draft Mode integration** — preview/edit functionality requires Next.js Draft Mode. If `draftMode()` is not called in preview routes, on-page editing won't work. Record as HIGH.
- **GraphQL queries without proper error handling** — Content Graph returns partial results on field errors. Unchecked queries can silently render incomplete pages.
- **Hardcoded locale list** — if locales are defined in code instead of fetched from Content Graph, new locales added in the CMS won't appear. Record as MEDIUM.
- **Missing `opti-image` or custom image loader** — Optimizely CDN images need dimension parameters for responsive sizing. Without a loader, images may be served at full resolution. Record as LOW.
- **No content type synchronization step in CI/CD** — if content types are defined in code (via decorators/metadata) but there's no sync step to push them to the CMS. Record as MEDIUM.

## Package ecosystem reference

Key packages to look for and their roles:

| Package | Role |
|---------|------|
| `@remkoj/optimizely-cms-react` | Component factory, content type registration, base components |
| `@remkoj/optimizely-cms-nextjs` | Next.js integration (Draft Mode, edit mode, content areas, page routing) |
| `@remkoj/optimizely-graph-client` | Content Graph GraphQL client, auth, endpoint management |
| `@remkoj/optimizely-graph-functions` | Content Graph query helpers and utilities |
| `@remkoj/optimizely-cms-api` | CMS management API client (content type sync, publishing) |
| `@remkoj/optimizely-cms-cli` | CLI for content type scaffolding and codegen |
| `@graphql-codegen/cli` | GraphQL type generation from Content Graph schema |

## Environment variables to expect

| Variable | Purpose | Required |
|----------|---------|----------|
| `OPTIMIZELY_GRAPH_APP_KEY` | Content Graph delivery (published content) | Yes |
| `OPTIMIZELY_GRAPH_SECRET` | Content Graph preview (draft content) | For preview |
| `OPTIMIZELY_GRAPH_GATEWAY` | Content Graph endpoint override | Rarely |
| `OPTIMIZELY_CMS_URL` | CMS instance URL for management API | For sync/editing |
| `OPTIMIZELY_PUBLISH_TOKEN` | Webhook validation token | For cache invalidation |
| `SITE_DOMAIN` | Frontend domain for canonical URLs | Usually |

## When to search documentation

- If @remkoj packages are more than 2 minor versions behind, fetch the changelog from GitHub (`remkoj/optimizely-dxp-clients`) to identify breaking changes and new features.
- If you find Content Graph query patterns you're unsure about, fetch the current Optimizely Content Graph documentation to verify the approach.
- If Visual Builder integration is present, check the current docs.developers.optimizely.com documentation to verify the integration matches current requirements.
- If the project uses the CMS CLI for content type sync, check the `@remkoj/optimizely-cms-cli` README for the current sync workflow.
