/**
 * JSON engine for the editor island. Pure functions, no DOM.
 * Parsing with exact positions and hints, formatting, minifying, key sorting,
 * statistics, a conservative repair for common non-JSON syntax, and path helpers
 * for the tree view.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
export type Indent = 2 | 4 | 'tab';
export type Path = (string | number)[];

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

export type ParseResult = { ok: true; value: JsonValue } | { ok: false; error: JsonError };

// ---------------------------------------------------------------- parse

export function parseJson(text: string): ParseResult {
  const src = stripBom(text);
  if (!src.trim()) {
    return { ok: false, error: { message: 'Input is empty', line: 1, column: 1, offset: 0 } };
  }
  try {
    return { ok: true, value: JSON.parse(src) as JsonValue };
  } catch (e) {
    const raw = (e as Error).message || 'Invalid JSON';
    // Our scanner gives a clearer message and always a position; the engine's position is
    // used when the scanner and engine disagree only as a fallback.
    const scanned = scanJsonError(src);
    const offset = scanned?.offset ?? engineOffset(raw, src) ?? 0;
    const { line, column } = offsetToLineColumn(src, offset);
    const message = scanned?.message ?? cleanMessage(raw);
    return { ok: false, error: { message, line, column, offset, hint: guessHint(src, offset) } };
  }
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function engineOffset(message: string, source: string): number | undefined {
  const pos = /position (\d+)/.exec(message);
  if (pos) return Math.min(Number(pos[1]), source.length);
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc) return lineColumnToOffset(source, Number(lc[1]), Number(lc[2]));
  if (/end of (JSON )?input|unexpected end/i.test(message)) return source.length;
  return undefined;
}

export function lineColumnToOffset(source: string, line: number, column: number): number {
  let offset = 0;
  let current = 1;
  while (current < line) {
    const nl = source.indexOf('\n', offset);
    if (nl === -1) break;
    offset = nl + 1;
    current++;
  }
  return Math.min(offset + Math.max(0, column - 1), source.length);
}

export function offsetToLineColumn(source: string, offset: number): { line: number; column: number } {
  const clamped = Math.min(Math.max(0, offset), source.length);
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: clamped - lastNewline };
}

function cleanMessage(raw: string): string {
  return raw
    .replace(/^JSON\.parse:\s*/i, '')
    .replace(/ in JSON at position \d+.*$/i, '')
    .replace(/\s+at position \d+.*$/i, '')
    .replace(/\s*\(line \d+ column \d+\)\s*$/i, '')
    .replace(/ at line \d+ column \d+ of the JSON data$/i, '')
    .replace(/^Unexpected token '(.+?)', .*is not valid JSON$/, 'Unexpected token "$1"')
    .replace(/^Unexpected token (\S+), .*is not valid JSON$/, 'Unexpected token $1')
    .replace(/^Expected (.+) after (.+) in JSON$/, 'Expected $1 after $2')
    .replace(/\s+after JSON$/i, ' after the end of the document')
    .trim();
}

