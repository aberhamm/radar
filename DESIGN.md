# Design System — Radar

## Product Context
- **What this is:** AI-powered codebase analysis tool that produces scored consulting briefs
- **Who it's for:** Practice leads and sales directors at consulting firms (primary), developers running the tool (secondary)
- **Space/industry:** Developer tools / consulting delivery automation
- **Project type:** Dashboard (Next.js web app with SSE real-time streaming)

## Aesthetic Direction
- **Direction:** Precision Instrument
- **Decoration level:** Intentional (subtle shadows and surface hierarchy, no gradients/blobs/patterns)
- **Mood:** Clean, confident, quietly authoritative. Like an Apple-designed consulting tool. The tool feels like it was built by people who care about craft. Not a developer toy, not a corporate bore.
- **Reference sites:** Linear (density, minimalism), Vercel (light-first clarity), Apple HIG (shadow hierarchy, system colors)

## Typography
- **Display/Brand:** Outfit — geometric sans with warmth, signals "modern but not generic." Used for brand wordmark, hero headings, section titles.
- **Report Titles:** Instrument Serif — used sparingly (3-4 instances per screen max) for report hero titles and empty-state headlines. One serif in a sans-serif system says "consulting deliverable" not "SaaS product."
- **Body/UI:** System stack (-apple-system, BlinkMacSystemFont, SF Pro Display, system-ui, Segoe UI) — fastest paint, native feel, zero layout shift.
- **Data/Tables:** JetBrains Mono — tabular-nums for aligned score data, file paths, code snippets, finding IDs, metric values.
- **Code:** JetBrains Mono
- **Loading:** Outfit and JetBrains Mono via next/font/google (automatic subsetting). Instrument Serif via next/font/google (add when implementing report titles).
- **Scale:**

| Level | Size | Weight | Use |
|-------|------|--------|-----|
| xs | 11px | 400 | Metadata, timestamps, tertiary labels |
| sm | 13px | 400-500 | Body small, table cells, badges |
| base | 15px | 400 | Body text, descriptions |
| md | 17px | 500-600 | Subheadings, card titles |
| lg | 20px | 600 | Section headings |
| xl | 24px | 600-700 | Page titles (Outfit) |
| 2xl | 32px | 700 | Hero headings (Outfit) |
| 3xl | 40px | 700 | Display (Outfit), report titles (Instrument Serif) |

## Color

### Approach: Restrained + Semantic
Chromatic color is reserved primarily for score semantics (red/amber/green). The tint accent is used only for interactive elements (buttons, links, focus rings). The UI itself is neutral. When everything is gray, a single red finding or green score hits like a signal flare.

### System Tokens (fixed, never change per client)

#### Light Mode
| Token | Hex | Use |
|-------|-----|-----|
| `--color-canvas` | #f5f5f7 | Page background |
| `--color-surface` | #ffffff | Cards, panels |
| `--color-elevated` | #f2f2f7 | Hover states, code blocks, inset areas |
| `--color-label` | #1d1d1f | Primary text |
| `--color-secondary-label` | #6e6e73 | Body text, descriptions |
| `--color-tertiary-label` | #86868b | Metadata, hints, timestamps |
| `--color-quaternary-label` | #aeaeb2 | Disabled text, placeholders |
| `--color-separator` | #d1d1d6 | Borders, dividers |
| `--color-danger` | #ff3b30 | Critical findings, score red |
| `--color-warning` | #ff9500 | Warning findings, score amber |
| `--color-success` | #34c759 | Passing scores, score green |
| `--color-info` | #5ac8fa | Informational callouts, score blue |

#### Dark Mode
| Token | Hex | Use |
|-------|-----|-----|
| `--color-canvas` | #1c1c1e | Page background |
| `--color-surface` | #2c2c2e | Cards, panels |
| `--color-elevated` | #3a3a3c | Hover states, code blocks |
| `--color-label` | #f5f5f7 | Primary text |
| `--color-secondary-label` | #aeaeb2 | Body text |
| `--color-tertiary-label` | #8e8e93 | Metadata |
| `--color-quaternary-label` | #636366 | Disabled |
| `--color-separator` | #48484a | Borders |
| `--color-danger` | #ff453a | Score red (reduced saturation) |
| `--color-warning` | #ff9f0a | Score amber |
| `--color-success` | #30d158 | Score green |
| `--color-info` | #64d2ff | Score blue |

### Shadows (fixed)
| Token | Value |
|-------|-------|
| `--shadow-card` | 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06) |
| `--shadow-elevated` | 0 4px 16px rgba(0,0,0,0.08) |
| `--shadow-float` | 0 24px 80px rgba(0,0,0,0.14), 0 8px 24px rgba(0,0,0,0.08) |

Dark mode shadows use higher opacity (0.2-0.5 range).

