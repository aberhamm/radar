# Optimizely Common Anti-patterns

## Architecture anti-patterns

### Hardcoded content type mappings
**Pattern**: Component-to-content-type mapping defined as a static object that must be manually updated.
**Impact**: New content types in the CMS require a code deployment. Editors can't add new component types without developer involvement.
**Fix**: Use a discoverable mapping pattern (code generation from Content Graph schema or convention-based file structure).

### No separation between preview and published data
**Pattern**: Same fetching logic and endpoint used for both preview and production.
**Impact**: Either editors see stale data (published endpoint for preview) or production shows draft content (draft endpoint for production).
**Fix**: Switch endpoints based on preview mode detection. Cache published, never cache draft.

### Monolithic page component
**Pattern**: A single page component that handles all rendering logic with large switch statements.
**Impact**: Hard to maintain, test, and debug. Bundle size grows with every content type.
**Fix**: Use dynamic imports and a component registry pattern.

## Configuration anti-patterns

### Graph secret in client bundle
**Pattern**: `NEXT_PUBLIC_OPTIMIZELY_GRAPH_SECRET` or similar.
**Impact**: Anyone can query draft content, potentially seeing unpublished or sensitive information.
**Fix**: Graph secret must only be used server-side. Use a server action or API route for preview queries.

### Missing environment documentation
**Pattern**: No `.env.example` documenting required Optimizely variables.
**Impact**: Onboarding friction. New developers don't know which keys are needed.
**Fix**: Document all required environment variables with descriptions.

## Dependency anti-patterns

### Mixed @remkoj versions
**Pattern**: Different `@remkoj/optimizely-*` packages at different versions.
**Impact**: Internal API contracts break. Type mismatches, runtime errors.
**Fix**: Keep all @remkoj packages at the same version. Upgrade them together.

### Vendored Graph queries
**Pattern**: Raw GraphQL queries copied and maintained by hand instead of generated.
**Impact**: Queries drift from the schema. No type safety. Breaking changes not caught at build time.
**Fix**: Use `@remkoj/optimizely-graph-functions` for typed, generated queries.
