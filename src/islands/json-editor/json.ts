/**
 * JSON helpers shared by the editor modes. Pure functions, unit-testable, no DOM.
 */

export interface JsonError {
  message: string;
  /** 1-based */
  line: number;
  /** 1-based */
  column: number;
  /** 0-based character offset */
  offset: number;
  hint?: string;
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: JsonError };

export function parseJson(text: string): ParseResult {
  if (!text.trim()) {
    return { ok: false, error: { message: 'Input is empty', line: 1, column: 1, offset: 0 } };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: describeError(text, e as Error) };
  }
}

/** Turn a native SyntaxError into a line/column error with a plain-English hint. */
function describeError(text: string, e: Error): JsonError {
  const msg = e.message || 'Invalid JSON';
  let offset = -1;

  // V8: "Unexpected token } in JSON at position 42" / "... (line 3 column 5)"
  const pos = /position (\d+)/i.exec(msg);
  if (pos) offset = Number(pos[1]);
  const lc = /line (\d+) column (\d+)/i.exec(msg);
  if (lc) {
    const line = Number(lc[1]);
    const column = Number(lc[2]);
    return { message: cleanMessage(msg), line, column, offset: offsetOf(text, line, column), hint: hintFor(text, offsetOf(text, line, column), msg) };
  }
  if (offset < 0) {
    // Firefox/Safari give no position. Find the first offending char by bisection.
    offset = locateByBisection(text);
  }
  offset = Math.min(Math.max(offset, 0), text.length);
  const { line, column } = lineColumnOf(text, offset);
  return { message: cleanMessage(msg), line, column, offset, hint: hintFor(text, offset, msg) };
}

function cleanMessage(msg: string): string {
  return msg
    .replace(/^JSON\.parse:\s*/i, '')
    .replace(/ in JSON at position \d+.*$/i, '')
    .replace(/\s+at position \d+/i, '')
    .replace(/\s+after JSON$/i, ' after the end of the document')
    .replace(/\s*\(line \d+ column \d+\)/i, '')
    .replace(/^Unexpected token '?(.)'?/, (_, t) => `Unexpected character "${t}"`)
    .trim();
}

function hintFor(text: string, offset: number, raw: string): string | undefined {
  const before = text.slice(Math.max(0, offset - 40), offset);
  const at = text[offset] ?? '';
  if (/,\s*$/.test(before) && (at === '}' || at === ']')) return 'Remove the trailing comma before the closing bracket.';
  if (at === "'" || /'[^']*'\s*:/.test(before + at)) return 'JSON strings must use double quotes, not single quotes.';
  if (/[{,]\s*[A-Za-z_$][\w$]*\s*$/.test(before + at)) return 'Property names must be wrapped in double quotes.';
  if (/\/\/|\/\*/.test(before + at)) return 'Comments are not allowed in JSON.';
  if (/end of (JSON )?input|Unexpected end/i.test(raw)) return 'The document ends early. Check for a missing closing } or ].';
  if (/\b(undefined|NaN|Infinity)\b/.test(before + text.slice(offset, offset + 10))) return 'undefined, NaN and Infinity are not valid JSON values. Use null or a number.';
  if (/[}\]]\s*[{\[]|"\s*"/.test(before + at)) return 'Two values are next to each other. A comma is probably missing.';
  return undefined;
}

function lineColumnOf(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i + 1;
    }
  }
  return { line, column: offset - last + 1 };
}

function offsetOf(text: string, line: number, column: number): number {
  let l = 1;
  let i = 0;
  while (l < line && i < text.length) {
    if (text.charCodeAt(i) === 10) l++;
    i++;
  }
  return Math.min(i + column - 1, text.length);
}

function locateByBisection(text: string): number {
  // Find the longest prefix that is "possibly valid" by trying to parse with a closer appended.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (prefixPlausible(text.slice(0, mid))) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function prefixPlausible(prefix: string): boolean {
  // A prefix is plausible if the native parser fails only with "end of input" style errors.
  try {
    JSON.parse(prefix);
    return true;
  } catch (e) {
    return /end of (JSON )?input|Unexpected end/i.test((e as Error).message);
  }
}

export type Indent = 2 | 4 | 'tab';

export function formatJson(value: unknown, indent: Indent, sortKeys = false): string {
  const v = sortKeys ? sortDeep(value) : value;
  return JSON.stringify(v, null, indent === 'tab' ? '\t' : indent);
}

export function minifyJson(value: unknown): string {
  return JSON.stringify(value);
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.keys(v as Record<string, unknown>)
      .sort((a, b) => a.localeCompare(b))
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortDeep((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return v;
}

export interface JsonStats {
  bytes: number;
  lines: number;
  depth: number;
  keys: number;
  arrays: number;
  objects: number;
  type: string;
}

export function statsOf(text: string, value: unknown): JsonStats {
  let depth = 0;
  let keys = 0;
  let arrays = 0;
  let objects = 0;
  const walk = (v: unknown, d: number) => {
    depth = Math.max(depth, d);
    if (Array.isArray(v)) {
      arrays++;
      v.forEach((x) => walk(x, d + 1));
    } else if (v && typeof v === 'object') {
      objects++;
      for (const k of Object.keys(v as object)) {
        keys++;
        walk((v as Record<string, unknown>)[k], d + 1);
      }
    }
  };
  walk(value, 1);
  return {
    bytes: new TextEncoder().encode(text).length,
    lines: text.split('\n').length,
    depth,
    keys,
    arrays,
    objects,
    type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value,
  };
}

export const SAMPLE_JSON = `{
  "product": "Cuisdev JSON Editor",
  "version": 2,
  "free": true,
  "features": ["format", "validate", "minify", "sort keys"],
  "privacy": {
    "uploads": null,
    "processing": "in your browser"
  },
  "ratings": [5, 5, 4.5]
}`;
