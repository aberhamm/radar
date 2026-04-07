# Optimizely CMS Specialist Checklist

When investigating an Optimizely CMS project, check each of the following areas systematically. Record findings with evidence for every item that applies.

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
- Verify that the `@remkoj/optimizely-cms-nextjs` integration is compatible with the installed Next.js version.
- Check for custom overrides or patches of `@remkoj` internals that may break on upgrade.

## Environment Variables

- Check for required environment variables: `OPTIMIZELY_CMS_URL`, Graph endpoint, API keys.
- Verify that `NEXT_PUBLIC_*` prefixed variables don't expose sensitive values (CMS management API keys, preview secrets).
- Check `.env.example` or documentation for a complete list of required environment variables.
- Look for environment variables referenced in code but missing from example files or deployment configuration.
