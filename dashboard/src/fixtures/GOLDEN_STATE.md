# Golden State Reference — Dashboard Visual Regression

This document describes the expected visual state of the dashboard when rendering
the demo run (`demo-run.json`). AI coding assistants should use this as a reference
when verifying dashboard rendering correctness.

## Sidebar

- One completed run entry visible
- Run title shows the repository name
- Goal badge displays the analysis type (e.g. "audit" or "audit-generic")
- Timestamp shows relative time (e.g. "2 days ago")
- Status indicator shows green (completed)

## Main Content — Scorecard

The scorecard panel displays 6 categories with traffic-light scores:

| Category        | Expected Score |
|-----------------|---------------|
| Category 1      | green         |
| Category 2      | green         |
| Category 3      | yellow        |
| Category 4      | yellow        |
| Category 5      | red           |
| Category 6      | green         |

- Overall score badge visible at top (derived from worst category)
- Each category row is clickable to expand findings
- Score pills use the design system colors: green (#22c55e), yellow (#eab308), red (#ef4444)

## Findings Panel

7 total findings displayed, grouped by severity:

| Severity | Count | Visual Treatment          |
|----------|-------|---------------------------|
| Critical | 1     | Red badge, top of list    |
| High     | 2     | Orange badge              |
| Medium   | 2     | Yellow badge              |
| Low      | 1     | Blue badge                |
| Info     | 1     | Gray badge, bottom        |

Each finding card shows:
- Severity badge (color-coded)
- Title (bold)
- Category tag
- Evidence count indicator
- Expandable description with code snippets

## Metrics Display

The metrics bar (top or sidebar) shows:

- **Tool calls:** 32
- **Estimated cost:** $0.80
- **Duration:** 3m 42s (222,000ms)
- **Model(s):** Listed with token counts

## Event Stream / Investigation Log

The investigation timeline section shows:

- **16 investigation steps** displayed chronologically
- Each step shows: tool name, brief result summary, timestamp
- Steps are grouped by batch (parallel tool calls share a batch ID)
- Expandable detail view shows full reasoning and arguments
- Model switch event clearly visible as a divider/marker

## Layout Expectations

- Sidebar fixed on the left (280px wide on desktop)
- Main content scrollable
- Responsive: sidebar collapses to drawer on mobile (<768px)
- Dark mode supported (respects system preference or toggle)
- All text uses the project's design system fonts
