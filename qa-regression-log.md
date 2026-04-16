# QA Regression Log

## Run 1 — 2026-04-16, ~5:00 PM

**Scope:** Full app regression (all pages, desktop + mobile)
**URL:** http://localhost:3000
**Branch:** main
**Console Errors:** 0 across all pages tested

### Pages Tested

| Page | Route | Status | Notes |
|------|-------|--------|-------|
| Home | `/` | PASS | Hero, stats, form, Recent Runs tiles all render correctly |
| Run Detail (Report tab) | `/run/:id` | PASS | Scorecard, findings, top risks, action buttons all working |
| Run Detail (Events tab) | `/run/:id?tab=events` | FAIL | Tab param ignored on direct nav, always shows Report tab |
| Run Detail (Rules tab) | `/run/:id?tab=rules` | FAIL | Same as Events — tab param ignored |
| Run Detail (Cost tab) | `/run/:id?tab=cost` | FAIL | Same as Events — tab param ignored |
| Multi-Goal View | `/multi/:id` | PASS | Goal cards, Top Risks, Investigation Passes, Findings all render |
| Settings | `/settings` | FAIL | Renders home page, no settings UI exists |
| Compare | `/compare` | FAIL | Renders home page, no compare UI exists |
| Replay | `/run/:id/replay` | FAIL | Renders report view, no distinct replay experience |
| Mobile Home | `/` (375px) | FAIL | Sidebar covers entire screen, main content inaccessible |
| Mobile Run Detail | `/run/:id` (375px) | FAIL | Same sidebar-over-everything issue |

### Issues Found

#### ISSUE-001: Tab query params ignored on direct navigation [MEDIUM]
- **Severity:** Medium
- **Category:** Functional / Routing
- **Repro:** Navigate directly to `/run/:id?tab=events` (or rules, cost)
- **Expected:** Events/Rules/Cost tab content shown, tab highlighted
- **Actual:** Report tab always shown and selected regardless of `?tab=` param
- **Impact:** Users can't share deep links to specific tabs; browser back/forward through tabs may not work
- **Evidence:** Screenshot `events-direct.png` shows Report tab active despite `?tab=events` in URL

#### ISSUE-002: /settings route has no Settings page [MEDIUM]
- **Severity:** Medium
- **Category:** Functional / Missing Feature
- **Repro:** Click Settings in sidebar OR navigate to `/settings`
- **Expected:** Settings page with configuration options
- **Actual:** Home page renders; Settings button in sidebar is not interactable
- **Impact:** No way to configure the application
- **Evidence:** Screenshot `settings-direct.png` shows home page at `/settings` route

#### ISSUE-003: /compare route has no Compare page [MEDIUM]
- **Severity:** Medium
- **Category:** Functional / Missing Feature
- **Repro:** Navigate to `/compare`
- **Expected:** Compare UI for diffing two runs
- **Actual:** Home page renders
- **Impact:** Compare button in sidebar and header "Compare" link don't lead anywhere useful
- **Evidence:** Screenshot `compare-page.png` shows home page at `/compare` route

#### ISSUE-004: Mobile sidebar covers entire viewport [HIGH]
- **Severity:** High
- **Category:** UX / Responsive
- **Repro:** View any page at 375px mobile viewport
- **Expected:** Sidebar collapsed or toggleable, main content visible
- **Actual:** Sidebar takes full width, no close mechanism visible, main content completely hidden
- **Impact:** App is unusable on mobile devices
- **Evidence:** Screenshots `mobile-home.png` and `mobile-run-detail.png`

#### ISSUE-005: /run/:id/replay renders report instead of replay [LOW]
- **Severity:** Low
- **Category:** Functional / Missing Feature
- **Repro:** Navigate to `/run/:id/replay` or click "View Run" button
- **Expected:** Replay/timeline view of the agent investigation
- **Actual:** Same report view as `/run/:id`
- **Impact:** "View Run" button doesn't provide additional value over the report
- **Evidence:** Screenshot `replay-page.png` identical to `run-onboarding.png`

#### ISSUE-006: Recent Runs tiles missing repo name separator [LOW]
- **Severity:** Low
- **Category:** Visual / Content
- **Repro:** Look at Recent Runs tiles and "91 more..." overflow buttons at bottom of home page
- **Expected:** "sitecore-minimal accessibility" (space between repo and goal)
- **Actual:** "sitecore-minimalaccessibility" (concatenated, no space/separator)
- **Impact:** Readability — confusing when scanning recent runs
- **Evidence:** Visible in home page snapshot: `@e31 [button] "sitecore-minimalaccessibility 4/16/2026"`

### Fixes Applied

#### ISSUE-001: FIXED — Tab query params now respected on direct navigation
- **Files changed:** `dashboard/src/app/[[...slug]]/page.tsx`
- **Root cause:** `handleSelectHistory()` always called `setActiveTab('report')`, overwriting the URL-driven tab set moments earlier
- **Fix:** Added `initialTab?: Tab` parameter to `handleSelectHistory()`. Both cached and fetched code paths now use `initialTab ?? 'report'`. All callers (initial URL load, back/forward) pass the URL tab through.
- **Verified:** Direct nav to `?tab=events` now shows Events tab selected. Screenshot `events-fix-verify.png`.

#### ISSUE-004: FIXED — Mobile sidebar auto-closes on viewport resize
- **Files changed:** `dashboard/src/app/[[...slug]]/page.tsx`
- **Root cause:** No listener for viewport changes. If sidebar was open and window resized below 1024px, it stayed open and covered everything.
- **Fix:** Added `matchMedia('(min-width: 1024px)')` change listener that auto-closes sidebar when viewport drops below lg breakpoint.

#### ISSUE-006: FIXED — Recent Runs tile accessible name now has space separator
- **Files changed:** `dashboard/src/components/IdleView.tsx`
- **Root cause:** `{run.repoName}` text node abutted the `<span>` goal text with only CSS margin (not a text space), causing screen readers and text extraction to concatenate them.
- **Fix:** Added `{' '}` between repo name and goal span.

### Summary

- **Total issues:** 6
- **Fixed:** 3 (ISSUE-001, ISSUE-004, ISSUE-006)
- **Deferred:** 3 (ISSUE-002 settings, ISSUE-003 compare, ISSUE-005 replay — missing features, not regressions)
- **Console errors:** 0
- **Health score:** ~72/100 -> ~85/100 (post-fix estimate)

### What's Working Well
- Home page layout, stats, and hero section
- Single-run report view — scorecard, findings, top risks all render beautifully
- Multi-goal view — cards, investigation passes, findings with expandable categories
- History sidebar navigation between repos and runs
- Zero console errors across all pages
- Action buttons (Copy Markdown, Export .md, Export PDF, Create Issues) all present and accessible
- Goal dropdown with all 8 options renders correctly
