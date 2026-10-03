/**
 * Text diff: pure functions, no DOM.
 *
 * Lines are compared with jsdiff's `diffLines`; the resulting change blocks are
 * flattened into one operation per line, and everything else (side-by-side rows,
 * inline rows, unified patch text) is derived from those operations. Word and
 * character granularity adds intra-line highlighting to changed lines.
 */
import { type Change, diffChars, diffLines, diffWordsWithSpace } from 'diff';

export class TextDiffError extends Error {
  override name = 'TextDiffError';
}

export type Granularity = 'lines' | 'words' | 'chars';

export interface DiffOptions {
  /** Unit used to highlight what changed inside a modified line. */
  granularity?: Granularity;
  /** Treat "Value" and "value" as the same text. */
  ignoreCase?: boolean;
  /** Trim each line and collapse runs of whitespace before comparing. */
  ignoreWhitespace?: boolean;
  /** Give up aligning after this many line edits (guards pathological inputs). */
  maxEditLength?: number;
}

/** Hard input cap for line and word comparison. */
export const MAX_CHARS = 2_000_000;
/** Character-by-character comparison is far more expensive; cap it much lower. */
export const MAX_CHARS_FOR_CHARACTERS = 100_000;
/** The UI stops painting rows here and shows a notice instead. */
export const MAX_RENDERED_ROWS = 5_000;
/** Default `maxEditLength` handed to jsdiff. */
export const DEFAULT_MAX_EDIT_LENGTH = 4_000;
/** Lines longer than this are not segmented word-by-word (slow and unreadable). */
export const MAX_SEGMENT_CHARS = 2_000;

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Remove a leading UTF-8 byte-order mark, if present. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Split into lines, tolerating a BOM, CRLF and lone-CR line endings. */
export function splitLines(text: string): string[] {
  const normalized = stripBom(text).replace(/\r\n?/g, '\n');
  if (normalized === '') return [];
  return normalized.replace(/\n$/, '').split('\n');
}

/** Apply the "ignore" options to a single line before it is compared. */
export function normalizeLine(
  line: string,
  options: Pick<DiffOptions, 'ignoreCase' | 'ignoreWhitespace'> = {},
): string {
  let out = line;
  if (options.ignoreWhitespace) out = out.trim().replace(/\s+/g, ' ');
  if (options.ignoreCase) out = out.toLowerCase();
  return out;
}

export function assertWithinLimits(
  original: string,
  changed: string,
  granularity: Granularity = 'lines',
): void {
  const limit = granularity === 'chars' ? MAX_CHARS_FOR_CHARACTERS : MAX_CHARS;
  const longest = Math.max(original.length, changed.length);
  if (longest <= limit) return;
  const side = original.length >= changed.length ? 'Original' : 'Changed';
  const size = longest.toLocaleString('en-US');
  const cap = limit.toLocaleString('en-US');
  throw new TextDiffError(
    granularity === 'chars'
      ? `${side} is ${size} characters. Character-by-character comparison is limited to ${cap}. Set "Compare by" to Lines or Words.`
      : `${side} is ${size} characters. The limit is ${cap}. Compare a smaller section.`,
  );
}

// ---------------------------------------------------------------------------
// Line operations
// ---------------------------------------------------------------------------

export type OpType = 'equal' | 'add' | 'del';

export interface LineOp {
  type: OpType;
  /** 1-based line number in the original text, or null for an addition. */
  oldLine: number | null;
  /** 1-based line number in the changed text, or null for a deletion. */
  newLine: number | null;
  /** Text on the original side (null for an addition). */
  oldText: string | null;
  /** Text on the changed side (null for a deletion). */
  newText: string | null;
}

export interface LineOpsResult {
  ops: LineOp[];
  /**
   * True when the two texts were too different to align within the edit budget,
   * so the result is a plain "delete everything, add everything" diff.
   */
  approximate: boolean;
}

function replaceAll(oldLines: readonly string[], newLines: readonly string[]): LineOp[] {
  const ops: LineOp[] = [];
  oldLines.forEach((text, index) => {
    ops.push({ type: 'del', oldLine: index + 1, newLine: null, oldText: text, newText: null });
  });
  newLines.forEach((text, index) => {
    ops.push({ type: 'add', oldLine: null, newLine: index + 1, oldText: null, newText: text });
  });
  return ops;
}

