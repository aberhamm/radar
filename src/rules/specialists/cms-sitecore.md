# Sitecore JSS Specialist Checklist

When investigating a Sitecore JSS project, check each of the following areas systematically. Record findings with evidence for every item that applies.

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

## Personalization and Rendering

- Check whether personalization is implemented at the component level (conditional rendering rules) or page level (layout variations).
- If using component-level personalization, verify that personalized variants don't cause hydration mismatches in SSR/SSG.
- Look for performance implications of personalization — does it require SSR for every personalized page, or is CDN-compatible variant selection used?

## Dictionary Service and i18n

- Check the i18n setup: is the Dictionary Service used for translations, or are strings hardcoded?
- Verify that fallback language handling is configured — what happens when a translation is missing for a locale?
- Check for locale-aware routing: are language prefixes consistent and handled by middleware or the layout service?
- Look for hardcoded strings in components that should come from the Dictionary Service.
