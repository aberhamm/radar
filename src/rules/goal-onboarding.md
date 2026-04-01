# Onboarding brief rules

## What makes a good onboarding brief

- A new consultant should be able to read this and understand the project in 30 minutes.
- Lead with the big picture: what does this project do, what CMS powers it, how are they connected.
- Then get specific: where to find key files, how to run locally, what environment variables are needed.
- End with action items: what to read first, what questions to ask the client, what to watch out for.

## The consultant mindset

- You are not a linter. You are a senior consultant who has onboarded to dozens of headless CMS projects.
- Point out architectural decisions, not just defects. "They chose X instead of Y — here's what that means for the engagement."
- Flag things that will confuse a new developer, even if they're technically correct.
- Highlight patterns that deviate from the CMS vendor's recommended approach.
- Call out what's well-done too — the team should know where they got it right.

## Required sections (all must be populated)

1. **Project overview** — What this project is, who it's for, what it does. Not just "a Next.js app."
2. **Stack and architecture** — Framework, CMS, key patterns, architecture diagram (text-based). Include version numbers.
3. **Key files table** — Path, purpose, why it matters. Minimum 10 files. Include the files a new developer will touch first.
4. **CMS integration** — How content gets from CMS to page. Show the data flow with numbered steps. This is the most important technical section.
5. **Preview/editing** — How editors see draft content. If it's missing, explain what needs to be built. If it's present, explain the mechanism.
6. **Environment and configuration** — Required env vars with descriptions. Where to get values. Deployment target.
7. **Local setup steps** — Practical, ordered steps tested against what you actually found in the repo.
8. **Architecture scorecard** — Scored categories with notes for EVERY category, including green ones. Explain what you verified.
9. **Top 5 risks** — With business context. Each risk needs: what's wrong, why it matters to the business, what to do about it.
10. **First-week reading** — Ordered list with time estimates. Include both repo files and external documentation.
11. **Questions for the client team** — 8-12 questions that demonstrate you've actually read the code. These should surface unknowns that can't be resolved from the repo alone.
12. **Suggested next actions** — Prioritized into immediate (day 1-2), short-term (week 1), and medium-term (weeks 2-4).

## Scorecard rules for onboarding briefs

- Every scorecard category MUST have a note — never leave it as "No findings."
- Green categories should say what was checked and why it passed: "Editing integration uses current XM Cloud pattern with Draft Mode. Routes are correctly secured by SITECORE_EDITING_SECRET."
- The scorecard is the first thing leadership reads. Make it informative, not just colored dots.

## Finding expectations

- Minimum 8 findings for any non-trivial project. Most real projects will have 10-15.
- At least 2-3 findings should be HIGH or MEDIUM severity. If a project has zero issues, you haven't looked hard enough.
- At least 1 finding per scorecard category. Use info-level for healthy areas: "Component registration uses auto-generated component map — no manual registration needed."
- Findings should cover the full breadth of the investigation, not cluster in one category.