function guessHint(source: string, offset: number): string | undefined {
  const around = source.slice(Math.max(0, offset - 40), offset + 40);
  if (/\/\/|\/\*/.test(source)) return 'JSON does not allow comments. Use Fix to strip them.';
  if (/,\s*[}\]]/.test(around)) return 'Trailing commas are not allowed before } or ].';
  if (/'/.test(around) && !/"/.test(around)) return 'Strings must use double quotes, not single quotes.';
  if (/[{,]\s*[A-Za-z_$][\w$]*\s*:/.test(around)) return 'Object keys must be quoted strings.';
  if (/\b(NaN|Infinity|undefined)\b/.test(around)) return 'NaN, Infinity and undefined are not valid JSON values. Use null.';
  if (/[“”‘’]/.test(around)) return 'Smart (curly) quotes detected. JSON needs straight double quotes.';
  if (source.trim().endsWith(',')) return 'The input ends with a comma. Remove it or add the next value.';
  const opens = (source.match(/[{[]/g) ?? []).length;
  const closes = (source.match(/[}\]]/g) ?? []).length;
  if (opens > closes) return 'Looks like a closing } or ] is missing.';
  if (closes > opens) return 'There is an extra closing } or ].';
  return undefined;
}

// ---------------------------------------------------------------- scanner

interface ScanError {
  offset: number;
  message: string;
}

class ScanFailure extends Error {
  constructor(
    public readonly offset: number,
    message: string,
  ) {
    super(message);
  }
}

/** Tiny validating scanner that reports the first error with a position and a clear message. */
export function scanJsonError(src: string): ScanError | undefined {
  const n = src.length;
  let i = 0;
  const ws = () => {
    while (i < n) {
      const c = src.charCodeAt(i);
      if (c === 32 || c === 10 || c === 13 || c === 9) i++;
      else break;
    }
  };
  const fail = (message: string, at = i): never => {
    throw new ScanFailure(Math.min(at, n), message);
  };
  const describe = () => (i >= n ? 'end of input' : `"${src[i]}"`);

  const string = () => {
    i++;
    while (i < n) {
      const c = src[i] as string;
      if (c === '"') {
        i++;
        return;
      }
      if (c === '\\') {
        const e = src[i + 1];
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) fail('Invalid unicode escape', i);
          i += 6;
          continue;
        }
        if (e === undefined || !'"\\/bfnrt'.includes(e)) fail(`Invalid escape "\\${e ?? ''}"`, i);
        i += 2;
        continue;
      }
      if (c < ' ') fail('Unescaped control character in string (use \\n, \\t, ...)', i);
      i++;
    }
    fail('Unterminated string', n);
  };
  const number = () => {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
    if (!m || m[0] === '' || m[0] === '-') fail('Invalid number');
    i += (m as RegExpExecArray)[0].length;
    if (src[i] === '.' || /[0-9]/.test(src[i] ?? '')) fail('Invalid number (leading zeros or a trailing dot are not allowed)');
  };
  const object = () => {
    i++;
    ws();
    if (src[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (src[i] !== '"') {
        if (src[i] === '}') fail('Trailing comma before "}"');
        fail(`Expected a quoted property name, found ${describe()}`);
      }
      string();
      ws();
      if (src[i] !== ':') fail(`Expected ":" after property name, found ${describe()}`);
      i++;
      value();
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === '}') {
        i++;
        return;
      }
      fail(`Expected "," or "}" after property value, found ${describe()}`);
    }
  };
  const array = () => {
    i++;
    ws();
    if (src[i] === ']') {
      i++;
      return;
    }
    for (;;) {
      ws();
      if (src[i] === ']') fail('Trailing comma before "]"');
      value();
      ws();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === ']') {
        i++;
        return;
      }
      fail(`Expected "," or "]" after array element, found ${describe()}`);
    }
  };
  const value = (): void => {
    ws();
    if (i >= n) fail('Unexpected end of input');
    const c = src[i] as string;
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const lit of ['true', 'false', 'null']) {
      if (src.startsWith(lit, i)) {
        i += lit.length;
        return;
      }
    }
    if (c === "'") fail('Single quotes are not valid in JSON. Use double quotes');
    fail(`Unexpected token ${describe()}`);
  };

  try {
    value();
    ws();
    if (i < n) fail(`Unexpected token ${describe()} after the JSON value`);
    return undefined;
  } catch (e) {
    if (e instanceof ScanFailure) return { offset: e.offset, message: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------- transform

export function formatJson(value: JsonValue, indent: Indent, sortKeys = false): string {
  const v = sortKeys ? sortKeysDeep(value) : value;
  return JSON.stringify(v, null, indent === 'tab' ? '\t' : indent);
}

export function minifyJson(value: JsonValue, sortKeys = false): string {
  return JSON.stringify(sortKeys ? sortKeysDeep(value) : value);
}

export function sortKeysDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) sorted[key] = sortKeysDeep(value[key] as JsonValue);
    return sorted;
  }
  return value;
}

/**
 * Repair common non-JSON syntax so it parses: BOM, comments, trailing commas, single quotes,
 * unquoted keys, NaN/Infinity/undefined, Python literals and smart quotes. Nothing inside a
 * valid double-quoted string is touched.
 */
