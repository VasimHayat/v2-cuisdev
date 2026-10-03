/**
 * Data converters: pure functions, no DOM. JSON <-> CSV (papaparse) and JSON <-> YAML
 * (yaml, YAML 1.2 core schema). Errors carry a document offset so the editor can
 * underline the exact spot.
 */
import Papa from 'papaparse';
import YAML from 'yaml';
import { scanJsonError } from '../shared/json-errors';

export class ConvertError extends Error {
  override name = 'ConvertError';
  offset: number | undefined;
  line: number | undefined;
  column: number | undefined;
  constructor(message: string, position?: { offset?: number | undefined; line?: number; column?: number }) {
    super(message);
    this.offset = position?.offset;
    this.line = position?.line;
    this.column = position?.column;
  }
}

export type Format = 'json' | 'csv' | 'yaml';
export type Delimiter = ',' | ';' | '\t' | '|';
export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|'];
export type Indent = 2 | 4;

export interface ConvertOptions {
  /** JSON output indentation; ignored when minify is on. */
  indent: Indent;
  minify: boolean;
  /** CSV output delimiter; CSV input delimiter when not 'auto'. */
  delimiter: Delimiter | 'auto';
  /** CSV: first row is (or should be) a header. */
  header: boolean;
  /** CSV output: quote every field. */
  quoteAll: boolean;
  /** CSV input: convert numeric and boolean-looking strings. */
  dynamicTyping: boolean;
  /** YAML output indentation. */
  yamlIndent: Indent;
}

export const DEFAULT_OPTIONS: ConvertOptions = {
  indent: 2,
  minify: false,
  delimiter: ',',
  header: true,
  quoteAll: false,
  dynamicTyping: false,
  yamlIndent: 2,
};

export interface ConvertResult {
  output: string;
  /** Short stats, e.g. "12 rows · 5 columns" or "3 documents". */
  summary: string;
  warnings: string[];
}

type Row = Record<string, unknown>;

// --- text helpers ------------------------------------------------------------

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: clamped - lineStart + 1 };
}

export function lineColumnToOffset(text: string, line: number, column: number): number {
  let offset = 0;
  let current = 1;
  while (current < line) {
    const nl = text.indexOf('\n', offset);
    if (nl === -1) return text.length;
    offset = nl + 1;
    current++;
  }
  return Math.min(offset + Math.max(0, column - 1), text.length);
}

/** Position from a JSON.parse message: V8 "position N" / "(line L column C)", Firefox "line L column C". */
export function jsonErrorOffset(message: string, source: string): number | undefined {
  const pos = /position (\d+)/.exec(message);
  if (pos) return Math.min(Number(pos[1]), source.length);
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc) return lineColumnToOffset(source, Number(lc[1]), Number(lc[2]));
  if (/end of (JSON )?(input|data)/i.test(message)) return source.length;
  return undefined;
}

// --- parsers -----------------------------------------------------------------

export function parseJson(input: string): unknown {
  const source = stripBom(input);
  if (source.trim() === '') throw new ConvertError('Input is empty. Paste some JSON to convert.');
  try {
    return JSON.parse(source);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    let offset = jsonErrorOffset(raw, source);
    let detail = raw
      .replace(/\s*in JSON at position \d+.*$/, '')
      .replace(/\s*\(line \d+ column \d+\)\s*$/, '')
      .replace(/^JSON\.parse:\s*/, '')
      .replace(/,? .*is not valid JSON$/, '')
      .trim();
    if (offset === undefined) {
      const scanned = scanJsonError(source);
      if (scanned) {
        offset = scanned.offset;
        detail = scanned.message;
      }
    }
    if (offset === undefined) throw new ConvertError(`Invalid JSON: ${detail}. Check for trailing commas or unquoted keys.`);
    const { line, column } = offsetToLineColumn(source, offset);
    throw new ConvertError(`Invalid JSON at line ${line}, column ${column}: ${detail}.`, { offset, line, column });
  }
}

/** Parse YAML. Multiple documents (separated by ---) come back as an array. */
export function parseYaml(input: string): { value: unknown; documents: number } {
  const source = stripBom(input);
  if (source.trim() === '') throw new ConvertError('Input is empty. Paste some YAML to convert.');
  const docs = YAML.parseAllDocuments(source, { prettyErrors: true });
  if (docs.length === 0) return { value: null, documents: 0 };
  for (const doc of docs) {
    const problem = doc.errors[0];
    if (problem) {
      const [start] = problem.pos;
      const lp = problem.linePos?.[0];
      const position = lp ? { line: lp.line, column: lp.col } : offsetToLineColumn(source, start);
      const detail = (problem.message.split('\n')[0] ?? problem.message)
        .replace(/\s+at line \d+, column \d+:?$/, '')
        .replace(/\.$/, '')
        .trim();
      throw new ConvertError(`Invalid YAML at line ${position.line}, column ${position.column}: ${detail}.`, { offset: start, ...position });
    }
  }
  const values = docs.map((doc) => doc.toJS({ json: true }) as unknown);
  return { value: values.length === 1 ? values[0] : values, documents: values.length };
}

