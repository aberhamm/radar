import fs from 'node:fs';
import path from 'node:path';
import type {
  GetSpecialistPromptsInput,
  GetSpecialistPromptsOutput,
  SpecialistPrompt,
  AppRoot,
} from '../../types/tools.js';

/**
 * Directory containing specialist rule markdown files.
 * Resolved relative to this file's location (src/tools/analysis/ -> src/rules/specialists/).
 */
const SPECIALISTS_DIR = path.resolve(import.meta.dirname, '..', '..', 'rules', 'specialists');

/** Mapping from stack characteristics to specialist file and metadata. */
interface SpecialistMapping {
  id: string;
  name: string;
  file: string;
  relevance: 'high' | 'medium' | 'low';
  match: (root: AppRoot) => boolean;
}

const SPECIALIST_MAPPINGS: SpecialistMapping[] = [
  {
    id: 'nextjs',
    name: 'Next.js',
    file: 'nextjs.md',
    relevance: 'high',
    match: (root) => root.type === 'nextjs',
  },
  {
    id: 'graphql',
    name: 'GraphQL',
    file: 'graphql.md',
    relevance: 'high',
    match: (root) => root.plugins?.includes('graphql') ?? false,
  },
  {
    id: 'prisma',
    name: 'Prisma',
    file: 'prisma.md',
    relevance: 'high',
    match: (root) => root.plugins?.includes('prisma') ?? false,
  },
  {
    id: 'tailwind',
    name: 'Tailwind CSS',
    file: 'tailwind.md',
    relevance: 'medium',
    match: (root) => root.plugins?.includes('tailwind') ?? false,
  },
  {
    id: 'cms-sitecore',
    name: 'Sitecore JSS',
    file: 'cms-sitecore.md',
    relevance: 'high',
    match: (root) => root.plugins?.includes('sitecore-jss') ?? false,
  },
  {
    id: 'cms-optimizely',
    name: 'Optimizely CMS',
    file: 'cms-optimizely.md',
    relevance: 'high',
    match: (root) => root.plugins?.includes('optimizely-cms') ?? false,
  },
];

/**
 * Given detect_app_roots output, returns targeted investigation checklists
 * for the detected stack (Next.js, GraphQL, Prisma, Tailwind, Sitecore, Optimizely).
 *
 * Deterministic: reads markdown files from disk, no LLM calls.
 */
export async function getSpecialistPrompts(
  input: GetSpecialistPromptsInput,
): Promise<GetSpecialistPromptsOutput> {
  const matched = new Set<string>();
  const specialists: SpecialistPrompt[] = [];

  for (const mapping of SPECIALIST_MAPPINGS) {
    if (matched.has(mapping.id)) continue;

    const isMatch = input.roots.some((root) => mapping.match(root));
    if (!isMatch) continue;

    const filePath = path.join(SPECIALISTS_DIR, mapping.file);
    let checklist: string;
    try {
      checklist = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // Specialist file missing — skip silently
      continue;
    }

    matched.add(mapping.id);
    specialists.push({
      id: mapping.id,
      name: mapping.name,
      relevance: mapping.relevance,
      checklist,
    });
  }

  // Sort by relevance: high first, then medium, then low
  const relevanceOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  specialists.sort((a, b) => relevanceOrder[a.relevance] - relevanceOrder[b.relevance]);

  const names = specialists.map((s) => s.name);
  const summary = specialists.length > 0
    ? `Loaded ${specialists.length} specialist checklist(s): ${names.join(', ')}.`
    : 'No specialist checklists matched the detected stack.';

  return { specialists, summary };
}
