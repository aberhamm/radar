# Optimizely CMS SDK Compatibility (@remkoj packages)

## Package family

The `@remkoj/optimizely-cms-*` packages are the community SDK for Optimizely SaaS CMS + Next.js. They are maintained by Remko Jantzen and are the de facto standard for new Optimizely SaaS implementations.

## Key packages

| Package | Purpose |
|---------|---------|
| `@remkoj/optimizely-cms-react` | React components, Visual Builder integration, edit mode |
| `@remkoj/optimizely-cms-nextjs` | Next.js specific utilities, middleware, routing |
| `@remkoj/optimizely-cms-api` | Content Graph client, query builders |
| `@remkoj/optimizely-graph-client` | Low-level Graph client |
| `@remkoj/optimizely-graph-functions` | Code generation for typed Graph queries |

## Version alignment rule

All `@remkoj/optimizely-cms-*` and `@remkoj/optimizely-graph-*` packages in a project should be the same version. Version mismatches cause subtle runtime errors because the packages share internal contracts.

## What to check

- **All @remkoj packages same version**: `package.json` should show matching versions
- **Compatibility with Next.js**: Recent @remkoj versions target Next.js 14+. Older versions may not work with App Router features.
- **Content Graph client version**: Must match the Content Graph API version in use

## Common issues

- One @remkoj package upgraded while others weren't (API contract breaks)
- Using an old @remkoj version with new Content Graph features (missing API support)
- Mixing @remkoj packages with manual Content Graph queries (duplicated, inconsistent fetching logic)