/** Flatten jsdiff's change blocks into one operation per line. */
export function buildLineOps(
  original: string,
  changed: string,
  options: DiffOptions = {},
): LineOpsResult {
  const oldLines = splitLines(original);
  const newLines = splitLines(changed);

  if (oldLines.length === 0 || newLines.length === 0) {
    return { ops: replaceAll(oldLines, newLines), approximate: false };
  }

  // Every line gets a trailing newline so the last line of one side is not
  // considered different from the same line of the other just because one text
  // ends without a line break.
  const normalize = (line: string) => normalizeLine(line, options);
  const changes: Change[] | undefined = diffLines(
    `${oldLines.map(normalize).join('\n')}\n`,
    `${newLines.map(normalize).join('\n')}\n`,
    { maxEditLength: options.maxEditLength ?? DEFAULT_MAX_EDIT_LENGTH },
  );

  if (!changes) return { ops: replaceAll(oldLines, newLines), approximate: true };

  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  for (const change of changes) {
    const count = change.count ?? 1;
    for (let k = 0; k < count; k++) {
      if (change.added) {
        ops.push({
          type: 'add',
          oldLine: null,
          newLine: j + 1,
          oldText: null,
          newText: newLines[j] ?? '',
        });
        j++;
      } else if (change.removed) {
        ops.push({
          type: 'del',
          oldLine: i + 1,
          newLine: null,
          oldText: oldLines[i] ?? '',
          newText: null,
        });
        i++;
      } else {
        ops.push({
          type: 'equal',
          oldLine: i + 1,
          newLine: j + 1,
          oldText: oldLines[i] ?? '',
          newText: newLines[j] ?? '',
        });
        i++;
        j++;
      }
    }
  }
  return { ops, approximate: false };
}

// ---------------------------------------------------------------------------
// Intra-line segments
// ---------------------------------------------------------------------------

export interface DiffSegment {
  text: string;
  kind: 'equal' | 'added' | 'removed';
}

export interface SegmentPair {
  left: DiffSegment[];
  right: DiffSegment[];
}

/**
 * Word- or character-level segments for a pair of lines that changed. Falls back
 * to a single unmarked segment for `lines` granularity and very long lines.
 */
export function diffSegments(
  oldText: string,
  newText: string,
  granularity: Granularity = 'lines',
  options: Pick<DiffOptions, 'ignoreCase'> = {},
): SegmentPair {
  if (
    granularity === 'lines' ||
    oldText.length > MAX_SEGMENT_CHARS ||
    newText.length > MAX_SEGMENT_CHARS
  ) {
    return {
      left: [{ text: oldText, kind: 'equal' }],
      right: [{ text: newText, kind: 'equal' }],
    };
  }

  const ignoreCase = options.ignoreCase === true;
  const parts =
    granularity === 'chars'
      ? diffChars(oldText, newText, { ignoreCase })
      : diffWordsWithSpace(oldText, newText, { ignoreCase });

  const left: DiffSegment[] = [];
  const right: DiffSegment[] = [];
  for (const part of parts) {
    if (part.added) right.push({ text: part.value, kind: 'added' });
    else if (part.removed) left.push({ text: part.value, kind: 'removed' });
    else {
      left.push({ text: part.value, kind: 'equal' });
      right.push({ text: part.value, kind: 'equal' });
    }
  }
  return { left, right };
}

// ---------------------------------------------------------------------------
// Side-by-side rows
// ---------------------------------------------------------------------------

export type RowKind = 'equal' | 'added' | 'removed' | 'changed';

export interface DiffCell {
  line: number;
  text: string;
  segments: DiffSegment[];
}

export interface DiffRow {
  kind: RowKind;
  left: DiffCell | null;
  right: DiffCell | null;
}

function plainCell(line: number, text: string): DiffCell {
  return { line, text, segments: [{ text, kind: 'equal' }] };
}

