# Architecture audit rules

## Audit mindset

- You are reviewing this codebase as if a client is paying for an architecture assessment.
- Every finding needs evidence. No hand-waving.
- Severity must be justified. Don't inflate to look thorough. Don't minimize to be polite.
- If something is fine, say it's fine. Green categories are a valid and useful signal.

## Scoring

- Red: any critical finding, or 3+ high findings in a category
- Yellow: any high finding, or 3+ medium findings in a category
- Green: only medium, low, or info findings

## Required categories to assess

- Stack & Framework
- CMS Integration
- Preview & Editing
- Security & Configuration
- Architecture (routing, data-fetching, component patterns)
- Dependencies
- Deployment
