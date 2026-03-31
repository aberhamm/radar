# Sitecore Editing Integration Patterns

## Editing modes

Sitecore supports two editing experiences:

1. **Experience Editor** (legacy): iframe-based, requires `EditingComponentPlaceholder` and chromes
2. **Sitecore Pages** (XM Cloud): modern editing UI, uses editing webhooks and metadata-based editing

## Required endpoints for XM Cloud editing

- `/api/editing/render` — Receives editing render requests from Sitecore Pages
- `/api/editing/data/[key]` — Stores/retrieves editing data during the editing session
- Both endpoints must validate the editing secret (`JSS_EDITING_SECRET`)

## How editing detection works

The rendering host detects editing mode through:
- `sc_mode=edit` query parameter
- Editing-specific headers from the Sitecore editing proxy
- The `isEditorActive()` utility from `@sitecore-jss/sitecore-jss-nextjs`

## Common issues we find

- **Missing editing secret validation**: The render endpoint should check `JSS_EDITING_SECRET` to prevent unauthorized editing requests
- **Broken editing in App Router**: JSS 22.0 editing middleware doesn't handle Next.js 15 async APIs correctly
- **Missing editing data endpoint**: Some projects have the render endpoint but forgot `/api/editing/data/[key]`
- **Hardcoded editing host URL**: Should be environment-driven, not hardcoded to a specific domain

## Pattern: proper editing setup

```
src/pages/api/editing/
  render.ts          ← EditingRenderMiddleware
  data/[key].ts      ← EditingDataMiddleware or EditingDataDiskCache
```

Both should import from `@sitecore-jss/sitecore-jss-nextjs/editing` and use the shared editing secret.
