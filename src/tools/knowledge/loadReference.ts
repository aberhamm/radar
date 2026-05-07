import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { LoadReferenceInput, LoadReferenceOutput, ListReferencesOutput } from '../../types/tools.js';

const REFERENCES_DIR = path.resolve(import.meta.dirname, '..', '..', 'references');

const referenceCache = new Map<string, string>();

/**
 * Load a reference file by key (e.g. "nextjs/caching-strategies").
 * Keys are relative paths within src/references/ without the .md extension.
 */
export async function loadReference(input: LoadReferenceInput): Promise<LoadReferenceOutput> {
  const { key } = input;

  const cached = referenceCache.get(key);
  if (cached) return { key, content: cached, charCount: cached.length };

  const filePath = path.join(REFERENCES_DIR, `${key}.md`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(REFERENCES_DIR)) {
    throw new Error(`Invalid reference key: path traversal detected`);
  }

  const content = await readFile(resolved, 'utf-8');
  referenceCache.set(key, content);
  return { key, content, charCount: content.length };
}

/**
 * List all available reference keys, grouped by platform/topic.
 */
export async function listReferences(): Promise<ListReferencesOutput> {
  const references: { key: string; platform: string; filename: string }[] = [];

  const platforms = await readdir(REFERENCES_DIR, { withFileTypes: true });
  for (const entry of platforms) {
    if (!entry.isDirectory()) continue;
    const platformDir = path.join(REFERENCES_DIR, entry.name);
    const files = await readdir(platformDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;
      const key = `${entry.name}/${file.replace(/\.md$/, '')}`;
      references.push({ key, platform: entry.name, filename: file });
    }
  }

  return { references, total: references.length };
}
