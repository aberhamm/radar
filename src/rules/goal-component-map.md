# Component Map Rules

You are producing a structured component inventory for this project. Your goal is to map every component: its file path, CMS content type binding, client/server directive, and data fetching pattern.

## Scorecard Categories

You MUST investigate and record findings for ALL of these categories:

1. **Stack & Framework** — framework version, rendering model (App Router vs Pages Router), component registration pattern
2. **CMS Integration** — how components bind to CMS content types, mapping files, factory patterns, auto-generated vs manual registration
3. **Preview & Editing** — which components support inline editing, experience editor, or visual builder; which are static-only
4. **Architecture** — component hierarchy, shared layout patterns, slot/placeholder usage, component composition depth
5. **Dependencies** — third-party component libraries, UI kits, design system packages
6. **Deployment** — build-time vs runtime component resolution, dynamic imports, code splitting boundaries

## Investigation Approach

Start broad, then go deep:
1. **Detect app roots** — use `detect_app_roots` to find all applications in monorepos
2. **Scan component directories** — use `list_directory` on `src/components/`, `components/`, `app/`, `pages/` and similar
3. **Identify registration patterns** — use `grep_pattern` to find component maps, factory registrations, dynamic imports
4. **Check directives** — use `analyze_component_directives` to classify client vs server components
5. **Trace CMS bindings** — use `grep_pattern` for content type names, rendering IDs, component props interfaces
6. **Check data fetching** — for each major component, identify whether it fetches data (server component, getStaticProps, useSWR, etc.)

## Required Tools

Use these tools systematically:
- `detect_app_roots` — find all app entry points
- `list_directory` — enumerate component directories
- `analyze_component_directives` — classify 'use client' / 'use server' / default
- `grep_pattern` — search for component registration, CMS type bindings, dynamic imports
- `read_file` — read key components to understand data flow
- `parse_package_json` — identify UI library dependencies

## Findings

Record findings using `record_finding` with these categories:
- `architecture` — component hierarchy, composition patterns, slot/placeholder usage
- `cms-integration` — CMS binding patterns, content type mappings
- `preview-editing` — editing support per component
- `stack` — framework patterns, directives, rendering model
- `dependencies` — UI libraries, design system packages
- `routing` — page-level components, layout components, route segments

Severity guidelines:
- **critical** — broken or missing component registration that prevents rendering
- **high** — components with no CMS binding that should have one, orphaned components
- **medium** — inconsistent patterns (some components use factory, others use direct import)
- **low** — minor: naming conventions, missing TypeScript types on props
- **info** — inventory entries for well-structured components (use liberally — this goal is primarily informational)

## Output Format

When calling `assemble_output`, write these sections:
- `executive_summary` — 2-3 sentence overview of component architecture
- `component_inventory` — table: path, type (page/layout/feature/ui), CMS binding, directive, data fetching
- `registration_patterns` — how components are discovered and rendered by the framework/CMS
- `cms_binding_map` — which components map to which CMS content types
- `data_flow` — how data moves from CMS → component props → rendered output
- `recommendations` — improvements to component organization, missing bindings, pattern inconsistencies

## Finding Expectations

- Minimum 10 findings for any non-trivial project. Most projects have 15-25 components worth documenting.
- Use `info` severity for healthy inventory entries. This goal is primarily a mapping exercise.
- At least 2-3 findings should be `medium` or higher — inconsistencies and gaps always exist.
- Every scorecard category should have at least 1 finding.
