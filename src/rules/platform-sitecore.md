# Sitecore-specific investigation rules

## Must-investigate areas

- **Component registration**: How are components mapped to Sitecore renderings? Is it manual, auto-generated, or factory-based? Check for component-map files and CLI config.
- **Layout Service integration**: Is it REST or GraphQL? Edge delivery or direct CM? Connected or disconnected mode? Find the actual client configuration.
- **Experience Editor / XM Cloud Pages editing**: Find the actual editing middleware, webhooks, editing data routes, and Draft Mode integration. Verify the SITECORE_EDITING_SECRET is not hardcoded.
- **Multisite support**: Is there a site resolver? How is site context passed to the rendering layer? Is sites.json baked at build time?
- **Content SDK / JSS SDK version**: Check compatibility with the detected Next.js version. Is this the new Content SDK or legacy JSS?
- **Middleware chain**: What middlewares are registered and in what order? Are there skip conditions or is everything running on every request?
- **Serialization setup**: Is Sitecore CLI configured? How are content items serialized? Is the workflow documented?

## Common Sitecore issues to look for

- **Hardcoded jssDeploymentSecret** in xmcloud.build.json — this is a CRITICAL security finding if the value is the template default. Record this as HIGH severity.
- **Template default values committed to source control** — placeholder URLs, staging hostnames, default site names.
- **Editing integration that assumes specific Sitecore instance configuration** — hardcoded CM URLs, non-parameterized editing host settings.
- **Component registration that will break if Sitecore template structure changes** — fragile string-based mappings.
- **Hardcoded site names instead of dynamic site resolution** — will break in multisite scenarios.
- **Mixed use of REST and GraphQL Layout Service endpoints** — indicates incomplete migration.
- **Missing or incomplete editing webhook configuration for XM Cloud** — editing will silently fail.
- **force-dynamic on all pages** — disables ISR/SSG, removes Next.js performance benefits. Record as MEDIUM.
- **Build-time baked sites.json** — new sites added in XM Cloud won't appear until redeployment. Record as MEDIUM.
- **Inconsistent env var names across starters** in a monorepo — will cause silent configuration failures.
- **Missing test coverage** — no test setup or minimal test files. Record as LOW.

## When to search documentation

- If Content SDK / JSS SDK version is more than 1 major behind, fetch the changelog from GitHub to identify breaking changes between installed and latest.
- If the project uses XM Cloud patterns, check doc.sitecore.com for the current XM Cloud rendering host requirements — these change with platform releases.
- If you find editing integration code you're unsure about, fetch the current Sitecore editing integration documentation to verify the pattern is still supported.
