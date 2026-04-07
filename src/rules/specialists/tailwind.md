# Tailwind CSS Specialist Checklist

When investigating a project that uses Tailwind CSS, check each of the following areas systematically. Record findings with evidence for every item that applies.

## Content and Purge Configuration

- Check `tailwind.config` for the `content` array — verify that all template file paths are covered (components, pages, layouts, utility files that generate class names).
- Look for dynamically constructed class names (string concatenation or template literals building Tailwind classes) — these are invisible to the purge scanner and will be stripped in production.
- If using Tailwind v3+, verify the `content` paths use correct glob patterns. Missing paths cause styles to silently disappear in production builds.

## Custom Theme

- Check whether the project extends the default theme (`theme.extend`) or overrides it entirely (`theme`). Full overrides lose all default spacing, colors, and breakpoints.
- Look for design token consistency — are custom colors, spacing, and font sizes defined in the config or scattered as arbitrary values in components?
- Verify that shared design tokens (brand colors, spacing scale) are defined once in the config, not duplicated across components.

## Plugin Usage

- Check which Tailwind plugins are installed (`@tailwindcss/forms`, `@tailwindcss/typography`, `@tailwindcss/aspect-ratio`, `@tailwindcss/container-queries`).
- Verify that installed plugins are actually used — an unused plugin adds build overhead and configuration noise.
- If `@tailwindcss/typography` is installed, check that `prose` classes are applied to CMS-authored rich text content.

## Arbitrary Value Usage

- Search for excessive use of arbitrary values (`text-[14px]`, `p-[23px]`, `bg-[#1a2b3c]`) instead of theme tokens. Occasional use is fine; widespread use signals the theme config is incomplete.
- Check for arbitrary values that duplicate existing theme values — `p-[1rem]` when `p-4` exists, or `text-[#000]` when `text-black` exists.

## Dark Mode Strategy

- Check the `darkMode` configuration: `'class'` (manual toggle), `'media'` (system preference), or `'selector'` (Tailwind v3.4+).
- If dark mode is supported, verify that dark variants are applied consistently — check for components that have light styles but missing dark counterparts.
- Look for hardcoded colors that bypass the dark mode system (inline styles, CSS custom properties that don't update in dark mode).
