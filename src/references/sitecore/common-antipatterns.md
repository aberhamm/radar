# Sitecore Common Anti-patterns

## Architecture anti-patterns

### Hardcoded site context
**Pattern**: Site name or language hardcoded in components or data fetching instead of using the site resolver.
**Impact**: Breaks multisite support. New sites require code changes.
**Fix**: Use `SiteResolver` middleware and pass site context through the rendering pipeline.

### Mixed Layout Service modes
**Pattern**: Some pages use REST Layout Service, others use GraphQL.
**Impact**: Inconsistent caching behavior, harder to debug, double the API surface to maintain.
**Fix**: Pick one. GraphQL is preferred for XM Cloud (required for Experience Edge).

### Component factory bypass
**Pattern**: Components imported directly instead of going through the component factory/builder.
**Impact**: Breaks Sitecore rendering registration. Components won't appear in the editing UI.
**Fix**: All CMS-rendered components must be registered through the component factory.

## Configuration anti-patterns

### NEXT_PUBLIC_ leaking server secrets
**Pattern**: CMS API keys or editing secrets exposed via `NEXT_PUBLIC_*` environment variables.
**Impact**: Secrets visible in client-side JavaScript. Security vulnerability.
**Fix**: Server-only secrets must use server-side env vars, not `NEXT_PUBLIC_`.

### Missing .env documentation
**Pattern**: No `.env.example` or `.env.local.example` file documenting required variables.
**Impact**: New developers can't set up the project without tribal knowledge.
**Fix**: Maintain a `.env.example` with all required variables (names only, no values).

### Pinned to specific Sitecore instance
**Pattern**: URLs, API keys, or instance-specific config hardcoded in source.
**Impact**: Can't switch environments without code changes. Blocks CI/CD.
**Fix**: All instance-specific values should come from environment variables.

## Dependency anti-patterns

### Mismatched JSS package versions
**Pattern**: Different `@sitecore-jss/*` packages at different versions.
**Impact**: Internal API contracts break. Subtle runtime errors.
**Fix**: All `@sitecore-jss/*` packages should be the same version.

### Stale JSS with new Next.js
**Pattern**: Upgrading Next.js without upgrading JSS SDK.
**Impact**: Editing breaks, middleware incompatibilities, SSR errors.
**Fix**: Check the compatibility matrix before upgrading either independently.
