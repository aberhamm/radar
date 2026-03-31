# Optimizely-specific investigation rules

## Must-investigate areas

- Content Graph configuration: are preview and delivery endpoints configured separately?
- Visual Builder / On-Page Editing integration: find the actual edit mode detection and CMS page routes.
- Component-to-content-type mapping: how does the app resolve which React component renders which CMS content type?
- @remkoj package version alignment: all @remkoj/optimizely-cms-* packages should be the same version.

## Common Optimizely issues to look for

- Content Graph queries using published endpoint when they should use draft for preview
- Missing Visual Builder configuration for on-page editing
- Content type mappings that are fragile or hardcoded rather than discoverable
- Mixed use of REST and Graph APIs without clear boundary

## When to search documentation

- If @remkoj packages are more than 2 minor versions behind, fetch the changelog from GitHub to identify breaking changes and new features.
- If you find Content Graph query patterns you're unsure about, fetch the current Optimizely Content Graph documentation to verify the approach.
- If Visual Builder integration is present, check the current docs.developers.optimizely.com documentation to verify the integration matches current requirements.
