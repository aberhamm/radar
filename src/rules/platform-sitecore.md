# Sitecore-specific investigation rules

## Must-investigate areas

- Component factory or component builder registration: how are components mapped to Sitecore renderings?
- Layout Service integration: is it REST or GraphQL? Connected or disconnected mode?
- Experience Editor / Sitecore Pages editing support: find the actual editing middleware, webhooks, and editing data routes.
- Multisite support: is there a site resolver? How is site context passed to the rendering layer?
- JSS SDK version: check compatibility with the detected Next.js version.

## Common Sitecore issues to look for

- Editing integration that assumes specific Sitecore instance configuration
- Component registration that will break if Sitecore template structure changes
- Hardcoded site names instead of dynamic site resolution
- Mixed use of REST and GraphQL Layout Service endpoints
- Missing or incomplete editing webhook configuration for XM Cloud

## When to search documentation

- If JSS SDK version is more than 1 major behind, fetch the JSS changelog from GitHub to identify breaking changes between installed and latest.
- If the project uses XM Cloud patterns, check doc.sitecore.com for the current XM Cloud rendering host requirements — these change with platform releases.
- If you find editing integration code you're unsure about, fetch the current Sitecore editing integration documentation to verify the pattern is still supported.
