# Next.js Specialist Checklist

When investigating a Next.js project, check each of the following areas systematically. Record findings with evidence for every item that applies.

## App Router vs Pages Router

- Determine which router is in use: App Router (`app/`), Pages Router (`pages/`), or hybrid (both).
- If hybrid, check for mixed usage patterns — are new routes being added to `app/` while legacy routes remain in `pages/`?
- Look for incomplete migration signals: `getStaticProps`/`getServerSideProps` in `pages/` alongside server components in `app/`.
- Check for conflicting route definitions between `app/` and `pages/` that would cause shadowing.

## Client/Server Component Split

- Having both client and server components is the **intended architecture** in React Server Components. Never flag the coexistence itself as a finding. A 50/50 or any other client/server ratio is not inherently a problem.
- Only flag **specific** `"use client"` directives that are unjustified: components that import only server-safe code, that could be server components instead, or that inflate the client bundle without benefit.
- Check for `"use client"` at layout or page level when only a child component needs interactivity.
- Verify that data-fetching components (those calling APIs or databases) are server components, not client.

## Image Optimization

- Check for `next/image` usage vs raw `<img>` tags — raw tags bypass automatic optimization.
- Verify that `width` and `height` props are provided to prevent layout shift.
- Check `next.config` for `images.domains` or `images.remotePatterns` — are all external image sources configured?
- Look for images served without responsive sizing (`sizes` prop missing on variable-width images).

## Route Handlers vs API Routes

- If App Router is active, check whether API endpoints use the new `app/api/*/route.ts` convention or legacy `pages/api/*.ts`.
- Verify HTTP method exports (`GET`, `POST`, etc.) are correctly named in route handlers.
- Check for request/response patterns — are route handlers using the Web API `Request`/`Response` objects or legacy `req`/`res`?

## Middleware

- Check for `middleware.ts` at the project root — is it present and what does it do?
- Verify matcher configuration — is it scoped correctly or matching too broadly?
- Check for edge runtime compatibility — are Node.js-only APIs used in middleware that runs at the edge?
- Look for performance-sensitive operations in middleware (database calls, heavy computation).

## Configuration Quality

- Review `next.config` for: `output` mode (standalone, export), experimental flags, security headers, redirects/rewrites.
- Check for deprecated configuration options that should be updated for the current Next.js version.
- Verify that `transpilePackages` includes any ESM-only dependencies that need compilation.
- Look for missing or overly permissive CORS and CSP headers.

## Bundle and Performance

- Check for dynamic imports (`next/dynamic`, `React.lazy`) on heavy components.
- Look for barrel file re-exports (`index.ts` files that re-export everything) that defeat tree-shaking.
- Verify that third-party scripts use `next/script` with appropriate loading strategies.
- Check for large client-side state libraries when server components could handle the data flow.
