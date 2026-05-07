# Sitecore JSS Specialist Checklist

When investigating a Sitecore JSS project, check each of the following areas systematically. Record findings with evidence for every item that applies.

## JSS Version & Next.js Compatibility

- Check `@sitecore-jss/sitecore-jss-nextjs` version against the installed Next.js version — JSS 22.12+ requires Next.js 16; older JSS (22.2–22.11) supports Next.js 14/15 only; JSS 21.x only supports Next.js 12/13. A mismatch causes build failures or broken editing middleware.
- Check Node.js version in `.nvmrc`, `engines` field, or Dockerfile — JSS 22.12+ requires Node 24. Projects upgrading JSS without bumping Node will see build failures.
- Verify all `@sitecore-jss/*` packages are on the same minor version (e.g., all 22.12.x). Mixed versions (e.g., `sitecore-jss-nextjs` at 22.12 but `sitecore-jss` at 22.8) cause subtle runtime incompatibilities.
- Check for deprecated APIs: `middleware.ts` (Next.js middleware pattern) is replaced by `proxy.ts` in JSS 22.12 / Next.js 16 — presence of the old file signals an incomplete upgrade.
- If project is on JSS 21.x, flag as high-effort migration target — JSS 21 → 22.12 is effectively a replatform (editing integration, routing, and Layout Service client all changed).

## App Router & Server Components

- Determine if the project uses App Router (`app/` directory with `layout.tsx`) or Pages Router (`pages/` directory). App Router requires JSS 22.1+ (fully supported from 22.2).
- Look for components marked `'use client'` that don't actually use browser APIs or React state — these could be Server Components for better performance. Note: JSS field helpers (`<Text>`, `<Image>`, `<RichText>`, etc.) require `'use client'` in editing mode but not in published/production rendering.
- Check for `Suspense` boundary usage — JSS 22.12+ changed default `disableSuspense` to `true` on Placeholder components. Projects relying on streaming SSR need explicit `disableSuspense={false}`.
- Verify `generateStaticParams` is used for static page generation with JSS layout data — this replaces `getStaticPaths` from Pages Router and is the correct pattern for App Router SSG with Sitecore content.
- Check for mixed App Router and Pages Router patterns in the same project — JSS supports this but it causes routing conflicts and duplicate middleware execution.

## Component Factory

- Check whether the component factory is auto-generated (via `scripts/generate-component-factory.ts` or similar) or manually maintained. Manual maintenance risks stale entries when components are added or removed.
- Verify that every component registered in the factory has a corresponding implementation file. Missing implementations cause silent rendering failures.
- Look for components defined in Sitecore templates that are missing from the component factory — these will render as blank placeholders.

## Layout Service

- Determine which layout service mode is in use: REST Layout Service, GraphQL Layout Service, or Experience Edge.
- If using GraphQL, check whether queries use the `layout` query with proper site and item path parameters.
- Check for hardcoded Layout Service endpoints vs environment-variable-driven configuration.
- Verify that the layout service response is typed — untyped responses lead to runtime errors when Sitecore template fields change.

## Placeholder Patterns

- Check for dynamic placeholders (e.g., `{*}` suffix patterns) vs static placeholder names.
- Verify that nested placeholder hierarchies are handled correctly — deeply nested placeholders can cause rendering order issues.
- Look for placeholder keys that don't match the Sitecore rendering definition — mismatched keys cause components to not appear.

## Experience Editor / Pages Compatibility

- Check for conditional rendering based on edit mode (`isEditorActive()`, `isExperienceEditorActive()`).
- Verify that components render chrome markers correctly for inline editing — missing `<Text>`, `<RichText>`, `<Image>` field helpers break the editing experience.
- Look for client-side-only code that breaks in the Experience Editor's server-side rendering context (window references, browser APIs without guards).
- Check that `next/dynamic` components with `ssr: false` have editing mode fallbacks.
- Distinguish between Experience Editor (legacy, `chromes` mode) and Sitecore Pages (modern XM Cloud editor, `metadata` mode) — they use different integration mechanisms. Projects on XM Cloud should support both unless Experience Editor is explicitly disabled.
- Verify `editMode` detection handles both modes: `metadata` mode (Sitecore Pages — uses HTML comment markers, lighter weight) and `chromes` mode (Experience Editor — injects chrome wrapper elements around editable fields).
- Check for editing webhook integration (JSS 22.8+ pattern for XM Cloud) vs traditional rendering host editing routes (`/api/editing/render`) — webhook-based editing is more reliable and is the recommended approach for new projects.
- If using JSS 22.12+ with Next.js 16, verify that editing integration uses `proxy.ts` instead of `middleware.ts` — the old middleware-based editing detection doesn't work with Next.js 16's changed middleware API.

## Personalization and Rendering

- Check whether personalization is implemented at the component level (conditional rendering rules) or page level (layout variations).
- If using component-level personalization, verify that personalized variants don't cause hydration mismatches in SSR/SSG.
- Look for performance implications of personalization — does it require SSR for every personalized page, or is CDN-compatible variant selection used?

## Dictionary Service and i18n

- Check the i18n setup: is the Dictionary Service used for translations, or are strings hardcoded?
- Verify that fallback language handling is configured — what happens when a translation is missing for a locale?
- Check for locale-aware routing: are language prefixes consistent and handled by middleware or the layout service?
- Look for hardcoded strings in components that should come from the Dictionary Service.
