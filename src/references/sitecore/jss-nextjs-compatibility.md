# JSS + Next.js Version Compatibility

## Compatibility matrix

| JSS SDK Version | Supported Next.js | Notes |
|----------------|-------------------|-------|
| 21.x           | 12.x, 13.x       | Pages Router only. No App Router support. |
| 22.0 - 22.1    | 13.x, 14.x       | Added initial App Router support in 22.1. Pages Router still primary. |
| 22.2+          | 14.x, 15.x       | Full App Router support. React 18+ required. |

## Key version boundaries

- **JSS 21 → 22**: Major breaking change. Editing integration API changed completely. `EditingComponentPlaceholder` replaced older editing mode. Layout Service client refactored.
- **JSS 22.0 → 22.1**: Added `nextjs-sxa` initializer support. Minor breaking changes in middleware configuration.
- **Next.js 13 → 14**: Server Actions stable, Turbopack dev support. JSS 22.0+ handles this cleanly.
- **Next.js 14 → 15**: React 19 by default, async request APIs (cookies/headers), changed caching defaults. JSS 22.2+ required for full compatibility.

## Common compatibility issues we see

- Projects on JSS 21 trying to use App Router patterns (won't work, JSS 21 only supports Pages Router)
- Projects on JSS 22.0 with Next.js 15 (editing middleware breaks due to async API changes)
- Mixed JSS and non-JSS pages in the same project creating routing conflicts
- `@sitecore-jss/sitecore-jss-nextjs` version not matching other `@sitecore-jss/*` packages
