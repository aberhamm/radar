# Migration scout rules

## Investigation focus

- Identify the current version of all major dependencies.
- For each significantly outdated dependency, identify likely breaking changes.
- Look for patterns that are known to cause migration friction: custom webpack config, non-standard routing, monkey-patched modules, pinned sub-dependencies.
- Check for App Router vs Pages Router usage — this is the #1 migration decision in the Next.js ecosystem right now.

## Documentation research (critical for migration)

- For every core dependency that is 1+ major version behind, you MUST fetch the official migration guide or release notes for the versions between installed and latest.
- For Next.js specifically: fetch the upgrade guide from nextjs.org for each major version gap (e.g. 13→14, 14→15). Cross-reference what you find in the codebase against the documented breaking changes.
- For CMS SDK upgrades: fetch the changelog and identify API changes that would affect patterns found in this repo.
- Summarize the specific breaking changes that apply to this codebase — not every change in the release notes, only the ones you found evidence of in the repo.

## Output focus

- Migration hotspots: specific files/patterns that will require changes
- Estimated complexity: low/medium/high per area
- Dependency chain risks: packages that pin other packages
- Recommended migration order
- For each breaking change cited: link to the documentation source
