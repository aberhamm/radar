# Optimizely Visual Builder Integration

## What Visual Builder is

Visual Builder is Optimizely's on-page editing experience for SaaS CMS. It allows content editors to drag and drop components, edit content inline, and preview changes in real time.

## How it works

1. The CMS sends the page URL to the rendering host with edit-mode parameters
2. The rendering host detects edit mode and loads the Visual Builder SDK
3. The SDK establishes a communication channel between the CMS UI and the rendered page
4. Component selections, content changes, and layout updates are reflected in real time

## Required setup

- **CMS page route**: A catch-all route (usually `[[...path]]`) that handles all CMS-managed pages
- **Edit mode detection**: Check for `epieditmode` or equivalent query parameters
- **Visual Builder SDK**: `@remkoj/optimizely-cms-react` provides the editing components
- **Component mapping**: Each CMS content type must map to a React component

## What we look for

- **Edit mode detection is present and correct**: The app must detect when it's being loaded inside the Visual Builder iframe
- **Component registry covers all content types**: Missing mappings = broken editing for those types
- **Preview data fetching uses draft endpoint**: Editor changes must be visible immediately
- **Client components marked correctly**: Visual Builder interactive elements need `'use client'`

## Common issues

- Missing `'use client'` on components that need interactivity in the editor
- Component registry using static imports instead of dynamic imports (bundle size impact)
- Not handling the case where Visual Builder sends an unknown content type (should render a fallback, not crash)
- Preview fetching cached aggressively (editors don't see their changes)
