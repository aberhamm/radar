# Next.js App Router Migration Guide

## Pages Router vs App Router

The App Router (introduced in Next.js 13.4) is the recommended routing approach going forward. However, migration from Pages Router is non-trivial and affects CMS integrations significantly.

## Key differences that affect CMS projects

| Aspect | Pages Router | App Router |
|--------|-------------|------------|
| Data fetching | `getStaticProps`, `getServerSideProps` | `fetch()` in Server Components, `use()` |
| Layouts | Manual, per-page `getLayout` | Built-in nested layouts (`layout.tsx`) |
| Loading states | Manual | Built-in `loading.tsx` |
| Error handling | `_error.tsx` | `error.tsx` per route segment |
| Metadata | `next/head` | `metadata` export or `generateMetadata()` |
| Client components | Everything is client by default | Server by default, opt-in `'use client'` |

## Migration hotspots for CMS projects

### Data fetching rewrite
- `getStaticProps` → async Server Component with `fetch()`
- `getServerSideProps` → async Server Component with `{ cache: 'no-store' }`
- `getStaticPaths` → `generateStaticParams()`
- ISR `revalidate` → `next.revalidate` fetch option or route segment config

### CMS SDK compatibility
- JSS SDK: Only JSS 22.1+ supports App Router
- @remkoj packages: Recent versions support App Router, older versions do not
- Custom data fetching hooks may need rewriting for Server Components

### Component model change
- Server Components can't use `useState`, `useEffect`, event handlers
- CMS editing components often need `'use client'` because they handle editor interactions
- Component factory/registry patterns must account for server vs client components

## Known gotchas

- Middleware behavior changed between Next.js versions. CMS site resolvers in middleware need testing after any Next.js upgrade.
- `next/image` in App Router uses different default behavior. CMS-served images may need configuration updates.
- Route groups `(folder)` don't create URL segments but affect layout nesting. CMS routing patterns should not use route groups for CMS-managed paths.
