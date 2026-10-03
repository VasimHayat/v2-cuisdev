/**
 * Code Formatter: pure functions, no DOM.
 *
 * Beautifying delegates to Prettier's browser build (HTML, CSS, SCSS, JavaScript,
 * TypeScript, JSON) and to sql-formatter (SQL). Minifying uses terser (JavaScript),
 * csso (CSS) and small hand-written passes for HTML, JSON and SQL. Every library is
 * `await import()`-ed the first time it is needed so the page's first load stays small.
 */
import type * as CssoModule from 'csso';
import type * as TerserModule from 'terser';
import type * as SqlModule from 'sql-formatter';
import { scanJsonError } from '../shared/json-errors';

export type LanguageId = 'html' | 'css' | 'scss' | 'javascript' | 'typescript' | 'json' | 'sql';
export type Mode = 'beautify' | 'minify';
export type IndentOption = 2 | 4 | 'tab';
export type PrintWidth = 80 | 100 | 120;
export type KeywordCase = 'preserve' | 'upper' | 'lower';
export type SqlDialect =
  | 'sql'
  | 'mysql'
  | 'mariadb'
  | 'postgresql'
  | 'sqlite'
  | 'tsql'
  | 'bigquery'
  | 'snowflake'
  | 'spark'
  | 'plsql'
  | 'db2'
  | 'hive'
  | 'trino';

export interface LanguageInfo {
  id: LanguageId;
  label: string;
  /** Prettier parser name, or null when another engine formats it. */
  parser: string | null;
  extension: string;
  mime: string;
  /** How this language is minified, or null when it cannot be. */
  minifier: 'terser' | 'csso' | 'html' | 'json' | 'sql' | null;
  /** Whether the quote / semicolon / trailing-comma options apply. */
  script: boolean;
}

export const LANGUAGES: Record<LanguageId, LanguageInfo> = {
  javascript: { id: 'javascript', label: 'JavaScript', parser: 'babel', extension: 'js', mime: 'text/javascript', minifier: 'terser', script: true },
  typescript: { id: 'typescript', label: 'TypeScript', parser: 'typescript', extension: 'ts', mime: 'text/plain', minifier: null, script: true },
  html: { id: 'html', label: 'HTML', parser: 'html', extension: 'html', mime: 'text/html', minifier: 'html', script: false },
  css: { id: 'css', label: 'CSS', parser: 'css', extension: 'css', mime: 'text/css', minifier: 'csso', script: false },
  scss: { id: 'scss', label: 'SCSS', parser: 'scss', extension: 'scss', mime: 'text/x-scss', minifier: null, script: false },
  json: { id: 'json', label: 'JSON', parser: 'json', extension: 'json', mime: 'application/json', minifier: 'json', script: false },
  sql: { id: 'sql', label: 'SQL', parser: null, extension: 'sql', mime: 'application/sql', minifier: 'sql', script: false },
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES) as LanguageId[];

export const SQL_DIALECTS: { id: SqlDialect; label: string }[] = [
  { id: 'sql', label: 'Standard SQL' },
  { id: 'mysql', label: 'MySQL' },
  { id: 'mariadb', label: 'MariaDB' },
  { id: 'postgresql', label: 'PostgreSQL' },
  { id: 'sqlite', label: 'SQLite' },
  { id: 'tsql', label: 'SQL Server (T-SQL)' },
  { id: 'bigquery', label: 'BigQuery' },
  { id: 'snowflake', label: 'Snowflake' },
  { id: 'spark', label: 'Spark SQL' },
  { id: 'plsql', label: 'Oracle PL/SQL' },
  { id: 'db2', label: 'Db2' },
  { id: 'hive', label: 'Hive' },
  { id: 'trino', label: 'Trino' },
];

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && Object.hasOwn(LANGUAGES, value);
}

export function isSqlDialect(value: unknown): value is SqlDialect {
  return typeof value === 'string' && SQL_DIALECTS.some((d) => d.id === value);
}

export function canMinify(language: LanguageId): boolean {
  return LANGUAGES[language].minifier !== null;
}

/** Why minification is unavailable, or undefined when it is available. */
export function minifyUnavailableMessage(language: LanguageId): string | undefined {
  if (language === 'typescript') return 'Minify is not available for TypeScript. Compile it to JavaScript first, then minify.';
  if (language === 'scss') return 'Minify is not available for SCSS. Compile it to CSS first, then minify.';
  return undefined;
}

