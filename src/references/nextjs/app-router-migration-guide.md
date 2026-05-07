# Next.js App Router Migration Assessment Guide

## Current landscape (May 2026)

The App Router is the established standard for Next.js development. As of Next.js 16.x (current stable: 16.2.5), the App Router receives all new features, optimizations, and first-class framework support. The Pages Router remains functional and supported but is in maintenance mode — no new capabilities are being added, and the ecosystem has moved on.

Projects still running Pages Router carry increasing technical debt. SDK authors, hosting platforms, and the React ecosystem (React 19.2, Server Components, View Transitions) assume App Router conventions.

## Pages Router vs App Router

| Aspect | Pages Router (legacy) | App Router (standard) |
|--------|----------------------|----------------------|
| Data fetching | `getStaticProps`, `getServerSideProps` | `fetch()` in Server Components, `use()` |
| Layouts | Manual, per-page `getLayout` | Built-in nested layouts (`layout.tsx`) |
| Loading states | Manual | Built-in `loading.tsx` |
| Error handling | `_error.tsx` | `error.tsx` per route segment |
| Metadata | `next/head` | `metadata` export or `generateMetadata()` |
| Client components | Everything is client by default | Server by default, opt-in `'use client'` |
| Caching | Implicit via data fetching return values | Explicit via `cacheLife`, `cacheTag`, fetch options |
| Middleware | `middleware.ts` | `proxy.ts` (renamed in v16) |
| Build tooling | Webpack | Turbopack (default in v16) |
| React version | React 18 (frozen) | React 19.2 (View Transitions, Activity, useEffectEvent) |

## Version progression and breaking changes

### Next.js 13 → 14

- Minimum Node.js bumped to 18.17
- `next export` removed in favor of `output: 'export'` config
- `@next/font` removed (use `next/font`)
- `ImageResponse` moved from `next/server` to `next/og`
- Server Actions stabilized

### Next.js 14 → 15

- **React 19 required** (minimum `react@19`, `react-dom@19`)
- **Async Request APIs (breaking)**: `cookies()`, `headers()`, `draftMode()`, `params`, `searchParams` all became async (must `await`)
- **Fetch no longer cached by default**: must opt-in with `cache: 'force-cache'`
- **Route Handler GET no longer cached by default**
- **Client-side page cache disabled by default** (no reuse of page segments on navigation)
- `useFormState` deprecated in favor of `useActionState`
- `experimental.serverComponentsExternalPackages` renamed to `serverExternalPackages`
- Geolocation removed from `NextRequest`
- Speed Insights auto-instrumentation removed

### Next.js 15 → 16 (current)

- **Turbopack is the default bundler** for both `dev` and `build`
- **Async Request APIs fully enforced** — synchronous access removed entirely
- **React 19.2** with View Transitions, `useEffectEvent`, Activity component
- **React Compiler support stable** (`reactCompiler: true` in config)
- **`middleware.ts` renamed to `proxy.ts`** with `proxy` named export
- **`next lint` removed** — use ESLint or Biome directly
- **AMP support removed entirely**
- **Runtime configuration removed** (`serverRuntimeConfig`, `publicRuntimeConfig` — use env vars)
- **PPR via `cacheComponents`** replaces `experimental.ppr`
- **New caching APIs**: `updateTag`, `refresh`, `revalidateTag` now requires `cacheLife` profile
- **`next/legacy/image` deprecated**
- Node.js 20.9+ required (Node 18 dropped)
- Custom webpack configs require `--webpack` flag (Turbopack is default)
- Parallel routes require explicit `default.js` files
- Concurrent `dev` and `build` with separate output dirs

## Migration assessment criteria

### Migration completeness indicators

When auditing a codebase, look for these signals to determine where a project sits on the migration spectrum:

**Not started (Pages Router only)**
- All routes under `pages/` directory
- `getStaticProps`, `getServerSideProps`, `getStaticPaths` throughout
- `next/head` for metadata
- `_app.tsx` and `_document.tsx` as primary layout mechanism
- `pages/api/` for backend routes

