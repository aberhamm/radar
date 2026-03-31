# Next.js Caching Strategies for CMS Projects

## Caching layers in Next.js

1. **Request Memoization**: Deduplicates identical `fetch()` calls within a single render
2. **Data Cache**: Persists `fetch()` results across requests (ISR)
3. **Full Route Cache**: Caches the entire rendered page at build time
4. **Router Cache**: Client-side cache of visited routes

## CMS-specific caching considerations

### Published content (production)
- Use ISR with `revalidate` for content that changes infrequently
- Experience Edge / Content Graph published endpoint can be cached aggressively
- Typical revalidate: 60-300 seconds depending on content freshness requirements

### Preview/draft content
- Must NOT be cached. Editors need to see their changes immediately.
- Use `{ cache: 'no-store' }` or `revalidate: 0` for preview data fetching
- Pages Router: `getServerSideProps` (no caching)
- App Router: `export const dynamic = 'force-dynamic'` or `{ cache: 'no-store' }` on fetch

### On-demand revalidation
- Preferred pattern for CMS content: revalidate on publish via webhook
- CMS publishes content → webhook hits `/api/revalidate` → Next.js purges cache for affected paths
- More efficient than time-based ISR for content that changes unpredictably

## What we look for

- **Preview uses no-cache**: Draft content must never be served from cache
- **Production uses ISR or on-demand revalidation**: Static content should be cached
- **Revalidation webhook exists**: If the CMS supports publish webhooks, the app should handle them
- **Cache-busting in development**: Dev mode should not cache CMS responses (confuses developers)

## Next.js 15 caching changes

Next.js 15 changed default caching behavior:
- `fetch()` is no longer cached by default (was cached in 14)
- Must explicitly opt in with `{ cache: 'force-cache' }` or route segment config
- This is a breaking change for projects upgrading from 14 to 15
