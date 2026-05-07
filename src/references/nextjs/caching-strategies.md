# Next.js Caching Strategies for CMS Projects

## Caching model overview

Next.js has two caching models depending on configuration:

1. **Cache Components model** (Next.js 16+, opt-in via `cacheComponents: true`) — uses the `"use cache"` directive for explicit, granular caching at the function or component level. Enables Partial Prerendering (PPR) by default.
2. **Previous model** (Next.js 15+, default without `cacheComponents`) — fetch-level caching with `force-cache`, `unstable_cache`, and route segment configs.

Both models share the same baseline: **`fetch()` is not cached by default.** All caching is opt-in.

## Caching layers

| Layer | Scope | Behavior |
|-------|-------|----------|
| **Request Memoization** | Single render pass | Identical `fetch()` calls (same URL + options) within one request are deduplicated automatically. For non-fetch, wrap with `React.cache()`. |
| **Data Cache** | Cross-request, server-side | Persists cached fetch results or `use cache` outputs across requests. Controlled by `force-cache`, `next.revalidate`, or `use cache` + `cacheLife`. |
| **Full Route Cache** | Build/deploy time | Prerendered HTML + RSC payload for static routes. Invalidated by revalidation. |
| **Router Cache** | Client-side, per session | Caches visited route segments in the browser for instant back/forward navigation. Cleared on hard refresh or after expiry. |

## Cache Components model (Next.js 16)

Enabled by `cacheComponents: true` in `next.config.ts`. This is the recommended path forward.

### `"use cache"` directive

Marks a function or component for caching. Arguments and closed-over values become the cache key automatically.

```ts
// Data-level caching
export async function getProducts() {
  'use cache'
  cacheLife('hours')
  return db.query('SELECT * FROM products')
}

// UI-level caching (entire page)
export default async function Page() {
  'use cache'
  cacheLife('days')
  // ...
}
```

### `cacheLife(profile)`

Controls cache duration. Built-in profiles: `'seconds'`, `'minutes'`, `'hours'`, `'days'`, `'weeks'`, `'max'`. Custom profiles can be defined in `next.config.ts`.

### `cacheTag(tag)` / `updateTag(tag)`

Tags cached entries for on-demand invalidation. Call `updateTag('posts')` in a Server Action or Route Handler to expire all entries tagged `'posts'`.

### Rendering with PPR

With Cache Components, Next.js uses Partial Prerendering:
- `use cache` content is included in the static shell
- `<Suspense>` fallbacks are included in the static shell; wrapped content streams at request time
- Runtime APIs (`cookies()`, `headers()`, `searchParams`) force request-time rendering; must be wrapped in `<Suspense>`
- Uncached async work outside `<Suspense>` produces a build error

## Previous caching model (no `cacheComponents`)

### Opting into caching

```ts
// Per-fetch
await fetch(url, { cache: 'force-cache' })
await fetch(url, { next: { revalidate: 3600 } })

// Non-fetch functions
import { unstable_cache } from 'next/cache'
const getCachedUser = unstable_cache(fn, ['user'], { tags: ['user'], revalidate: 3600 })

// Route-level
export const dynamic = 'force-static'
export const revalidate = 3600
```

### Opting out (dynamic)

```ts
await fetch(url, { cache: 'no-store' })
export const dynamic = 'force-dynamic'
export const revalidate = 0
```

## CMS-specific caching considerations

### Published content (production)

- Use time-based revalidation (`cacheLife('hours')` or `next.revalidate: 60-300`) for content that changes infrequently
- CMS published/delivery endpoints can be cached aggressively
- On-demand revalidation via webhook is preferred over short TTLs for unpredictable publish schedules

### Preview/draft content

- Must NOT be cached. Editors need to see changes immediately.
- Previous model: `{ cache: 'no-store' }` or `export const dynamic = 'force-dynamic'`
- Cache Components model: do not add `"use cache"` to preview paths; wrap in `<Suspense>` for streaming
- Draft mode (`draftMode()`) should disable all caching for the request

### On-demand revalidation

- Preferred pattern for CMS content: revalidate on publish via webhook
- CMS publishes content -> webhook hits API route -> calls `revalidateTag('content')` or `updateTag('content')`
- More efficient than time-based ISR for content that changes unpredictably
- Tag granularly: `cacheTag('post-123')` allows surgical invalidation

### Request deduplication

- `fetch()` is automatically memoized within a single render (same URL + options)
- For ORMs/database clients, wrap with `React.cache()` to deduplicate across components in one request
- This is per-request only; not a persistent cache

## What we look for in audits

### Good caching hygiene

- **Published content is cached**: Production CMS queries use `force-cache`, `revalidate`, or `use cache`
- **Preview content is uncached**: Draft/preview paths use `no-store`, `force-dynamic`, or omit `use cache`
- **Revalidation webhook exists**: CMS publish events trigger `revalidateTag`/`updateTag`/`revalidatePath`
- **Granular cache tags**: Content is tagged by type/ID for surgical invalidation
- **Parallel data fetching**: Independent fetches use `Promise.all()` or separate `<Suspense>` boundaries
- **Streaming for slow data**: Slow API calls wrapped in `<Suspense>` with meaningful fallback UI

### Red flags

- **No caching anywhere**: All fetches use default (uncached) with no `use cache`, no `force-cache`, no `revalidate` — site is fully dynamic with no benefit from caching
- **Blanket `force-dynamic` on everything**: Over-broad dynamic config that kills cacheability
- **Preview mode leaking into production**: Draft endpoints served without checking draft mode state
- **Stale `unstable_cache` without tags**: Cached data with no invalidation path (time-only revalidation on content that needs real-time updates)
- **Sequential fetches without parallelization**: Waterfall data loading where parallel is possible
- **Missing `<Suspense>` boundaries**: All-or-nothing page loading with no progressive rendering
- **Mixed model confusion**: Using both `use cache` and fetch-level `force-cache` in the same route without understanding precedence

### Upgrade indicators

| From | To | What to look for |
|------|----|------------------|
| Pages Router `getStaticProps` | App Router with caching | ISR semantics preserved; `revalidate` config migrated |
| Next.js 14 (fetch cached by default) | Next.js 15+ (fetch uncached by default) | Explicit `force-cache` or `revalidate` added where caching was previously implicit |
| `unstable_cache` | `use cache` (Next.js 16) | Migration to directive-based caching; `cacheComponents: true` enabled |
