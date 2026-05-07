# Optimizely CMS SDK Compatibility (May 2026)

## SDK landscape: two ecosystems

There are now **two** SDK options for Optimizely SaaS CMS + Next.js frontends:

| SDK | Maintainer | Status | Repository |
|-----|-----------|--------|-----------|
| `@remkoj/optimizely-cms-*` (v5.x stable, v6.x RC) | Remko Jantzen (community) | Production-ready, widely adopted | `remkoj/optimizely-dxp-clients` |
| `@optimizely/cms-sdk` (v2.0) | Optimizely (official) | GA as of May 2026, React 19 only | `episerver/content-js-sdk` |

Most existing projects use the @remkoj packages. The official SDK is new (GA Feb 2026, v2.0 May 2026) and targets greenfield React 19 projects.

## @remkoj packages (community SDK)

### Key packages

| Package | Purpose |
|---------|---------|
| `@remkoj/optimizely-cms-react` | React components, Visual Builder integration, edit mode |
| `@remkoj/optimizely-cms-nextjs` | Next.js routing, middleware, page rendering |
| `@remkoj/optimizely-cms-api` | Integration API client (CMS Preview API v3) |
| `@remkoj/optimizely-cms-cli` | Code generation, style push, type push |
| `@remkoj/optimizely-graph-client` | Content Graph client |
| `@remkoj/optimizely-graph-functions` | Typed GraphQL code generation |

### Version matrix

| Version | Next.js | React | Status | Notes |
|---------|---------|-------|--------|-------|
| **5.3.x** (latest stable) | `^14` | `^18` | Production | Current recommended for most projects |
| **6.0.0-rc.1** (pre-release) | `^16` | `^19` | RC (Mar 2026) | Next.js 16 + React 19 only |

### Compatibility details (v5.3.x)

Peer dependencies for `@remkoj/optimizely-cms-nextjs@5.3.1`:
- `next`: ^14 (works with Next.js 14.x and 15.x via semver)
- `react`: ^18
- `graphql`: ^16
- `graphql-request`: ^6

**Important:** The `^14` peer dep means Next.js 14+ is the minimum. In practice, v5.3.x works with Next.js 14 and 15 but does NOT officially support Next.js 16 (that requires v6.x).

### Compatibility details (v6.0.0-rc.1)

Peer dependencies for `@remkoj/optimizely-cms-nextjs@6.0.0-rc.1`:
- `next`: ^16
- `react`: ^19
- `react-dom`: ^19

**Breaking:** v6 drops Next.js 14/15 and React 18 support entirely. Projects must upgrade to Next.js 16 + React 19 before migrating to @remkoj v6.

### Version alignment rule

All `@remkoj/optimizely-cms-*` and `@remkoj/optimizely-graph-*` packages in a project **must** be the same version. Version mismatches cause subtle runtime errors because the packages share internal contracts.

## @optimizely/cms-sdk (official SDK)

### Key packages

| Package | Purpose |
|---------|---------|
| `@optimizely/cms-sdk` | Core SDK: React server/client components, rich text, build config |
| `@optimizely/cms-cli` | CLI for project scaffolding and management |

### Version matrix

| Version | React | Status | Notes |
|---------|-------|--------|-------|
| **2.0.0** (latest) | `>=19.0.0` | GA (May 2026) | React 19 required, framework-agnostic |
| **1.0.0** | `^19.0.0` | GA (Feb 2026) | First stable release |

### Key differences from @remkoj

- **Framework-agnostic at core** — exports `./react/server`, `./react/client`, `./buildConfig` (not Next.js-specific)
- **No explicit Next.js peer dep** — designed to work with any React 19 framework
- **React 19 only** — no React 18 fallback
- **Smaller surface area** — single package vs @remkoj's multi-package family
- **Limited ecosystem maturity** — fewer community examples, starter kits still reference @remkoj

## What to check in audits

### Package ecosystem identification
- **Which SDK?** Check if project uses `@remkoj/*` packages, `@optimizely/cms-sdk`, or both (mixing is not recommended)
- **All @remkoj packages same version**: `package.json` should show matching versions across all @remkoj packages

### Framework version compatibility
- **Next.js 14 + @remkoj v5.x**: Supported and stable
- **Next.js 15 + @remkoj v5.x**: Works (^14 peer dep allows it) but test carefully with App Router changes
- **Next.js 16 + @remkoj v5.x**: NOT supported — must upgrade to @remkoj v6.x (currently RC)
- **Next.js 16 + @optimizely/cms-sdk v2.x**: Supported path for new projects
- **React 19 migration**: Required for @remkoj v6.x and @optimizely/cms-sdk; check for React 18 APIs that changed

### Content Graph client version
- Must match the Content Graph API version in use
- CMS API Preview 3 requires @remkoj v5.3.0+ (earlier versions use Preview 2)

## Common issues

- One @remkoj package upgraded while others weren't (API contract breaks)
- Using @remkoj v5.x with Next.js 16 (unsupported, causes hydration and routing errors)
- Project on React 18 attempting to adopt @optimizely/cms-sdk (requires React 19)
- Mixing @remkoj packages with @optimizely/cms-sdk in the same project (different API contracts, duplicated fetching)
- Using an old @remkoj version with new Content Graph features (missing API support)
- Mixing @remkoj packages with manual Content Graph queries (duplicated, inconsistent fetching logic)
- Attempting @remkoj v6 RC in production without understanding it is pre-release (stability risk)

## Migration guidance

### React 18 + Next.js 14/15 projects (majority of existing installs)
Stay on @remkoj v5.3.x. This is the stable, production-proven path. Upgrade to v6 only after it reaches stable and your project is ready for React 19.

### Greenfield React 19 projects
Consider @optimizely/cms-sdk v2.0 for the official path, or @remkoj v6 RC if you need Visual Builder integration and Content Graph typed queries that the official SDK doesn't yet cover.

### Next.js 16 upgrades
Requires @remkoj v6.x (RC as of May 2026) or @optimizely/cms-sdk v2.x. Plan this as a major migration — React 19 is a prerequisite.
