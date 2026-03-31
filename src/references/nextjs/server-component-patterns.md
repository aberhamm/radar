# Server Component Patterns

## When to use Server Components

- Data fetching from CMS APIs (Content Graph, Layout Service)
- Reading environment variables (server secrets)
- Rendering static or mostly-static content
- Components that don't need interactivity

## When to use Client Components ('use client')

- Interactive UI (forms, modals, dropdowns)
- Browser APIs (localStorage, window)
- Event handlers (onClick, onChange)
- State management (useState, useReducer)
- Effects (useEffect, useLayoutEffect)
- CMS editing integration (Visual Builder, Experience Editor)

## Patterns we see in CMS projects

### Good: Server Component fetches, Client Component renders interactive parts
```
// page.tsx (Server Component)
const data = await fetchFromCMS();
return <InteractiveWidget data={data} />;

// InteractiveWidget.tsx ('use client')
export function InteractiveWidget({ data }) {
  const [expanded, setExpanded] = useState(false);
  // ...
}
```

### Bad: Everything marked 'use client'
Putting `'use client'` at the top of every component defeats the purpose. CMS data fetching ends up client-side, exposing API keys and adding unnecessary bundle size.

### Bad: Trying to use hooks in Server Components
Server Components cannot use `useState`, `useEffect`, etc. CMS components that need editing interactivity must be Client Components.

## What to look for in audits

- **Client/server ratio**: If more than 60% of components are `'use client'`, investigate why
- **Data fetching location**: CMS data should be fetched in Server Components when possible
- **Secret exposure**: Server-only env vars used in Client Components is a security issue
- **Bundle size impact**: Large CMS SDK imports in Client Components bloat the client bundle
