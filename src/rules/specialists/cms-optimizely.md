# Optimizely CMS Specialist Checklist

When investigating an Optimizely CMS project, check each of the following areas systematically. Record findings with evidence for every item that applies.

## SDK Version & Compatibility

- Identify which SDK is in use: community `@remkoj/optimizely-*` or official `@optimizely/cms-sdk` — they have different API contracts and must not be mixed.
- If `@remkoj`: check version — v5.x (stable) works with Next.js 14/15 + React 18; v6.x (RC) requires Next.js 16 + React 19.
- If `@optimizely/cms-sdk` v2.x: requires React 19 — verify the framework version supports it (Next.js 15+ with React 19, or Next.js 16).
- Check that all `@remkoj/optimizely-cms-*` and `@remkoj/optimizely-graph-*` packages are at the same version — version lock is critical; mismatched versions cause subtle runtime errors.
- Look for CMS API Preview version usage — `@remkoj` v5.3.0+ uses Content Graph Preview 3 (earlier versions use Preview 2).
- If both SDK ecosystems are present in `package.json`, flag as a finding — mixing causes duplicated fetching and conflicting API contracts.

## App Router & Server Components

- Check if the project uses Next.js App Router with proper Server Component patterns for content fetching — content should be fetched at the server layer, not in client-side `useEffect`.
- Verify that content fetching (Graph queries, CMS API calls) happens in Server Components or `page.tsx` / `layout.tsx` — not inside components marked `'use client'`.
- Look for `'use client'` directives on content-rendering components that could be server-rendered — unnecessary client boundaries increase bundle size and lose streaming benefits.
- Check for proper Suspense/streaming patterns with content loading — large content queries should stream via `<Suspense>` boundaries rather than blocking the full page.
- Verify that Visual Builder / on-page editing components correctly separate server data fetching from client interactivity.

## Next.js 16 Readiness

- If on `@remkoj` v5.x and planning a Next.js 16 upgrade: v6.x migration is required — this is a breaking change that also requires React 19.
- Check for `middleware.ts` usage that needs migration to `proxy.ts` in Next.js 16 (middleware API changed significantly).
- Check for synchronous `cookies()` / `headers()` calls that must be `await`ed in Next.js 15+ — these throw in Next.js 16 strict mode.
- If using `@remkoj/optimizely-cms-nextjs` middleware helpers, confirm they are compatible with the target Next.js version.
- Look for `next/image` or `next/link` usage patterns deprecated in Next.js 15/16.

## Content Delivery API

- Determine which Content Delivery API version is in use (v2 vs v3). Version 3 has breaking changes in response format and authentication.
- Check query patterns for efficiency — are content queries filtered server-side or is the client fetching large result sets and filtering in JavaScript?
- Look for pagination on content listing queries — unbounded queries can return thousands of items.

## Optimizely Graph / Content Graph

- Check whether the project uses Optimizely Graph for content delivery. Look for GraphQL queries targeting the Graph endpoint.
- Verify that Graph queries use appropriate caching headers and that webhook-based cache invalidation is configured.
- Look for overly broad Graph queries that fetch more fields than needed — select only required properties.
- Check for Graph query complexity — deeply nested content references resolved in a single query can be expensive.

## Visual Builder / On-Page Editing

- Check how edit mode is detected — look for `isEditMode`, preview API routes, or draft content fetching logic.
- Verify that the preview/edit mode setup works with the current framework version — Optimizely's editing integration has version-specific requirements.
- Look for components that break in edit mode due to missing null checks on content properties (content may be partially populated during editing).
- Check that preview API routes are secured and not accessible in production without authentication.

## Content Type Mapping

- Check the component-to-content-type registry for completeness — every content type defined in the CMS should have a corresponding component.
- Look for a catch-all or fallback component for unknown content types. Missing handlers cause rendering failures.
- Verify that the content type names in the mapping match the CMS type identifiers exactly (case-sensitive).
- Check for content types that exist in code but may have been removed from the CMS schema.

## @remkoj Ecosystem Packages

- If using `@remkoj/optimizely-*` packages, check version alignment across all packages in the ecosystem. Mismatched versions cause subtle runtime errors.
- Look for breaking changes between installed versions and latest — the `@remkoj` ecosystem moves quickly and has frequent API changes.
- Verify that the `@remkoj/optimizely-cms-nextjs` integration is compatible with the installed Next.js version (v5.x supports Next.js 14/15; v6.x requires Next.js 16).
- Check for custom overrides or patches of `@remkoj` internals that may break on upgrade.
- If on v6.0.0-rc.1: flag that this is pre-release software — production use carries stability risk; confirm the team accepts RC-level support.
- Check `@remkoj/optimizely-graph-client` version matches the CMS React package — Graph client and CMS packages share internal contracts.
- If using `@remkoj/optimizely-cms-cli` for code generation, verify the generated types match the installed runtime package version.
- Note: `@optimizely/cms-sdk` v2.x is the official SDK alternative (GA May 2026, React 19 only) — relevant for greenfield projects or teams planning React 19 migration.

## Environment Variables

- Check for required environment variables: `OPTIMIZELY_CMS_URL`, Graph endpoint, API keys.
- Verify that `NEXT_PUBLIC_*` prefixed variables don't expose sensitive values (CMS management API keys, preview secrets).
- Check `.env.example` or documentation for a complete list of required environment variables.
- Look for environment variables referenced in code but missing from example files or deployment configuration.
