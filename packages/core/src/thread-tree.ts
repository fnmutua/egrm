export interface ThreadTreeNode<T extends ThreadTreeEntry> {
  entry: T;
  depth: number;
  children: ThreadTreeNode<T>[];
}

export interface ThreadTreeEntry {
  id: string;
  in_reply_to_id?: string | null;
  created_at?: string;
}

/** Build a nested thread from flat entries ordered by parent links. */
export function buildThreadTree<T extends ThreadTreeEntry>(entries: T[]): ThreadTreeNode<T>[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const childrenOf = new Map<string, T[]>();
  const roots: T[] = [];

  for (const entry of entries) {
    const parentId = entry.in_reply_to_id ?? null;
    if (parentId && byId.has(parentId)) {
      const list = childrenOf.get(parentId) ?? [];
      list.push(entry);
      childrenOf.set(parentId, list);
    } else {
      roots.push(entry);
    }
  }

  const sortByTime = (a: T, b: T) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''));

  const buildNode = (entry: T, depth: number): ThreadTreeNode<T> => ({
    entry,
    depth,
    children: (childrenOf.get(entry.id) ?? []).sort(sortByTime).map((child) => buildNode(child, depth + 1)),
  });

  return roots.sort(sortByTime).map((root) => buildNode(root, 0));
}