/** Download file name for the current language and mode. */
export function fileNameFor(language: LanguageId, mode: Mode): string {
  const { extension } = LANGUAGES[language];
  return mode === 'minify' ? `code.min.${extension}` : `code.${extension}`;
}

/** Map a file name to a language, or undefined when the extension is unknown. */
export function languageFromFileName(name: string): LanguageId | undefined {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, LanguageId> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
    html: 'html', htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
    css: 'css', scss: 'scss', json: 'json', jsonc: 'json', json5: 'json', webmanifest: 'json',
    sql: 'sql', ddl: 'sql', dml: 'sql',
  };
  return map[ext];
}

// --- positions ---------------------------------------------------------------

export interface ErrorPosition {
  line: number;
  column: number;
  offset: number;
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

export function offsetToLineColumn(source: string, offset: number): ErrorPosition {
  const clamped = Math.min(Math.max(0, offset), source.length);
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < clamped; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return { offset: clamped, line, column: clamped - lastNewline };
}

/**
 * Extract the offset from a JSON.parse error. V8 reports "at position N" or
 * "(line L column C)"; SpiderMonkey reports "at line L column C of the JSON data".
 */
export function parseErrorOffset(message: string, source: string): number | undefined {
  const pos = /position (\d+)/.exec(message);
  if (pos) return Math.min(Number(pos[1]), source.length);
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc) return lineColumnToOffset(source, Number(lc[1]), Number(lc[2]));
  return undefined;
}

/** A syntax error reported by Prettier, terser, csso, sql-formatter or our own parsers. */
export class CodeFormatError extends Error {
  override name = 'CodeFormatError';
  constructor(
    message: string,
    public readonly position?: ErrorPosition,
  ) {
    super(message);
  }
}

// --- text helpers ------------------------------------------------------------