## Brand Configuration

Some tokens are **client-configurable**. When deploying Radar for a specific consulting client (e.g., Perficient), these tokens can be overridden without touching the rest of the system.

### Configurable Tokens
| Token | Default | Purpose |
|-------|---------|---------|
| `--color-tint` | #0071e3 (light) / #0a84ff (dark) | Primary accent for buttons, links, focus rings |
| `--color-tint-hover` | Derived: lighten tint 5% | Hover state for accent elements |
| `--color-brand` | Same as tint | Logo/wordmark color if different from interactive accent |

### How to Apply a Client Theme
Override at `:root` level. A client theme is 2-3 CSS variable overrides:

```css
/* Example: Perficient rebrand */
:root {
  --color-tint: #E31937;  /* Perficient red */
}
:root[data-theme="dark"] {
  --color-tint: #FF4D6A;  /* Lighter for dark mode contrast */
}
```

### Rules
- Score colors (red/amber/green/blue) are NEVER client-configurable. They have universal semantic meaning.
- Surface and label colors are NEVER client-configurable. They maintain WCAG contrast ratios.
- If a client's brand color is red, it must be distinguishable from `--color-danger`. Use a different shade or pair with a secondary brand color for the tint.
- Typography is fixed. Outfit, Instrument Serif, JetBrains Mono, and the system stack are part of Radar's identity.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable (not cramped like Linear, not wasteful like marketing sites)
- **Scale:**

| Name | Value | Use |
|------|-------|-----|
| 2xs | 2px | Hairline gaps, icon padding |
| xs | 4px | Inline spacing, tight gaps |
| sm | 8px | Compact padding, list item gaps |
| md | 16px | Default padding, card internal spacing |
| lg | 24px | Section gaps, generous padding |
| xl | 32px | Between card groups |
| 2xl | 48px | Section spacing |
| 3xl | 64px | Page section boundaries |

## Layout
- **Approach:** Hybrid — grid-disciplined for the app shell, asymmetric for the report view
- **App shell:** Sidebar (240px) + main content (fluid) + optional right panel (260px, collapsible on tablet)
- **Report view:** 60/40 asymmetric split — narrative/findings on left (60%), scorecard/metadata on right (40%). Mirrors how consulting deliverables get read.
- **Grid:** 12-column base at desktop, collapses gracefully
- **Max content width:** 1280px (sidebar excluded)
- **Border radius:**

| Name | Value | Use |
|------|-------|-----|
| sm | 4px | Inline badges, code tags |
| md | 8px | Buttons, inputs |
| lg | 12px | Cards, panels |
| xl | 16px | Modal dialogs, large cards |
| full | 9999px | Dots, pills |

## Motion
- **Approach:** Intentional — motion aids comprehension, never entertains
- **Easing:** Apple spring: `cubic-bezier(0.16, 1, 0.3, 1)` for entrances. Standard ease-out for exits.
- **Duration:**

| Name | Duration | Use |
|------|----------|-----|
| micro | 50-100ms | Hover, active states |
| short | 150-250ms | Fade in/out, color transitions |
| medium | 250-400ms | Route changes, panel slide |
| long | 400-700ms | Modal enter, page transitions |

- **Existing animations (globals.css):** fadeIn, slideUp, scaleIn, slideDown, chip-enter, check-pop, progress-shimmer, expand-down
- **Focus glow:** `0 0 0 4px rgba(0,113,227,0.12)` — uses tint color at 12% opacity

## AI Slop Anti-Patterns (never use)
- Purple/violet gradients as accent
- 3-column feature grid with icons in colored circles
- Centered everything with uniform spacing
- Uniform bubbly border-radius on all elements
- Gradient buttons as primary CTA
- Colored left-border cards (replace blockquote border-left with background tint + padding)
- Decorative blobs, shapes, or abstract illustrations

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-12 | Initial design system created | Created by /design-consultation. Synthesized from competitive research (Linear, Vercel, Sentry, SonarCloud, Snyk) + Claude subagent "Night Desk" direction |
| 2026-04-12 | Instrument Serif for report titles | Subagent insight: one serif in a sans-serif system signals "consulting deliverable" to practice leads |
| 2026-04-12 | Asymmetric 60/40 report layout | Subagent insight: mirrors how consulting assessments get read (scan scores right, read detail left) |
| 2026-04-12 | Semantic-only color approach | Color reserved for scores (red/amber/green). Tint for interactive only. UI is neutral. Subagent validated. |
| 2026-04-12 | Brand configuration layer | Client-configurable accent tokens (tint, hover, brand). Score and surface colors are fixed. |
| 2026-04-12 | Apple HIG foundation retained | Competitive research confirmed: Apple HIG light-first is the gap between dark-neon dev tools and corporate-blue enterprise. Practice leads know this visual language. |