**Partially migrated (mixed router)**
- Both `app/` and `pages/` directories present
- Some routes in App Router, some still in Pages Router
- Hard navigations occurring between router boundaries
- Duplicate layout logic (one for each router)
- Mixed data fetching patterns

**Substantially migrated (App Router primary)**
- Most routes in `app/` directory
- A few legacy `pages/` routes remaining (often complex or blocked by SDK)
- Server Components in use but `'use client'` overused
- May still have synchronous `cookies()`/`headers()` (pre-v16 patterns)

**Fully migrated (App Router native)**
- No `pages/` directory (or only `pages/api/` stubs)
- Server Components as default, `'use client'` only where needed
- Nested layouts, `loading.tsx`, `error.tsx` in use
- Async Request APIs properly awaited
- `generateStaticParams` instead of `getStaticPaths`
- Metadata API instead of `next/head`

### Common migration debt patterns

**1. Synchronous Request API usage (v15/v16 blocker)**
```typescript
// DEBT: Will break on Next.js 16 (sync access removed)
const cookieStore = cookies() // Must be: await cookies()
const { slug } = params       // Must be: const { slug } = await params
```
Detection: Search for `cookies()`, `headers()`, `draftMode()` without `await`. Search for destructuring `params` or `searchParams` without `await`.

**2. Mixed router with hard navigation boundaries**
- Users experience full page reloads when crossing between `pages/` and `app/` routes
- Link prefetching does not work across router boundaries
- Session/state loss at boundaries

**3. getServerSideProps still in use**
- Pages using `getServerSideProps` cannot move to App Router without rewriting data fetching
- Common in CMS projects where SDK data fetching is tightly coupled to the Pages Router pattern

**4. Overuse of `'use client'`**
- Entire page trees marked as Client Components
- Server Component benefits (smaller bundles, direct data access) not realized
- Often caused by lifting `useState`/`useEffect` too high in the tree

**5. Missing React Server Component adoption**
- Components that could be Server Components are marked `'use client'` unnecessarily
- Data fetching done client-side (useEffect + fetch) when it could happen server-side
- CMS content rendering that sends full SDK payloads to the client

**6. Stale caching assumptions**
- Code written for Next.js 14 assumes `fetch()` is cached by default (it is not in v15+)
- Missing explicit `cache: 'force-cache'` or `next.revalidate` options
- ISR patterns not updated to use `cacheLife`/`cacheTag` (v16)

**7. Webpack-dependent build configuration**
- Custom webpack plugins/loaders that block Turbopack adoption
- `next.config.js` with `webpack()` function requires `--webpack` flag in v16
- Sass `~` imports (Turbopack does not support tilde prefix)

**8. Middleware patterns not updated**
- Still using `middleware.ts` (deprecated in v16, renamed to `proxy.ts`)
- Using `experimental-edge` runtime (errors in v15+)
- CMS site resolution logic in middleware needs testing after upgrades

## Risks of staying on Pages Router

| Risk | Impact | Timeline |
|------|--------|----------|
| No new framework features | Cannot use Server Components, Streaming, PPR, View Transitions | Now |
| SDK incompatibility | CMS SDK authors targeting App Router APIs only | Now (JSS 22.2+, @remkoj 3.x+) |
| React 18 ceiling | Cannot adopt React 19.2 features (useEffectEvent, Activity) | Now |
| Turbopack incompatibility | Performance benefits of Turbopack may not apply to pages/ routes | v16+ |
| Security patches only | Pages Router will eventually receive only critical fixes | 2026+ |
| Hiring friction | New developers expect App Router; Pages Router unfamiliar to junior devs | Now |
| Ecosystem drift | Third-party packages assuming App Router conventions | Accelerating |

## CMS SDK compatibility matrix

### Sitecore JSS (XM Cloud)

| JSS Version | App Router Support | Key constraints |
|-------------|-------------------|-----------------|
| < 22.0 | None | Pages Router only, `getStaticProps`/`getServerSideProps` required |
| 22.0 - 22.1 | Experimental | Layout Service works, editing integration incomplete |
| 22.1+ | Full | App Router supported, Server Components for rendering, editing requires `'use client'` |
| 22.2+ | Recommended | App Router is the default scaffold, Pages Router scaffold deprecated |

