/**
 * Line tools: pure functions, no DOM. A small pipeline of cleanup, dedupe and sort steps
 * applied to a list of lines. Used by the Remove Duplicate Lines and Sort Lines pages.
 */

export type DedupeMode = 'off' | 'unique' | 'duplicates-only' | 'count';
export type KeepWhich = 'first' | 'last';
export type SortMode = 'off' | 'az' | 'za' | 'natural' | 'natural-desc' | 'length' | 'length-desc' | 'reverse' | 'shuffle';
export type Sensitivity = 'base' | 'accent' | 'case' | 'variant';

export interface LineOptions {
  // cleanup
  trim: boolean;
  removeEmpty: boolean;
  // dedupe
  dedupe: DedupeMode;
  ignoreCase: boolean;
  /** Compare lines after trimming whitespace (output keeps the original line unless trim is on). */
  trimCompare: boolean;
  keep: KeepWhich;
  // sort
  sort: SortMode;
  sortIgnoreCase: boolean;
  /** Use Intl.Collator for locale-aware ordering of accented letters. */
  locale: boolean;
  sensitivity: Sensitivity;
  /** Sort by a column: 0 means the whole line, 1-based otherwise. */
  column: number;
  delimiter: string;
  seed: number;
  // decorate
  lineNumbers: boolean;
  prefix: string;
  suffix: string;
}

export const DEFAULT_OPTIONS: LineOptions = {
  trim: false,
  removeEmpty: false,
  dedupe: 'unique',
  ignoreCase: false,
  trimCompare: true,
  keep: 'first',
  sort: 'off',
  sortIgnoreCase: true,
  locale: true,
  sensitivity: 'base',
  column: 0,
  delimiter: ',',
  seed: 1,
  lineNumbers: false,
  prefix: '',
  suffix: '',
};

export interface LineResult {
  lines: string[];
  inputCount: number;
  outputCount: number;
  duplicatesRemoved: number;
  emptyRemoved: number;
  /** Distinct values that occurred more than once. */
  duplicateGroups: number;
}

/** Split text into lines, tolerating CRLF and a trailing newline. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function joinLines(lines: readonly string[]): string {
  return lines.length ? lines.join('\n') + '\n' : '';
}

function keyOf(line: string, o: Pick<LineOptions, 'ignoreCase' | 'trimCompare'>): string {
  let k = o.trimCompare ? line.trim() : line;
  if (o.ignoreCase) k = k.toLocaleLowerCase();
  return k;
}

/** Dedupe according to the mode. Returns the new lines and counts. */
export function dedupeLines(lines: readonly string[], o: Pick<LineOptions, 'dedupe' | 'ignoreCase' | 'trimCompare' | 'keep'>): { lines: string[]; removed: number; groups: number } {
  if (o.dedupe === 'off') return { lines: [...lines], removed: 0, groups: 0 };
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(keyOf(l, o), (counts.get(keyOf(l, o)) ?? 0) + 1);
  const groups = [...counts.values()].filter((n) => n > 1).length;

  if (o.dedupe === 'count') {
    const first = new Map<string, string>();
    for (const l of lines) if (!first.has(keyOf(l, o))) first.set(keyOf(l, o), l);
    const rows = [...first.entries()].map(([k, l], i) => ({ n: counts.get(k) ?? 0, l, i }));
    rows.sort((a, b) => b.n - a.n || a.i - b.i);
    return { lines: rows.map((r) => `${r.n}\t${r.l}`), removed: lines.length - rows.length, groups };
  }
  if (o.dedupe === 'duplicates-only') {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const l of lines) {
      const k = keyOf(l, o);
      if ((counts.get(k) ?? 0) > 1 && !seen.has(k)) {
        seen.add(k);
        out.push(l);
      }
    }
    return { lines: out, removed: lines.length - out.length, groups };
  }
  // unique
  const out: string[] = [];
  if (o.keep === 'first') {
    const seen = new Set<string>();
    for (const l of lines) {
      const k = keyOf(l, o);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(l);
    }
  } else {
    const seen = new Set<string>();
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!;
      const k = keyOf(l, o);
      if (seen.has(k)) continue;
      seen.add(k);
      out.unshift(l);
    }
  }
  return { lines: out, removed: lines.length - out.length, groups };
}

/** The part of a line used for sorting: the whole line or one delimited column. */
export function sortKey(line: string, column: number, delimiter: string): string {
  if (column <= 0) return line;
  const d = delimiter === '\\t' ? '\t' : delimiter || ',';
  return (line.split(d)[column - 1] ?? '').trim();
}