function isPlainObject(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Flatten nested objects to dot-notation keys; arrays become JSON text; null becomes ''. */
export function flattenRecord(record: Row, prefix = '', out: Row = {}): Row {
  for (const [key, value] of Object.entries(record)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      if (Object.keys(value).length === 0) out[path] = '{}';
      else flattenRecord(value, path, out);
    } else if (Array.isArray(value)) out[path] = JSON.stringify(value);
    else if (value === null || value === undefined) out[path] = '';
    else out[path] = value;
  }
  return out;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return 'a string';
  if (typeof value === 'number') return 'a number';
  if (typeof value === 'boolean') return 'a boolean';
  return `a ${typeof value}`;
}

/** Validate an array of objects for tabular output, with hints for the usual mistakes. */
export function toRows(value: unknown): Row[] {
  if (isPlainObject(value)) {
    const nested = Object.entries(value).find(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isPlainObject));
    const hint = nested ? ` Your object has an array of objects under "${nested[0]}", so that array was used.` : ' Wrap a single record in [ ] to convert it as one row.';
    if (nested) return nested[1] as Row[];
    throw new ConvertError(`JSON must be an array of objects (one object per row), but the top-level value is an object.${hint}`);
  }
  if (!Array.isArray(value)) throw new ConvertError(`JSON must be an array of objects (one object per row), but the top-level value is ${describeType(value)}.`);
  const bad = value.findIndex((item) => !isPlainObject(item));
  if (bad !== -1) {
    if (value.every((item) => !isPlainObject(item) && !Array.isArray(item))) return value.map((v) => ({ value: v }));
    throw new ConvertError(`JSON must be an array of objects, but item ${bad} is ${describeType(value[bad])}. Every row needs to be an object like {"name": "..."}.`);
  }
  return value as Row[];
}

// --- conversions -------------------------------------------------------------

function stringifyJson(value: unknown, options: Pick<ConvertOptions, 'indent' | 'minify'>): string {
  return (options.minify ? JSON.stringify(value) : JSON.stringify(value, null, options.indent)) + '\n';
}

export function jsonToCsv(input: string, options: ConvertOptions): ConvertResult {
  const rows = toRows(parseJson(input));
  if (rows.length === 0) return { output: '', summary: '0 rows', warnings: [] };
  const flat = rows.map((row) => flattenRecord(row));
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const row of flat) for (const key of Object.keys(row)) if (!seen.has(key)) (seen.add(key), fields.push(key));
  const data = flat.map((row) => fields.map((f) => (f in row ? row[f] : '')));
  const csv = Papa.unparse({ fields, data }, { delimiter: options.delimiter === 'auto' ? ',' : options.delimiter, header: options.header, quotes: options.quoteAll, newline: '\n' });
  return { output: csv + '\n', summary: `${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'} · ${fields.length} ${fields.length === 1 ? 'column' : 'columns'}`, warnings: [] };
}

export function csvToJson(input: string, options: ConvertOptions): ConvertResult {
  const source = stripBom(input);
  if (source.trim() === '') throw new ConvertError('Input is empty. Paste some CSV to convert.');
  const result = Papa.parse<unknown>(source, {
    header: options.header,
    delimiter: options.delimiter === 'auto' ? '' : options.delimiter,
    dynamicTyping: options.dynamicTyping,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => h.trim(),
  });
  const warnings: string[] = [];
  for (const error of result.errors) {
    if (error.type === 'Quotes') {
      const offset = error.index;
      let position: { line: number; column: number } | undefined;
      if (offset !== undefined) position = offsetToLineColumn(source, offset);
      else if (typeof error.row === 'number') position = { line: error.row + (options.header ? 2 : 1), column: 1 };
      const where = position ? ` at line ${position.line}, column ${position.column}` : '';
      throw new ConvertError(`Invalid CSV${where}: ${error.message}. A quoted field must end with a closing quote and quotes inside a field must be doubled.`, position ? { offset, ...position } : undefined);
    }
    if (error.type === 'Delimiter') warnings.push('Could not detect the delimiter, so a comma was assumed. Pick one explicitly if the columns look wrong.');
    else if (error.type === 'FieldMismatch') {
      const row = typeof error.row === 'number' ? error.row + (options.header ? 2 : 1) : undefined;
      warnings.push(row === undefined ? `${error.message}.` : `Line ${row}: ${error.message}.`);
    }
  }
  if (result.meta.renamedHeaders) {
    const renamed = Object.entries(result.meta.renamedHeaders).map(([to, from]) => `"${from}" → "${to}"`).join(', ');
    warnings.push(`Duplicate column names were renamed: ${renamed}.`);
  }
  const data = result.data;
  const columns = options.header ? (result.meta.fields?.length ?? 0) : Math.max(0, ...data.map((row) => (Array.isArray(row) ? row.length : 0)));
  const used = result.meta.delimiter;
  const name = delimiterName(DELIMITERS.includes(used as Delimiter) ? (used as Delimiter) : ',');
  return {
    output: stringifyJson(data, options),
    summary: `${data.length.toLocaleString()} ${data.length === 1 ? 'row' : 'rows'} · ${columns} ${columns === 1 ? 'column' : 'columns'} · ${name} delimited`,
    warnings: [...new Set(warnings)].slice(0, 5),
  };
}

