/**
 * Structural diff between two JSON values for the Compare feature.
 * Arrays are compared by index. The result lists every differing path once, with the
 * class to paint on the left and on the right side.
 */
export type JSONPath = string[];

export type DiffKind = 'added' | 'removed' | 'changed';

export interface DiffEntry {
  path: JSONPath;
  kind: DiffKind;
}

export interface DiffResult {
  entries: DiffEntry[];
  /** JSON.stringify(path) -> class name, for the left editor. */
  left: Map<string, string>;
  /** Same for the right editor. */
  right: Map<string, string>;
}

const MAX_ENTRIES = 2000;

export function diffJson(a: unknown, b: unknown): DiffResult {
  const entries: DiffEntry[] = [];
  const left = new Map<string, string>();
  const right = new Map<string, string>();

  const mark = (path: JSONPath, kind: DiffKind) => {
    if (entries.length >= MAX_ENTRIES) return;
    entries.push({ path, kind });
    const key = JSON.stringify(path);
    if (kind === 'removed' || kind === 'changed') left.set(key, `cuis-diff-${kind}`);
    if (kind === 'added' || kind === 'changed') right.set(key, `cuis-diff-${kind}`);
    // Ancestors get a subtle marker so collapsed branches reveal that something differs inside.
    for (let i = path.length - 1; i > 0; i--) {
      const k = JSON.stringify(path.slice(0, i));
      if (!left.has(k)) left.set(k, 'cuis-diff-parent');
      if (!right.has(k)) right.set(k, 'cuis-diff-parent');
    }
  };

  const walk = (x: unknown, y: unknown, path: JSONPath) => {
    if (entries.length >= MAX_ENTRIES) return;
    const tx = typeOf(x);
    const ty = typeOf(y);
    if (tx !== ty) return mark(path, 'changed');
    if (tx === 'array') {
      const ax = x as unknown[];
      const ay = y as unknown[];
      const n = Math.max(ax.length, ay.length);
      for (let i = 0; i < n; i++) {
        if (i >= ax.length) mark([...path, String(i)], 'added');
        else if (i >= ay.length) mark([...path, String(i)], 'removed');
        else walk(ax[i], ay[i], [...path, String(i)]);
      }
      return;
    }
    if (tx === 'object') {
      const ox = x as Record<string, unknown>;
      const oy = y as Record<string, unknown>;
      for (const k of Object.keys(ox)) {
        if (!(k in oy)) mark([...path, k], 'removed');
        else walk(ox[k], oy[k], [...path, k]);
      }
      for (const k of Object.keys(oy)) if (!(k in ox)) mark([...path, k], 'added');
      return;
    }
    if (x !== y) mark(path, 'changed');
  };

  walk(a, b, []);
  return { entries, left, right };
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
