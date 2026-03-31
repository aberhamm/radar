# XM Cloud Rendering Host Architecture

## How it works

XM Cloud is Sitecore's SaaS CMS. The rendering host is a Next.js application deployed separately from the CMS. Content is fetched via the Layout Service (REST or GraphQL) and rendered by the Next.js app.

## Key components

- **Layout Service**: REST or GraphQL endpoint that returns page layout data (component tree + field values)
- **Rendering Host**: The Next.js application that receives layout data and renders it
- **Experience Edge**: CDN layer for published content delivery
- **Editing Host**: The same Next.js app configured to support Sitecore Pages editing (in-context editing)

## Deployment model

- CMS runs in Sitecore's cloud (XM Cloud)
- Rendering host deploys to Vercel, Netlify, or any Node.js host
- Content flows: CMS → Layout Service/Experience Edge → Rendering Host → User

## What we look for in audits

- **Editing webhook configuration**: XM Cloud requires specific webhook endpoints for editing integration. Missing webhooks = broken editing experience.
- **Environment separation**: Preview should hit Layout Service directly; production should hit Experience Edge.
- **Middleware configuration**: Site resolver middleware must be configured for multisite support.
- **API key management**: `SITECORE_API_KEY` must never be exposed client-side.

## Common architecture mistakes

- Hardcoding the Layout Service URL instead of using environment-driven configuration
- Missing the editing webhook endpoints (`/api/editing/render`, `/api/editing/data/[key]`)
- Not configuring separate environments for preview vs delivery
- Using REST Layout Service in production instead of GraphQL + Experience Edge (performance impact)