/** Pair each block of deletions with the additions that follow it. */
export function buildRows(ops: readonly LineOp[], options: DiffOptions = {}): DiffRow[] {
  const rows: DiffRow[] = [];
  const granularity = options.granularity ?? 'lines';
  let index = 0;

  while (index < ops.length) {
    const op = ops[index];
    if (!op) break;

    if (op.type === 'equal') {
      rows.push({
        kind: 'equal',
        left: plainCell(op.oldLine ?? 0, op.oldText ?? ''),
        right: plainCell(op.newLine ?? 0, op.newText ?? ''),
      });
      index++;
      continue;
    }

    const dels: LineOp[] = [];
    while (ops[index]?.type === 'del') {
      const current = ops[index];
      if (current) dels.push(current);
      index++;
    }
    const adds: LineOp[] = [];
    while (ops[index]?.type === 'add') {
      const current = ops[index];
      if (current) adds.push(current);
      index++;
    }

    const paired = Math.min(dels.length, adds.length);
    for (let k = 0; k < paired; k++) {
      const del = dels[k];
      const add = adds[k];
      if (!del || !add) continue;
      const oldText = del.oldText ?? '';
      const newText = add.newText ?? '';
      const segments = diffSegments(oldText, newText, granularity, options);
      rows.push({
        kind: 'changed',
        left: { line: del.oldLine ?? 0, text: oldText, segments: segments.left },
        right: { line: add.newLine ?? 0, text: newText, segments: segments.right },
      });
    }
    for (let k = paired; k < dels.length; k++) {
      const del = dels[k];
      if (!del) continue;
      rows.push({
        kind: 'removed',
        left: plainCell(del.oldLine ?? 0, del.oldText ?? ''),
        right: null,
      });
    }
    for (let k = paired; k < adds.length; k++) {
      const add = adds[k];
      if (!add) continue;
      rows.push({
        kind: 'added',
        left: null,
        right: plainCell(add.newLine ?? 0, add.newText ?? ''),
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Inline (unified) rows
// ---------------------------------------------------------------------------

export interface InlineRow {
  kind: 'equal' | 'added' | 'removed';
  sign: ' ' | '+' | '-';
  oldLine: number | null;
  newLine: number | null;
  text: string;
  segments: DiffSegment[];
}

/**
 * One column, deletions first, then the additions that replace them — the order
 * a unified diff uses. Paired lines keep their word/character highlighting.
 */
export function toInlineRows(ops: readonly LineOp[], options: DiffOptions = {}): InlineRow[] {
  const granularity = options.granularity ?? 'lines';
  const rows: InlineRow[] = [];
  let index = 0;

  while (index < ops.length) {
    const op = ops[index];
    if (!op) break;

    if (op.type === 'equal') {
      const text = op.oldText ?? '';
      rows.push({
        kind: 'equal',
        sign: ' ',
        oldLine: op.oldLine,
        newLine: op.newLine,
        text,
        segments: [{ text, kind: 'equal' }],
      });
      index++;
      continue;
    }

    const dels: LineOp[] = [];
    while (ops[index]?.type === 'del') {
      const current = ops[index];
      if (current) dels.push(current);
      index++;
    }
    const adds: LineOp[] = [];
    while (ops[index]?.type === 'add') {
      const current = ops[index];
      if (current) adds.push(current);
      index++;
    }

    const left: DiffSegment[][] = [];
    const right: DiffSegment[][] = [];
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const del = dels[k];
      const add = adds[k];
      if (!del || !add) continue;
      const pair = diffSegments(del.oldText ?? '', add.newText ?? '', granularity, options);
      left.push(pair.left);
      right.push(pair.right);
    }

    dels.forEach((del, k) => {
      const text = del.oldText ?? '';
      rows.push({
        kind: 'removed',
        sign: '-',
        oldLine: del.oldLine,
        newLine: null,
        text,
        segments: left[k] ?? [{ text, kind: 'equal' }],
      });
    });
    adds.forEach((add, k) => {
      const text = add.newText ?? '';
      rows.push({
        kind: 'added',
        sign: '+',
        oldLine: null,
        newLine: add.newLine,
        text,
        segments: right[k] ?? [{ text, kind: 'equal' }],
      });
    });
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
}

export interface DiffResult {
  ops: LineOp[];
  rows: DiffRow[];
  stats: DiffStats;
  /** True when neither side has a line the other lacks. */
  identical: boolean;
  /** True when the texts were too different to align and were fully replaced. */
  approximate: boolean;
}

export function computeDiff(
  original: string,
  changed: string,
  options: DiffOptions = {},
): DiffResult {
  const granularity = options.granularity ?? 'lines';
  assertWithinLimits(original, changed, granularity);

  const { ops, approximate } = buildLineOps(original, changed, options);
  const rows = buildRows(ops, { ...options, granularity });
  const stats: DiffStats = {
    additions: ops.filter((op) => op.type === 'add').length,
    deletions: ops.filter((op) => op.type === 'del').length,
    unchanged: ops.filter((op) => op.type === 'equal').length,
  };
  return {
    ops,
    rows,
    stats,
    identical: stats.additions === 0 && stats.deletions === 0,
    approximate,
  };
}

/** "3 additions · 1 deletion" — the stats line under the diff. */
export function formatStats(stats: DiffStats): string {
  const plural = (n: number, word: string) =>
    `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(stats.additions, 'addition')} · ${plural(stats.deletions, 'deletion')} · ${plural(stats.unchanged, 'unchanged line')}`;
}

// ---------------------------------------------------------------------------
// Unified diff text
// ---------------------------------------------------------------------------

export interface UnifiedDiffOptions extends DiffOptions {
  /** Name used after `--- a/`. */
  oldName?: string;
  /** Name used after `+++ b/`. */
  newName?: string;
  /** Unchanged lines kept around each hunk (default 3). */
  context?: number;
}

/**
 * Render the diff as a standard unified patch (`--- a/…`, `+++ b/…`, `@@ … @@`),
 * the format `git apply` and `patch` understand. Returns an empty string when
 * the two texts are the same.
 */
export function toUnifiedDiff(
  original: string,
  changed: string,
  options: UnifiedDiffOptions = {},
): string {
  const context = Math.max(0, options.context ?? 3);
  const { ops } = buildLineOps(original, changed, options);

  const changedIndexes: number[] = [];
  ops.forEach((op, index) => {
    if (op.type !== 'equal') changedIndexes.push(index);
  });
  if (changedIndexes.length === 0) return '';

  // Lines of each side that appear before a given op index.
  const oldBefore = new Array<number>(ops.length + 1).fill(0);
  const newBefore = new Array<number>(ops.length + 1).fill(0);
  ops.forEach((op, index) => {
    oldBefore[index + 1] = (oldBefore[index] ?? 0) + (op.oldLine === null ? 0 : 1);
    newBefore[index + 1] = (newBefore[index] ?? 0) + (op.newLine === null ? 0 : 1);
  });

  const groups: { start: number; end: number }[] = [];
  for (const index of changedIndexes) {
    const last = groups.at(-1);
    if (last && index - last.end <= context * 2) last.end = index;
    else groups.push({ start: index, end: index });
  }

  const lines: string[] = [
    `--- a/${options.oldName ?? 'original.txt'}`,
    `+++ b/${options.newName ?? 'changed.txt'}`,
  ];

  for (const group of groups) {
    const start = Math.max(0, group.start - context);
    const end = Math.min(ops.length - 1, group.end + context);
    const slice = ops.slice(start, end + 1);

    const oldCount = slice.filter((op) => op.oldLine !== null).length;
    const newCount = slice.filter((op) => op.newLine !== null).length;
    const oldStart =
      oldCount === 0
        ? (oldBefore[start] ?? 0)
        : (slice.find((op) => op.oldLine !== null)?.oldLine ?? 1);
    const newStart =
      newCount === 0
        ? (newBefore[start] ?? 0)
        : (slice.find((op) => op.newLine !== null)?.newLine ?? 1);

    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);
    for (const op of slice) {
      if (op.type === 'add') lines.push(`+${op.newText ?? ''}`);
      else if (op.type === 'del') lines.push(`-${op.oldText ?? ''}`);
      else lines.push(` ${op.oldText ?? ''}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Sample
// ---------------------------------------------------------------------------

export const SAMPLE_ORIGINAL = [
  'server {',
  '  listen 80;',
  '  server_name example.com;',
  '  root /var/www/html;',
  '',
  '  location /api/ {',
  '    proxy_pass http://127.0.0.1:3000;',
  '    proxy_read_timeout 30s;',
  '  }',
  '}',
].join('\n');

export const SAMPLE_CHANGED = [
  'server {',
  '  listen 443 ssl;',
  '  server_name example.com www.example.com;',
  '  root /var/www/html;',
  '  ssl_certificate /etc/ssl/example.pem;',
  '',
  '  location /api/ {',
  '    proxy_pass http://127.0.0.1:4000;',
  '    proxy_read_timeout 60s;',
  '  }',
  '}',
].join('\n');
