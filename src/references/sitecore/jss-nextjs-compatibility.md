# JSS + Next.js Version Compatibility

## Compatibility matrix

| JSS SDK Version | Supported Next.js | Node.js | Notes |
|----------------|-------------------|---------|-------|
| 21.x           | 12.x, 13.x       | 18, 20  | Pages Router only. No App Router support. |
| 22.0 - 22.1    | 13.x, 14.x       | 18, 20  | Added initial App Router support in 22.1. Pages Router still primary. |
| 22.2 - 22.7    | 14.x, 15.x       | 18, 20  | Full App Router support. React 18+ required. |
| 22.8 - 22.11   | 14.x, 15.x       | 20, 22  | Component-level data fetching, middleware extensibility, Component Library support. |
| 22.12+         | 16.x              | 24      | Next.js 16 required (breaking). ESLint v9 flat config. React 19. |

Latest stable: **22.12.3** (May 2025) — targets Next.js 16.2.

## Key version boundaries

- **JSS 21 → 22**: Major breaking change. Editing integration API changed completely. `EditingComponentPlaceholder` replaced older editing mode. Layout Service client refactored.
- **JSS 22.0 → 22.1**: Added `nextjs-sxa` initializer support. Minor breaking changes in middleware configuration.
- **JSS 22.2 → 22.7**: Iterative improvements. Full App Router support solidified. React 18 required.
- **JSS 22.8 → 22.11**: Component-level data fetching for 404/500 pages. RedirectsMiddleware and PersonalizeMiddleware gained extensibility methods (`getRedirects`, `processPersonalizationRequest`, `getPersonalizeInfo`). Component Library in XM Cloud support added. No Next.js major version bump.
- **JSS 22.12**: Breaking upgrade — Next.js 16, Node.js 24, ESLint v9 flat config. Default `disableSuspense` set to `true` on React component placeholders (Suspense can be re-enabled manually). Redirect middleware preserves `basePath` configuration.
- **Next.js 13 → 14**: Server Actions stable, Turbopack dev support. JSS 22.0+ handles this cleanly.
- **Next.js 14 → 15**: React 19 by default, async request APIs (cookies/headers), changed caching defaults. JSS 22.2+ required for full compatibility.
- **Next.js 15 → 16**: React 19 stable, Turbopack default bundler, `after()` API stable, Forms component, enhanced caching model. JSS 22.12+ required.

## Common compatibility issues we see

- Projects on JSS 21 trying to use App Router patterns (won't work, JSS 21 only supports Pages Router)
- Projects on JSS 22.0 with Next.js 15 (editing middleware breaks due to async API changes)
- Projects on JSS 22.2–22.11 attempting Next.js 16 (peer dependency mismatch, middleware changes break)
- Mixed JSS and non-JSS pages in the same project creating routing conflicts
- `@sitecore-jss/sitecore-jss-nextjs` version not matching other `@sitecore-jss/*` packages
- Projects upgrading to JSS 22.12 without also upgrading Node.js to 24 (build failures)
- ESLint configs breaking after 22.12 upgrade due to flat config migration (`.eslintrc` → `eslint.config.js`)

## Key migration considerations

### Upgrading to JSS 22.12 (current recommended target)

1. **Node.js 24 required** — Ensure CI/CD pipelines, Docker images, and local tooling all run Node 24+.
2. **Next.js 16 required** — This is not backwards-compatible; you cannot stay on Next.js 14/15 with JSS 22.12.
3. **ESLint v9 flat config** — Migrate `.eslintrc.*` to `eslint.config.js`. Remove deprecated plugins or find flat-config-compatible alternatives.
4. **Suspense default changed** — `disableSuspense` now defaults to `true` on Placeholder components. If you rely on Suspense boundaries for streaming, explicitly set `disableSuspense={false}`.
5. **React 19** — Verify all third-party component libraries support React 19. `forwardRef` removal and `use()` hook changes may affect custom components.

### For projects still on JSS 21.x

The recommended path is a full migration to 22.12 (skip intermediate versions). Key steps:
- Rewrite editing integration to use new editing APIs
- Migrate from Pages Router to App Router (or maintain parallel during transition)
- Update all `@sitecore-jss/*` packages simultaneously — never mix 21.x and 22.x packages
- Budget significant effort: JSS 21 → 22.12 is effectively a replatform of the rendering host

### Version lock guidance

| If you're on… | Recommended target | Effort |
|---------------|-------------------|--------|
| JSS 21.x + Next 12/13 | JSS 22.12 + Next 16 | High (replatform) |
| JSS 22.0–22.7 + Next 14/15 | JSS 22.12 + Next 16 | Medium (breaking deps) |
| JSS 22.8–22.11 + Next 15 | JSS 22.12 + Next 16 | Low-Medium (Node + ESLint + Next bump) |
| JSS 22.12 + Next 16 | Current | — |
