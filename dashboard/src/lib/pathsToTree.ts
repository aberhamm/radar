export interface FileNode {
  name: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  extension?: string;
}

/**
 * Convert a flat array of file paths into a nested FileNode tree.
 * Deduplicates paths and filters out bare directory entries (no extension, no dot in leaf).
 */
export function pathsToTree(paths: string[]): FileNode[] {
  // Deduplicate and normalise
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of paths) {
    const norm = raw.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!norm || norm === '.' || seen.has(norm)) continue;
    seen.add(norm);
    // Only include paths whose leaf segment looks like a file (has a dot/extension)
    const leaf = norm.split('/').pop()!;
    if (!leaf.includes('.')) continue;
    unique.push(norm);
  }

  const root: FileNode = { name: '', type: 'folder', children: [] };

  for (const norm of unique) {
    const parts = norm.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (isFile) {
        // Avoid duplicate file nodes at the same level
        if (!current.children!.some(c => c.type === 'file' && c.name === part)) {
          const ext = part.includes('.') ? part.split('.').pop() : undefined;
          current.children!.push({ name: part, type: 'file', extension: ext });
        }
      } else {
        let folder = current.children!.find(
          (c) => c.type === 'folder' && c.name === part,
        );
        if (!folder) {
          folder = { name: part, type: 'folder', children: [] };
          current.children!.push(folder);
        }
        current = folder;
      }
    }
  }

  // Sort: folders first, then alphabetical
  const sortNodes = (nodes: FileNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.children) sortNodes(n.children);
    }
  };
  sortNodes(root.children!);

  // Collapse single-child folder chains: "src" → "components" → files  ⇒  "src/components" → files
  const collapse = (nodes: FileNode[]): FileNode[] =>
    nodes.map((n) => {
      if (n.type === 'folder' && n.children) {
        n.children = collapse(n.children);
        if (n.children.length === 1 && n.children[0].type === 'folder') {
          const child = n.children[0];
          return { ...child, name: `${n.name}/${child.name}` };
        }
      }
      return n;
    });

  return collapse(root.children!);
}