export function repairJson(text: string): string {
  const src = stripBom(text).replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i] as string;
    if (ch === '"') {
      const end = findStringEnd(src, i, '"');
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "'") {
      const end = findStringEnd(src, i, "'");
      const inner = src.slice(i + 1, end - 1);
      out += JSON.stringify(inner.replace(/\\'/g, "'").replace(/\\"/g, '"'));
      i = end;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      i = close === -1 ? n : close + 2;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(src[j] as string)) j++;
      // Trailing comma before a closer, or a stray comma at the very end of the document
      if (src[j] === '}' || src[j] === ']' || j >= n) {
        i++;
        continue;
      }
    }
    if (/[A-Za-z_$]/.test(ch) && isKeyPosition(out)) {
      let j = i;
      while (j < n && /[\w$]/.test(src[j] as string)) j++;
      let k = j;
      while (k < n && /\s/.test(src[k] as string)) k++;
      if (src[k] === ':') {
        out += JSON.stringify(src.slice(i, j));
        i = j;
        continue;
      }
    }
    if (/[A-Za-z]/.test(ch)) {
      const word = /^[A-Za-z]+/.exec(src.slice(i))?.[0] ?? '';
      if (word === 'NaN' || word === 'Infinity' || word === 'undefined' || word === 'None') {
        out += 'null';
        i += word.length;
        continue;
      }
      if (word === 'True' || word === 'False') {
        out += word.toLowerCase();
        i += word.length;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out.trim();
}

export function canRepair(text: string): boolean {
  const repaired = repairJson(text);
  return repaired !== text.trim() && parseJson(repaired).ok;
}

function findStringEnd(src: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return src.length;
}

function isKeyPosition(out: string): boolean {
  const trimmed = out.trimEnd();
  const last = trimmed[trimmed.length - 1];
  if (last === '{') return true;
  if (last !== ',') return false;
  let depth = 0;
  for (let i = trimmed.length - 2; i >= 0; i--) {
    const c = trimmed[i];
    if (c === '"') {
      let j = i - 1;
      while (j >= 0 && !(trimmed[j] === '"' && trimmed[j - 1] !== '\\')) j--;
      i = j;
      continue;
    }
    if (c === '}' || c === ']') depth++;
    else if (c === '{' || c === '[') {
      if (depth === 0) return c === '{';
      depth--;
    }
  }
  return false;
}

// ---------------------------------------------------------------- stats & types

export interface JsonStats {
  bytes: number;
  lines: number;
  /** Every value node including the root. */
  items: number;
  keys: number;
  objects: number;
  arrays: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  depth: number;
  type: JsonType;
}

export function statsOf(text: string, value: JsonValue): JsonStats {
  const s: JsonStats = {
    bytes: byteLength(text),
    lines: text === '' ? 0 : text.split('\n').length,
    items: 0,
    keys: 0,
    objects: 0,
    arrays: 0,
    strings: 0,
    numbers: 0,
    booleans: 0,
    nulls: 0,
    depth: 0,
    type: typeOf(value),
  };
  const walk = (v: JsonValue, depth: number) => {
    s.items++;
    s.depth = Math.max(s.depth, depth);
    if (v === null) s.nulls++;
    else if (Array.isArray(v)) {
      s.arrays++;
      for (const item of v) walk(item, depth + 1);
    } else if (typeof v === 'object') {
      s.objects++;
      for (const k of Object.keys(v)) {
        s.keys++;
        walk(v[k] as JsonValue, depth + 1);
      }
    } else if (typeof v === 'string') s.strings++;
    else if (typeof v === 'number') s.numbers++;
    else s.booleans++;
  };
  walk(value, 1);
  return s;
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function typeOf(v: JsonValue): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v as JsonType;
}

export function isContainer(v: JsonValue): v is JsonValue[] | { [key: string]: JsonValue } {
  return v !== null && typeof v === 'object';
}

export function childCount(v: JsonValue): number {
  if (Array.isArray(v)) return v.length;
  if (isContainer(v)) return Object.keys(v).length;
  return 0;
}

export function summarize(v: JsonValue): string {
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'item' : 'items'}`;
  if (isContainer(v)) {
    const n = Object.keys(v).length;
    return `${n} ${n === 1 ? 'key' : 'keys'}`;
  }
  return JSON.stringify(v);
}

// ---------------------------------------------------------------- paths

export function pathToString(path: Path): string {
  let s = '$';
  for (const seg of path) {
    if (typeof seg === 'number') s += `[${seg}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(seg)) s += `.${seg}`;
    else s += `[${JSON.stringify(seg)}]`;
  }
  return s;
}