/** Mulberry32: a tiny seeded PRNG so shuffles are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Natural comparison: runs of digits compare as numbers (file2 before file10), and a
 * line that is entirely a number (with sign and decimals) compares numerically.
 */
export function naturalCompare(a: string, b: string, ignoreCase = true): number {
  const num = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i;
  if (num.test(a) && num.test(b)) return Number(a) - Number(b) || 0;
  const x = ignoreCase ? a.toLocaleLowerCase() : a;
  const y = ignoreCase ? b.toLocaleLowerCase() : b;
  const re = /(\d+|\D+)/g;
  const xs = x.match(re) ?? [];
  const ys = y.match(re) ?? [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const p = xs[i]!;
    const q = ys[i]!;
    if (p === q) continue;
    const pd = /^\d/.test(p);
    const qd = /^\d/.test(q);
    if (pd && qd) {
      const diff = Number(p) - Number(q);
      if (diff !== 0) return diff;
      if (p.length !== q.length) return p.length - q.length;
      continue;
    }
    return p < q ? -1 : 1;
  }
  return xs.length - ys.length;
}

export function sortLines(lines: readonly string[], o: Pick<LineOptions, 'sort' | 'sortIgnoreCase' | 'locale' | 'sensitivity' | 'column' | 'delimiter' | 'seed'>): string[] {
  const out = [...lines];
  if (o.sort === 'off') return out;
  if (o.sort === 'reverse') return out.reverse();
  if (o.sort === 'shuffle') {
    const rnd = seededRandom(o.seed);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
  const key = (l: string) => sortKey(l, o.column, o.delimiter);
  const sensitivity: Sensitivity = o.sortIgnoreCase ? o.sensitivity : 'variant';
  const collator = new Intl.Collator(undefined, { sensitivity, numeric: o.sort.startsWith('natural') });
  const text = (a: string, b: string): number => {
    if (o.locale) return collator.compare(a, b);
    const x = o.sortIgnoreCase ? a.toLowerCase() : a;
    const y = o.sortIgnoreCase ? b.toLowerCase() : b;
    return x < y ? -1 : x > y ? 1 : 0;
  };
  const indexed = out.map((l, i) => ({ l, i, k: key(l) }));
  let cmp: (a: (typeof indexed)[number], b: (typeof indexed)[number]) => number;
  switch (o.sort) {
    case 'az':
      cmp = (a, b) => text(a.k, b.k);
      break;
    case 'za':
      cmp = (a, b) => text(b.k, a.k);
      break;
    case 'natural':
      cmp = (a, b) => naturalCompare(a.k, b.k, o.sortIgnoreCase);
      break;
    case 'natural-desc':
      cmp = (a, b) => naturalCompare(b.k, a.k, o.sortIgnoreCase);
      break;
    case 'length':
      cmp = (a, b) => a.k.length - b.k.length || text(a.k, b.k);
      break;
    case 'length-desc':
      cmp = (a, b) => b.k.length - a.k.length || text(a.k, b.k);
      break;
    default:
      cmp = () => 0;
  }
  indexed.sort((a, b) => cmp(a, b) || a.i - b.i);
  return indexed.map((x) => x.l);
}

/** Run the whole pipeline: cleanup, dedupe, sort, decorate. */
export function processLines(text: string, o: LineOptions): LineResult {
  const input = splitLines(text);
  let lines = o.trim ? input.map((l) => l.trim()) : [...input];
  let emptyRemoved = 0;
  if (o.removeEmpty) {
    const before = lines.length;
    lines = lines.filter((l) => l.trim() !== '');
    emptyRemoved = before - lines.length;
  }
  const d = dedupeLines(lines, o);
  lines = d.lines;
  // In count mode the line carries a "count\t" prefix; sort by the original line part.
  if (o.dedupe !== 'count') lines = sortLines(lines, o);
  if (o.prefix || o.suffix) lines = lines.map((l) => `${o.prefix}${l}${o.suffix}`);
  if (o.lineNumbers) {
    const width = String(lines.length).length;
    lines = lines.map((l, i) => `${String(i + 1).padStart(width, ' ')}. ${l}`);
  }
  return { lines, inputCount: input.length, outputCount: lines.length, duplicatesRemoved: o.dedupe === 'off' ? 0 : d.removed, emptyRemoved, duplicateGroups: d.groups };
}

export const SAMPLE_DEDUPE = `alice@example.com
bob@example.com
Carol@Example.com
alice@example.com
  dave@example.com
carol@example.com

bob@example.com
erin@example.com
dave@example.com
`;

export const SAMPLE_SORT = `file10.txt
file2.txt
File1.txt
zebra.png
Äpfel.csv
apple.csv
file20.txt
-3.5
42
7
`;
