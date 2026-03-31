# Office Hours Q&A — 2026-03-31

## Context
- Project: repo-audit-delivery-agent
- Mode: Intrapreneurship (Startup mode)
- Stage: Pre-product (spec written, no code)

## Q1: Demand Reality

**Q:** What's the strongest evidence you have that someone actually wants this?
**A:** It's my bet. No external validation yet.

**Follow-up Q:** What specifically made you write this spec?
**A:** Just sees the opportunity. No specific incident or personal pain point.

**Assessment:** Two "it's my bet" answers. No validated demand yet. The spec may be solving the wrong problem or the right problem at the wrong altitude.

## Q2: Status Quo

**Q:** When someone at your org needs to understand a new Sitecore or Optimizely codebase today, what actually happens?
**A:** Senior devs spend days on it. Experienced engineers manually explore the repo and write up findings.

**Assessment:** First concrete signal. Senior dev time on manual repo audits = real cost. This is the friction to capture.

## Q3: Desperate Specificity

**Q:** Name the actual person who spends the most time doing these audits.
**A:** Can name the person.

**Follow-up Q:** Have you talked to that person about the pain points?
**A:** Revealed the real goal: "I want to demo this project mostly to show the Pi tool that underlies OpenClaw and see if I can get a working demo that could be valuable to the company."

**Assessment:** This is a demo vehicle for Pi/OpenClaw, not primarily an audit tool. The audience is leadership AND dev peers. The real deliverable is proving the agent runtime's capabilities by pointing it at a recognizable problem (headless CMS repo audits). Speed to demo matters more than production completeness.

## Premises (agreed)

1. Primary goal is a compelling demo of Pi/OpenClaw's agent capabilities, not a production audit tool.
2. Two audiences: leadership (business value) and devs (technical craft, want to use Pi themselves).
3. Current spec is more than needed for a convincing demo.
4. A working demo against a real repo is more compelling than a perfectly architected system that isn't finished.
5. If the demo lands, next step is validating with the person who actually does audits.

## Approach Selected

**B) Credible Demo** — Phase 1 + Phase 2 + Minimal Phase 3. All tools, consulting rules, Pi wiring with one goal type (onboarding). Skip Phase 4 CLI polish. Covers both Sitecore and Optimizely target repos. Estimated ~2-3 hours with CC+gstack.