export function pathToPointer(path: Path): string {
  return path.length ? '/' + path.map((p) => String(p).replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : '';
}

export function pathKey(path: Path): string {
  return JSON.stringify(path);
}

export function getAtPath(root: JsonValue, path: Path): JsonValue | undefined {
  let cur: JsonValue | undefined = root;
  for (const seg of path) {
    if (cur === undefined || !isContainer(cur)) return undefined;
    cur = Array.isArray(cur) ? cur[seg as number] : cur[seg as string];
  }
  return cur;
}

/** Returns a new root with `value` set at `path`. Shares untouched branches. */
export function setAtPath(root: JsonValue, path: Path, value: JsonValue): JsonValue {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[head as number] = setAtPath(root[head as number] as JsonValue, rest, value);
    return copy;
  }
  if (isContainer(root)) {
    return { ...root, [head as string]: setAtPath(root[head as string] as JsonValue, rest, value) };
  }
  return root;
}

export function deleteAtPath(root: JsonValue, path: Path): JsonValue {
  if (path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const last = path[path.length - 1];
  const parent = getAtPath(root, parentPath);
  if (parent === undefined || !isContainer(parent)) return root;
  let next: JsonValue;
  if (Array.isArray(parent)) {
    next = parent.filter((_, i) => i !== last);
  } else {
    const copy = { ...parent };
    delete copy[last as string];
    next = copy;
  }
  return setAtPath(root, parentPath, next);
}

/**
 * Interpret text typed into a tree cell. Valid JSON literals become their value
 * (so 42, true, null, "x", [1] all work); anything else is kept as a string.
 */
export function coerceInput(text: string): JsonValue {
  const t = text.trim();
  if (t === '') return '';
  try {
    return JSON.parse(t) as JsonValue;
  } catch {
    return text;
  }
}

/** Paths of all containers, breadth-first, capped. Used by Expand all. */
export function containerPaths(root: JsonValue, cap = 5000): Path[] {
  const out: Path[] = [];
  const queue: [JsonValue, Path][] = [[root, []]];
  while (queue.length && out.length < cap) {
    const [v, p] = queue.shift()!;
    if (!isContainer(v)) continue;
    out.push(p);
    if (Array.isArray(v)) v.forEach((c, i) => isContainer(c) && queue.push([c, [...p, i]]));
    else for (const k of Object.keys(v)) isContainer(v[k] as JsonValue) && queue.push([v[k] as JsonValue, [...p, k]]);
  }
  return out;
}

/**
 * For a search term, return the set of path keys that should be visible: every node whose
 * key or primitive value contains the term, plus all of their ancestors.
 */
export function searchPaths(root: JsonValue, term: string, cap = 5000): Set<string> | null {
  const q = term.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set<string>();
  let hits = 0;
  const walk = (v: JsonValue, path: Path, ancestors: string[]): boolean => {
    if (hits >= cap) return false;
    const key = path.length ? String(path[path.length - 1]).toLowerCase() : '';
    let match = key.includes(q);
    if (!isContainer(v)) {
      match = match || String(v).toLowerCase().includes(q);
    } else {
      const self = pathKey(path);
      const entries = Array.isArray(v) ? v.map((c, i) => [i, c] as const) : Object.entries(v);
      let childMatch = false;
      for (const [k, c] of entries) {
        if (walk(c as JsonValue, [...path, k as string | number], [...ancestors, self])) childMatch = true;
      }
      match = match || childMatch;
    }
    if (match) {
      hits++;
      visible.add(pathKey(path));
      for (const a of ancestors) visible.add(a);
    }
    return match;
  };
  walk(root, [], []);
  return visible;
}

// ---------------------------------------------------------------- sample

export const SAMPLE_JSON = `{
  "project": "Cuisdev JSON Editor",
  "version": 2,
  "features": [
    "Live validation with exact error positions",
    "Interactive tree with inline editing",
    "Format, compact and sort keys",
    "Open from disk or URL, share by link",
    "Optional AI assist with your own key"
  ],
  "settings": {
    "theme": "system",
    "autosave": true,
    "maxFileSizeMb": 25
  },
  "users": [
    { "id": 1, "name": "Alice", "active": true, "score": 98.6 },
    { "id": 2, "name": "Bob", "active": false, "score": null }
  ],
  "privacy": {
    "uploads": null,
    "processing": "in your browser"
  }
}`;
