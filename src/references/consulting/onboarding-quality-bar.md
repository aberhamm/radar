# Onboarding Brief Quality Bar

## What a good onboarding brief does

A new consultant should be able to read the brief and:
1. Understand what the project does in 2 minutes
2. Know which files to look at first in 5 minutes
3. Have a local development environment running in 30 minutes
4. Understand the CMS integration well enough to have an informed conversation with the client

## Quality checklist

### Project overview
- [ ] States what the project is (not just "a Next.js app")
- [ ] Names the CMS platform and how it's integrated
- [ ] Mentions the deployment target if detectable
- [ ] Written for someone who has never seen this repo

### Key files table
- [ ] At least 10 files listed
- [ ] Includes the CMS integration files (not just generic Next.js files)
- [ ] "Why it matters" column has real value (not just "this is a config file")
- [ ] Files are ordered by importance, not alphabetically

### CMS integration explanation
- [ ] Explains the data flow: CMS → API → rendering host → user
- [ ] Names specific files where the integration happens
- [ ] Distinguishes between preview/editing and production flows

### Local setup steps
- [ ] Based on what's actually in the repo (not generic instructions)
- [ ] Lists required environment variables
- [ ] Mentions any prerequisites (Node version, CMS access needed)
- [ ] Includes the actual commands to run

### Questions for the client
- [ ] 8-12 questions
- [ ] Questions demonstrate knowledge of the repo (not generic)
- [ ] Mix of architectural, operational, and strategic questions
- [ ] Questions the client would be impressed by (shows we did our homework)

## Red flags in briefs

- Generic observations that could apply to any Next.js project
- Missing CMS-specific analysis
- "Run npm install and npm run dev" without checking what's actually in package.json
- Questions that could be answered by reading the repo (don't ask what we should already know)
- Missing evidence for findings (no file paths, no code snippets)