/** Strip a UTF-8 BOM and normalise CRLF / CR line endings to LF. */
export function normalizeSource(text: string): string {
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Percentage of bytes removed, rounded to one decimal. Negative when the output grew. */
export function savingsPercent(inputBytes: number, outputBytes: number): number {
  if (inputBytes <= 0) return 0;
  const percent = ((inputBytes - outputBytes) / inputBytes) * 100;
  return Math.round(percent * 10) / 10 || 0;
}

// --- language detection ------------------------------------------------------

/**
 * Best-effort guess at the language of a pasted snippet. Used when the language select
 * is on "Auto". Order matters: JSON and HTML have unambiguous shapes, SQL and CSS have
 * strong keywords, and TypeScript is JavaScript plus type syntax.
 */
/**
 * TypeScript-only syntax: interface/type/enum declarations, type keywords after a colon,
 * return-type and optional-property annotations, access modifiers, `as const`, generics
 * before a call. Deliberately not "word colon word", which is also an object literal key.
 */
const TS_SYNTAX =
  /\b(interface|type)\s+\w+\s*(=|\{|<)|:\s*(string|number|boolean|unknown|any|void|never|null|undefined|Record<|Promise<|Array<)\b|\)\s*:\s*[\w[\]<>|]+\s*(=>|\{|;)|\w+\?:\s*\w|\bas\s+const\b|\bimplements\b|\bdeclare\b|\benum\s+\w+\s*\{|\b(private|public|protected|readonly)\s+\w+|\babstract\s+class\b|<\w+(,\s*\w+)*>\s*\(|\bsatisfies\b|\w+!\s*[;,).]/;

export function detectLanguage(source: string): LanguageId {
  const text = normalizeSource(source).trim();
  if (!text) return 'javascript';
  const head = text.slice(0, 4000);

  if (/^[[{]/.test(head)) {
    try {
      JSON.parse(text);
      return 'json';
    } catch {}
  }
  if (/^<!doctype\s+html|^<html|^<\?xml|^<[a-z][\w-]*(\s|>)/i.test(head) && /<\/?[a-z][\w-]*[^>]*>/i.test(head)) return 'html';
  if (/^\s*(--[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*(select|insert|update|delete|create|alter|drop|with|merge|truncate|grant|explain|begin|declare|use)\b/i.test(head)) return 'sql';

  const looksLikeCss = /(^|[\s;}])[.#]?[\w-]+\s*(,\s*[.#:\w-]+\s*)*\{[^}]*:[^}]*(;|})/m.test(head) && !/\b(function|=>|const |let |var |return |import |export )\b/.test(head);
  if (looksLikeCss) {
    if (/\$[\w-]+\s*:|@mixin|@include|@use\b|@each\b|&[:.\w-]|#\{/.test(head)) return 'scss';
    return 'css';
  }

  if (/^\s*(import|export)\b|\b(function|=>|const|let|var|return|class|async|await|console\.)\b/.test(head)) {
    if (TS_SYNTAX.test(head)) return 'typescript';
    return 'javascript';
  }
  if (/\$[\w-]+\s*:|@mixin|@include/.test(head)) return 'scss';
  if (/\{[^}]*:[^}]*\}/.test(head) && !/[=;]\s*$/m.test(head.split('\n')[0] ?? '')) return 'css';
  return 'javascript';
}

// --- options -----------------------------------------------------------------

export interface BeautifyOptions {
  indent?: IndentOption;
  printWidth?: PrintWidth;
  singleQuote?: boolean;
  semicolons?: boolean;
  trailingCommas?: boolean;
  /** SQL only */
  dialect?: SqlDialect;
  keywordCase?: KeywordCase;
}

export interface PrettierConfig {
  parser: string;
  tabWidth: number;
  useTabs: boolean;
  printWidth: number;
  singleQuote: boolean;
  semi: boolean;
  trailingComma: 'all' | 'none';
  endOfLine: 'lf';
}

/** Map the tool's options onto Prettier's. Exported so it can be unit-tested. */
export function prettierConfig(language: LanguageId, options: BeautifyOptions = {}): PrettierConfig {
  const indent = options.indent ?? 2;
  return {
    parser: LANGUAGES[language].parser ?? 'babel',
    tabWidth: indent === 'tab' ? 2 : indent,
    useTabs: indent === 'tab',
    printWidth: options.printWidth ?? 80,
    singleQuote: options.singleQuote ?? false,
    semi: options.semicolons ?? true,
    trailingComma: (options.trailingCommas ?? true) ? 'all' : 'none',
    endOfLine: 'lf',
  };
}

// --- lazy library loading ----------------------------------------------------

type PrettierPlugin = unknown;

interface PrettierModule {
  format(source: string, options: Record<string, unknown>): Promise<string>;
}

const pluginCache = new Map<LanguageId, Promise<PrettierPlugin[]>>();
let prettierPromise: Promise<PrettierModule> | undefined;
let terserPromise: Promise<typeof TerserModule> | undefined;
let cssoPromise: Promise<typeof CssoModule> | undefined;
let sqlPromise: Promise<typeof SqlModule> | undefined;

/** True when everything needed for `language` + `mode` has already been downloaded. */
export function isReady(language: LanguageId, mode: Mode): boolean {
  if (mode === 'beautify') {
    if (language === 'sql') return sqlPromise !== undefined;
    return prettierPromise !== undefined && pluginCache.has(language);
  }
  switch (LANGUAGES[language].minifier) {
    case 'terser':
      return terserPromise !== undefined;
    case 'csso':
      return cssoPromise !== undefined;
    default:
      return true;
  }
}

async function loadPrettier(): Promise<PrettierModule> {
  prettierPromise ??= import('prettier/standalone') as unknown as Promise<PrettierModule>;
  return prettierPromise;
}

async function loadPlugins(language: LanguageId): Promise<PrettierPlugin[]> {
  const cached = pluginCache.get(language);
  if (cached) return cached;
  const loading = (async (): Promise<PrettierPlugin[]> => {
    switch (language) {
      case 'html':
        return [await import('prettier/plugins/html')];
      case 'css':
      case 'scss':
        return [await import('prettier/plugins/postcss')];
      case 'typescript':
        return [await import('prettier/plugins/typescript'), await import('prettier/plugins/estree')];
      default:
        return [await import('prettier/plugins/babel'), await import('prettier/plugins/estree')];
    }
  })();
  pluginCache.set(language, loading);
  return loading;
}

// --- beautify ----------------------------------------------------------------

/** Pretty-print `source`. Throws `CodeFormatError` on syntax errors. */
export async function beautify(source: string, language: LanguageId, options: BeautifyOptions = {}): Promise<string> {
  const text = normalizeSource(source);
  if (text.trim() === '') return '';
  if (language === 'sql') return beautifySql(text, options);
  const [prettier, plugins] = await Promise.all([loadPrettier(), loadPlugins(language)]);
  try {
    return await prettier.format(text, { ...prettierConfig(language, options), plugins });
  } catch (err) {
    throw toFormatError(err, text, language);
  }
}

async function beautifySql(text: string, options: BeautifyOptions): Promise<string> {
  sqlPromise ??= import('sql-formatter');
  const { format } = await sqlPromise;
  const indent = options.indent ?? 2;
  try {
    return format(text, {
      language: options.dialect ?? 'sql',
      tabWidth: indent === 'tab' ? 2 : indent,
      useTabs: indent === 'tab',
      keywordCase: options.keywordCase ?? 'upper',
      linesBetweenQueries: 2,
    });
  } catch (err) {
    throw toFormatError(err, text, 'sql');
  }
}

// --- minify ------------------------------------------------------------------

/** Minify `source`. Throws `CodeFormatError` for syntax errors and unsupported languages. */
export async function minify(source: string, language: LanguageId): Promise<string> {
  const text = normalizeSource(source);
  if (text.trim() === '') return '';
  switch (LANGUAGES[language].minifier) {
    case 'html':
      return minifyHtml(text);
    case 'json':
      return minifyJsonText(text);
    case 'sql':
      return minifySql(text);
    case 'csso': {
      cssoPromise ??= import('csso');
      const csso = await cssoPromise;
      try {
        return csso.minify(text, { restructure: true }).css;
      } catch (err) {
        throw toFormatError(err, text, language);
      }
    }
    case 'terser': {
      terserPromise ??= import('terser');
      const terser = await terserPromise;
      try {
        const result = await terser.minify(text, { format: { comments: false }, sourceMap: false });
        return result.code ?? '';
      } catch (err) {
        throw toFormatError(err, text, language);
      }
    }
    default:
      throw new CodeFormatError(minifyUnavailableMessage(language) ?? `Minify is not available for ${LANGUAGES[language].label}.`);
  }
}

/** Minify JSON by re-serialising it. Reports the position of any syntax error. */
export function minifyJsonText(source: string): string {
  const text = normalizeSource(source);
  if (text.trim() === '') return '';
  try {
    return JSON.stringify(JSON.parse(text));
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    let offset = parseErrorOffset(raw, text);
    let detail = cleanJson(raw);
    if (offset === undefined) {
      const scanned = scanJsonError(text);
      if (scanned) {
        offset = scanned.offset;
        detail = scanned.message;
      }
    }
    if (offset === undefined) throw new CodeFormatError(`JSON syntax error: ${detail}`);
    const { line, column } = offsetToLineColumn(text, offset);
    throw new CodeFormatError(`JSON syntax error: ${detail} (line ${line}, column ${column})`, { line, column, offset });
  }
}

function cleanJson(raw: string): string {
  return raw
    .replace(/^JSON\.parse: /, '')
    .replace(/ in JSON at position \d+.*$/, '')
    .replace(/ at position \d+.*$/, '')
    .replace(/\s*\(line \d+ column \d+\)\s*$/, '')
    .replace(/,? .*is not valid JSON$/, '')
    .trim();
}

/**
 * Minify SQL: drop comments, collapse whitespace to single spaces and remove spaces
 * around punctuation, leaving string literals and quoted identifiers untouched.
 */
export function minifySql(source: string): string {
  const src = normalizeSource(source);
  const n = src.length;
  let out = '';
  let i = 0;
  let pendingSpace = false;
  const flushSpace = () => {
    if (pendingSpace && out && !/[(,]$/.test(out)) out += ' ';
    pendingSpace = false;
  };
  while (i < n) {
    const ch = src[i] as string;
    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\' && ch !== '[') {
          j += 2;
          continue;
        }
        if (src[j] === close) {
          if (close === ch && src[j + 1] === close) {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      flushSpace();
      out += src.slice(i, Math.min(n, j + 1));
      i = j + 1;
      continue;
    }
    if (ch === '-' && src[i + 1] === '-') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      pendingSpace = true;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      pendingSpace = true;
      continue;
    }
    if (/\s/.test(ch)) {
      pendingSpace = true;
      i++;
      continue;
    }
    if (ch === ',' || ch === ')' || ch === ';') {
      pendingSpace = false;
      out += ch;
      i++;
      continue;
    }
    if (ch === '(') {
      flushSpace();
      out += ch;
      i++;
      continue;
    }
    flushSpace();
    out += ch;
    i++;
  }
  return out.trim();
}

/** Tags whose text content must survive minification byte for byte. */
const RAW_TEXT_TAGS = new Set(['pre', 'textarea', 'script', 'style']);

/**
 * Minify HTML by hand: drop whitespace-only gaps between tags, collapse runs of
 * whitespace inside text to a single space, remove comments (conditional comments are
 * kept), and copy the contents of pre, textarea, script and style verbatim.
 */
export function minifyHtml(source: string): string {
  const src = normalizeSource(source);
  const n = src.length;
  let out = '';
  let i = 0;

  while (i < n) {
    if (src[i] !== '<') {
      const next = src.indexOf('<', i);
      const stop = next === -1 ? n : next;
      out += collapseText(src.slice(i, stop));
      i = stop;
      continue;
    }

    if (src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4);
      const stop = close === -1 ? n : close + 3;
      const body = src.slice(i + 4, close === -1 ? n : close);
      if (isConditionalComment(body)) out += src.slice(i, stop);
      i = stop;
      continue;
    }

    if (src.startsWith('<!', i) || src.startsWith('<?', i)) {
      const close = src.indexOf('>', i);
      const stop = close === -1 ? n : close + 1;
      out += collapseTag(src.slice(i, stop));
      i = stop;
      continue;
    }

    const match = /^<(\/?)([a-zA-Z][\w:.-]*)/.exec(src.slice(i, i + 200));
    if (!match) {
      out += '<';
      i += 1;
      continue;
    }

    const tagEnd = findTagEnd(src, i);
    const tag = src.slice(i, tagEnd);
    out += collapseTag(tag);
    i = tagEnd;

    const name = (match[2] as string).toLowerCase();
    if (match[1] === '' && RAW_TEXT_TAGS.has(name) && !tag.endsWith('/>')) {
      const rest = src.slice(i);
      const close = new RegExp(`</${name}\\s*>`, 'i').exec(rest);
      if (close) {
        out += rest.slice(0, close.index) + collapseTag(close[0]);
        i += close.index + close[0].length;
      } else {
        out += rest;
        i = n;
      }
    }
  }

  return out.trim();
}

function collapseText(text: string): string {
  if (text.trim() === '') return '';
  return text.replace(/\s+/g, ' ');
}

/** Collapse whitespace between attributes without touching quoted values. */
function collapseTag(tag: string): string {
  let out = '';
  let i = 0;
  while (i < tag.length) {
    const ch = tag[i] as string;
    if (ch === '"' || ch === "'") {
      const close = tag.indexOf(ch, i + 1);
      const stop = close === -1 ? tag.length : close + 1;
      out += tag.slice(i, stop);
      i = stop;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < tag.length && /\s/.test(tag[j] as string)) j++;
      if (!tag.slice(j).startsWith('>')) out += ' ';
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function isConditionalComment(body: string): boolean {
  const trimmed = body.trim();
  return /^\[if\b/i.test(trimmed) || /\[endif\]/i.test(trimmed);
}

/** Index just past the `>` that ends the tag starting at `start`. */
function findTagEnd(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const close = src.indexOf(ch, i + 1);
      i = close === -1 ? src.length : close + 1;
      continue;
    }
    if (ch === '>') return i + 1;
    i++;
  }
  return src.length;
}

// --- error normalisation -----------------------------------------------------

interface LocatedError {
  message?: string;
  loc?: { start?: { line?: number; column?: number } };
  line?: number;
  col?: number;
  column?: number;
}

/**
 * Turn a Prettier / terser / csso / sql-formatter error into a `CodeFormatError` with a
 * single readable line and a document position. Prettier appends a code frame to its
 * message; we keep only the first line and re-attach line/column ourselves.
 */
export function toFormatError(err: unknown, source: string, language: LanguageId): CodeFormatError {
  if (err instanceof CodeFormatError) return err;
  const e = (err ?? {}) as LocatedError;
  const raw = typeof e.message === 'string' ? e.message : typeof err === 'string' ? err : '';
  const first = raw.split('\n')[0] ?? '';
  const headline =
    first
      .replace(/^CssSyntaxError:\s*/, '')
      .replace(/^Parse error:\s*/, '')
      .replace(/\s*\(\d+:\d+\)\s*$/, '')
      .replace(/\s+at line \d+ column \d+\.?$/i, '')
      .trim() || 'the input could not be parsed';

  let line = e.loc?.start?.line ?? e.line;
  let column = e.loc?.start?.column ?? e.col ?? e.column;
  if (typeof line !== 'number') {
    const m = /line (\d+) column (\d+)/i.exec(raw);
    if (m) {
      line = Number(m[1]);
      column = Number(m[2]);
    }
  }
  const label = LANGUAGES[language].label;

  if (typeof line === 'number' && typeof column === 'number') {
    const offset = lineColumnToOffset(source, line, Math.max(1, column));
    return new CodeFormatError(`${label} syntax error: ${headline} (line ${line}, column ${column})`, { line, column, offset });
  }
  return new CodeFormatError(`${label} syntax error: ${headline}`);
}

// --- samples -----------------------------------------------------------------

export const SAMPLES: Record<LanguageId, string> = {
  html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Invoice 4821</title>
<!-- page chrome -->
<style>body{margin:0;font-family:system-ui}</style></head>
<body>
<main class="invoice"    id="main">
      <h1>Invoice   4821</h1>
  <p>Due <time datetime="2026-10-01">1 October 2026</time>.</p>
  <pre>  keep   this   spacing  </pre>
  <table><tr><td>Consulting</td><td>1,200.00</td></tr></table>
</main>
</body></html>`,
  css: `.card{display:flex;flex-direction:column;gap:1rem;padding:1.5rem;
border:1px solid rgb(226, 232, 240);border-radius:12px;background:#ffffff}
/* hover state */
.card:hover{border-color:#94a3b8;box-shadow:0 1px 2px rgba(0,0,0,0.06)}
.card__title{margin:0;font-size:1.125rem;font-weight:600;color:#0f172a}
@media (max-width:640px){.card{padding:1rem}}`,
  scss: `$radius: 12px;
$border: #e2e8f0;
.card{display:flex;flex-direction:column;gap:1rem;padding:1.5rem;
border:1px solid $border;border-radius:$radius;
&__title{margin:0;font-size:1.125rem;font-weight:600}
&:hover{border-color:#94a3b8}
@media (max-width:640px){padding:1rem}}`,
  javascript: `const ENDPOINT="/api/orders";
async function loadOrders(customerId,{status="open",limit=25}={}){
const params=new URLSearchParams({customerId,status,limit:String(limit)});
const response=await fetch(ENDPOINT+"?"+params,{headers:{Accept:"application/json"}});
if(!response.ok){throw new Error("Request failed: "+response.status)}
const {data}=await response.json();
return data.map(order=>({...order,total:Number(order.total)}))}
export {loadOrders};`,
  typescript: `interface Order{id:string;total:number;status:"open"|"paid"|"void"}
type Options={status?:Order["status"];limit?:number};
export async function loadOrders(customerId:string,{status="open",limit=25}:Options={}):Promise<Order[]>{
const params=new URLSearchParams({customerId,status,limit:String(limit)});
const response=await fetch("/api/orders?"+params);
if(!response.ok)throw new Error("Request failed: "+response.status);
const {data}=await response.json() as {data:Order[]};
return data}`,
  json: `{"id":4821,"customer":{"name":"Ada Lovelace","email":"ada@example.com"},
"lines":[{"sku":"CONS-01","description":"Consulting","qty":8,"unit":150},
{"sku":"SUP-14","description":"Support retainer","qty":1,"unit":420}],
"currency":"GBP","paid":false,"issued":"2026-09-01T10:15:00Z"}`,
  sql: `select o.id, c.name as customer, sum(l.qty*l.unit) as total from orders o
join customers c on c.id=o.customer_id left join order_lines l on l.order_id=o.id
where o.status in ('open','paid') and o.issued >= '2026-01-01' -- this year only
group by o.id, c.name having sum(l.qty*l.unit) > 1000 order by total desc limit 25;`,
};