**Assessment signals for Sitecore projects:**
- Check `@sitecore-jss/*` package versions in `package.json`
- Look for `SitecorePagePropsFactory` (Pages Router pattern)
- Check if `ComponentFactory` accounts for Server vs Client components
- Editing/preview integration requires `'use client'` boundaries
- Multisite middleware/proxy patterns need version-specific testing

### Optimizely (@remkoj packages)

| Package Version | App Router Support | Key constraints |
|----------------|-------------------|-----------------|
| @remkoj 1.x | None | Pages Router only |
| @remkoj 2.x | Partial | Some components support RSC, data fetching still Pages-style |
| @remkoj 3.x+ | Full | Server Component rendering, `generateStaticParams` for CMS paths, async data fetching |

**Assessment signals for Optimizely projects:**
- Check `@remkoj/optimizely-*` package versions
- Look for `getContentByPath` / `getContentById` usage patterns
- Verify if content delivery uses Server Components or client-side fetching
- Check for `opti-cms` CLI version compatibility
- Visual Builder integration may require specific App Router patterns

### General CMS integration patterns

For any CMS SDK, assess:

1. **Data fetching compatibility** — Does the SDK provide async functions usable in Server Components, or does it require hooks/client-side state?
2. **Preview/editing mode** — Does the CMS editing UI require client-side interactivity (`'use client'`) for inline editing, selection, drag-drop?
3. **Route generation** — Does the SDK support `generateStaticParams` or does it only work with `getStaticPaths`?
4. **Middleware/proxy integration** — Does the site resolution, locale detection, or personalization layer work with the current Next.js routing model?
5. **Component registration** — Does the component factory/registry pattern account for the Server/Client component boundary?

## Upgrade path recommendations

### For projects on Next.js 13 (Pages Router only)

1. Upgrade to Next.js 14 first (smallest breaking change surface)
2. Create `app/` directory, migrate root layout
3. Migrate routes incrementally, starting with static/simple pages
4. Upgrade CMS SDK to App Router-compatible version
5. Then upgrade to Next.js 15 (async APIs, React 19)
6. Finally upgrade to Next.js 16 (Turbopack, full async enforcement)

### For projects on Next.js 14 (mixed router)

1. Complete remaining route migration to `app/`
2. Upgrade to Next.js 15 with codemod (`@next/codemod upgrade latest`)
3. Convert all `cookies()`, `headers()`, `params` to async
4. Verify caching behavior (fetch no longer cached by default)
5. Upgrade to Next.js 16

### For projects on Next.js 15

1. Ensure all async Request APIs are properly awaited (v16 removes sync fallback)
2. Audit custom webpack config (Turbopack is default in v16)
3. Rename `middleware.ts` to `proxy.ts`
4. Remove any `experimental-edge` runtime references
5. Update `revalidateTag` calls to include `cacheLife` profile
6. Upgrade to Next.js 16

### Codemods available

| Codemod | Purpose |
|---------|---------|
| `@next/codemod upgrade latest` | Automated version upgrade (recommended first step) |
| `@next/codemod@canary next-lint-to-eslint-cli .` | Migrate from `next lint` to ESLint CLI (v16) |
| Async APIs codemod (v15) | Convert sync `cookies`/`headers`/`params` to async |
| `next-devtools-mcp` | AI-assisted upgrade via MCP (v16) |

## Known gotchas

- **Cross-router navigation causes hard reloads.** When `app/` and `pages/` routes coexist, navigating between them triggers a full page load. Link prefetching does not work across the boundary.
- **`next/image` behavior differs between routers.** CMS-served images may need configuration updates, especially the new `localPatterns.search` requirement in v16.
- **Route groups `(folder)` don't create URL segments** but affect layout nesting. CMS routing patterns should not use route groups for CMS-managed paths.
- **Parallel routes require `default.js` in v16.** Builds will fail without explicit default files for each parallel slot.
- **Turbopack does not support `~` Sass imports.** Use bare package names (`bootstrap/dist/css/...` not `~bootstrap/dist/css/...`).
- **Custom webpack plugins are silently ignored under Turbopack** unless you explicitly opt back in with `--webpack`.
