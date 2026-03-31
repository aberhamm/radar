# Optimizely Content Graph Setup

## What Content Graph is

Content Graph is Optimizely's GraphQL API for querying CMS content. It replaces the older Content Delivery API for SaaS CMS implementations.

## Two endpoints, two purposes

- **Published endpoint** (`/content/v2`): Returns only published content. Used in production builds and ISR.
- **Draft/preview endpoint** (`/content/v2?auth=...`): Returns draft content. Used in preview mode and the editing experience.

## Authentication

- Published endpoint: Uses a single-key authentication (app key)
- Draft endpoint: Requires HMAC authentication with the app key + secret
- The secret must never be exposed client-side

## Common configuration pattern

```
OPTIMIZELY_GRAPH_SINGLE_KEY=<app-key>      # Published content
OPTIMIZELY_GRAPH_APP_KEY=<app-key>         # For HMAC auth
OPTIMIZELY_GRAPH_SECRET=<secret>           # For draft/preview
OPTIMIZELY_GRAPH_GATEWAY=<gateway-url>     # Content Graph gateway
```

## What we look for

- **Endpoint separation**: Preview mode must use the draft endpoint, not the published one. Using the published endpoint in preview means editors see stale content.
- **Secret exposure**: The Graph secret must never appear in client-side code or `NEXT_PUBLIC_*` variables.
- **Query efficiency**: Large content sets should use pagination. Unbounded queries can time out.
- **Cache strategy**: Published content should be cached (ISR). Preview content must not be cached.

## Common issues

- Using the published endpoint for preview (editors don't see their changes)
- Hardcoding the gateway URL instead of using environment variables
- Not separating the query logic for preview vs production
- Missing error handling when Content Graph is unavailable (should gracefully degrade, not crash)