export function jsonToYaml(input: string, options: ConvertOptions): ConvertResult {
  const value = parseJson(input);
  const output = YAML.stringify(value, { indent: options.yamlIndent, lineWidth: 0 });
  const keys = isPlainObject(value) ? Object.keys(value).length : Array.isArray(value) ? value.length : 1;
  return { output, summary: isPlainObject(value) ? `${keys} top-level ${keys === 1 ? 'key' : 'keys'}` : Array.isArray(value) ? `${keys} ${keys === 1 ? 'item' : 'items'}` : 'scalar value', warnings: [] };
}

export function yamlToJson(input: string, options: ConvertOptions): ConvertResult {
  const { value, documents } = parseYaml(input);
  const warnings: string[] = [];
  if (documents > 1) warnings.push(`${documents} YAML documents were converted to a JSON array with one element each.`);
  if (documents === 0) warnings.push('The input contains only comments, so the output is null.');
  return { output: stringifyJson(value, options), summary: documents > 1 ? `${documents} documents` : isPlainObject(value) ? `${Object.keys(value).length} top-level keys` : Array.isArray(value) ? `${value.length} items` : 'scalar value', warnings };
}

export type Direction = `${Format}-to-${Format}`;

export const CONVERTERS: Partial<Record<Direction, (input: string, options: ConvertOptions) => ConvertResult>> = {
  'json-to-csv': jsonToCsv,
  'csv-to-json': csvToJson,
  'json-to-yaml': jsonToYaml,
  'yaml-to-json': yamlToJson,
};

export function convert(from: Format, to: Format, input: string, options: ConvertOptions): ConvertResult {
  const fn = CONVERTERS[`${from}-to-${to}`];
  if (!fn) throw new ConvertError(`Converting ${from.toUpperCase()} to ${to.toUpperCase()} is not supported.`);
  return fn(input, options);
}

export const FORMAT_LABELS: Record<Format, string> = { json: 'JSON', csv: 'CSV', yaml: 'YAML' };
export const FORMAT_EXT: Record<Format, string> = { json: 'json', csv: 'csv', yaml: 'yaml' };
export const FORMAT_MIME: Record<Format, string> = { json: 'application/json', csv: 'text/csv', yaml: 'application/yaml' };

export function delimiterName(delimiter: Delimiter | 'auto'): string {
  switch (delimiter) {
    case ',':
      return 'comma';
    case ';':
      return 'semicolon';
    case '\t':
      return 'tab';
    case '|':
      return 'pipe';
    default:
      return 'auto';
  }
}

/** Guess a format from text so a pasted file can flip the direction. */
export function detectFormat(text: string): Format | null {
  const t = stripBom(text).trim();
  if (!t) return null;
  if (/^[[{]/.test(t)) {
    try {
      JSON.parse(t);
      return 'json';
    } catch {}
  }
  const lines = t.split('\n').slice(0, 20);
  const delimited = lines.filter((l) => /[,;\t|]/.test(l)).length;
  const yamlish = lines.filter((l) => /^\s*(-\s|[\w"'.-]+\s*:(\s|$)|#|---)/.test(l)).length;
  if (yamlish >= Math.max(1, lines.length * 0.5) && yamlish >= delimited) return 'yaml';
  if (delimited >= Math.max(1, lines.length * 0.6)) return 'csv';
  return null;
}

/** Short stats line for a pane: line count and UTF-8 byte size. */
export function describe(text: string): string {
  if (text.length === 0) return '';
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  if (text.endsWith('\n')) lines--;
  const bytes = new TextEncoder().encode(text).length;
  const size = bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${lines.toLocaleString()} ${lines === 1 ? 'line' : 'lines'} · ${size}`;
}

export const SAMPLES: Record<Format, string> = {
  json: `[
  { "id": 1, "name": "Ada Lovelace", "email": "ada@example.com", "role": "admin", "address": { "city": "London", "country": "UK" }, "tags": ["founder", "math"] },
  { "id": 2, "name": "Linus Torvalds", "email": "linus@example.com", "role": "maintainer", "address": { "city": "Portland", "country": "US" }, "tags": ["kernel"] },
  { "id": 3, "name": "Grace Hopper", "email": "grace@example.com", "role": "member", "address": { "city": "Arlington", "country": "US" }, "tags": [] }
]
`,
  csv: `id,name,email,role,address.city,address.country
1,Ada Lovelace,ada@example.com,admin,London,UK
2,Linus Torvalds,linus@example.com,maintainer,Portland,US
3,"Hopper, Grace",grace@example.com,member,Arlington,US
`,
  yaml: `# Service definition
name: orders-api
version: 2.4.1
replicas: 3
env:
  NODE_ENV: production
  LOG_LEVEL: info
ports:
  - 8080
  - 9090
healthcheck:
  path: /healthz
  interval: 30s
owners:
  - name: Ada Lovelace
    email: ada@example.com
`,
};
