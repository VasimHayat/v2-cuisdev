/**
 * Case Converter: pure functions, no DOM.
 *
 * Prose cases (UPPER, lower, Title, Sentence, aLtErNaTiNg, InVeRsE) work on the text as
 * written so punctuation and spacing survive. Identifier cases (camelCase, snake_case,
 * ...) run the word splitter, by default over each line separately, because a list of
 * names should convert to a list of identifiers.
 */

export class CaseConverterError extends Error {
  override name = 'CaseConverterError';
}

/** Fourteen conversions of a long text is a lot of work; keep the input sane. */
export const MAX_CHARS = 200_000;

export function assertWithinLimit(text: string): void {
  if (text.length <= MAX_CHARS) return;
  throw new CaseConverterError(`Text is ${text.length.toLocaleString('en-US')} characters. The limit is ${MAX_CHARS.toLocaleString('en-US')}, so convert a smaller section.`);
}

// --- word splitting --------------------------------------------------------------

/**
 * Matches, in order: an acronym run before a capitalised word (XML in XMLHttpRequest),
 * a normal word with optional internal apostrophes and trailing digits (Http, don't,
 * html5), an all-caps run, a bare number, and any other letter run (scripts without
 * upper and lower case).
 */
const WORD_PATTERN = /\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+(?:['’]\p{L}+)*\p{Nd}*|\p{Lu}+\p{Nd}*|\p{Nd}+|\p{L}+\p{Nd}*/gu;

/** splitWords('XMLHttpRequest') gives ['XML', 'Http', 'Request']. */
export function splitWords(text: string): string[] {
  return text.match(WORD_PATTERN) ?? [];
}

/** Words with apostrophes removed: don't is one identifier part, dont. */
export function identifierWords(text: string): string[] {
  return splitWords(text)
    .map((word) => word.replace(/['’]/g, ''))
    .filter((word) => word !== '');
}

const lower = (w: string) => w.toLocaleLowerCase();
const upper = (w: string) => w.toLocaleUpperCase();

/** Upper-case the first character (code point safe), lower-case the rest. */
export function capitalize(word: string): string {
  const chars = [...word.toLocaleLowerCase()];
  const first = chars[0];
  if (first === undefined) return '';
  return first.toLocaleUpperCase() + chars.slice(1).join('');
}

function mapLines(text: string, fn: (line: string) => string): string {
  return text
    .split('\n')
    .map((line) => fn(line.replace(/\r$/, '')))
    .join('\n');
}

// --- title case ----------------------------------------------------------------------

export type TitleStyle = 'simple' | 'ap' | 'chicago';

const SIMPLE_SMALL = ['a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'but', 'or'];
/** AP: articles, coordinating conjunctions and prepositions of three letters or fewer. */
const AP_SMALL = ['a', 'an', 'the', 'and', 'but', 'or', 'for', 'nor', 'yet', 'so', 'at', 'by', 'in', 'of', 'off', 'on', 'out', 'per', 'to', 'up', 'via', 'as'];
/** Chicago: articles, coordinating conjunctions and every preposition regardless of length. */
const CHICAGO_SMALL = [
  ...AP_SMALL,
  'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'beyond',
  'during', 'except', 'from', 'inside', 'into', 'like', 'near', 'onto', 'over', 'past', 'since', 'through', 'toward', 'towards', 'under', 'until',
  'upon', 'with', 'within', 'without',
];

export const TITLE_SMALL_WORDS: Readonly<Record<TitleStyle, ReadonlySet<string>>> = {
  simple: new Set(SIMPLE_SMALL),
  ap: new Set(AP_SMALL),
  chicago: new Set(CHICAGO_SMALL),
};

export interface TitleOptions {
  style?: TitleStyle;
  /** Leave all-caps words of two or more letters (NASA, API) as they are. */
  keepAcronyms?: boolean;
}

/**
 * Title Case aware of small words: "the lord of the rings" becomes "The Lord of the
 * Rings". The first and last word of each line are always capitalised.
 */
export function toTitleCase(text: string, options: TitleOptions = {}): string {
  const small = TITLE_SMALL_WORDS[options.style ?? 'simple'];
  const keepAcronyms = options.keepAcronyms ?? true;
  return mapLines(text, (line) => {
    const tokens = line.split(/(\s+)/);
    const positions = tokens.map((t, i) => (t.trim() === '' ? -1 : i)).filter((i) => i >= 0);
    const first = positions[0];
    const last = positions.at(-1);
    return tokens
      .map((token, index) => {
        if (token.trim() === '') return token;
        const bare = token.replace(/[^\p{L}\p{Nd}'’]/gu, '');
        if (keepAcronyms && bare.length >= 2 && /\p{Lu}/u.test(bare) && bare === upper(bare) && !/^\p{Nd}+$/u.test(bare)) return token;
        if (index !== first && index !== last && small.has(lower(bare))) return lower(token);
        return capitalizeToken(token);
      })
      .join('');
  });
}

/** Lower-case a token, then upper-case its first letter, skipping leading punctuation. */
function capitalizeToken(token: string): string {
  let done = false;
  return [...token.toLocaleLowerCase()]
    .map((char) => {
      if (done || char.toLocaleUpperCase() === char.toLocaleLowerCase()) return char;
      done = true;
      return char.toLocaleUpperCase();
    })
    .join('');
}

// --- prose cases -----------------------------------------------------------------

export function toUpperCase(text: string): string {
  return text.toLocaleUpperCase();
}

export function toLowerCase(text: string): string {
  return text.toLocaleLowerCase();
}

/** Sentence case: lower-case, then capitalise the first letter of the text, each line and each sentence. */
export function toSentenceCase(text: string): string {
  return text.toLocaleLowerCase().replace(/(^|[.!?]["'”’)\]]?[ \t]+|\n[ \t]*)(\p{L})/gu, (_m, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`);
}

/** aLtErNaTiNg case, starting lower; characters without case are skipped. */
export function toAlternatingCase(text: string): string {
  let useUpper = false;
  let out = '';
  for (const char of text) {
    const lo = char.toLocaleLowerCase();
    const up = char.toLocaleUpperCase();
    if (lo === up) {
      out += char;
      continue;
    }
    out += useUpper ? up : lo;
    useUpper = !useUpper;
  }
  return out;
}

/** InVeRsE case: every letter swaps case. */
export function toInverseCase(text: string): string {
  let out = '';
  for (const char of text) {
    const up = char.toLocaleUpperCase();
    out += char === up ? char.toLocaleLowerCase() : up;
  }
  return out;
}

// --- identifier cases -------------------------------------------------------------

type Joiner = (words: string[]) => string;

const JOINERS = {
  camel: (w: string[]) => w.map((x, i) => (i === 0 ? lower(x) : capitalize(x))).join(''),
  pascal: (w: string[]) => w.map(capitalize).join(''),
  snake: (w: string[]) => w.map(lower).join('_'),
  'screaming-snake': (w: string[]) => w.map(upper).join('_'),
  kebab: (w: string[]) => w.map(lower).join('-'),
  train: (w: string[]) => w.map(capitalize).join('-'),
  dot: (w: string[]) => w.map(lower).join('.'),
  path: (w: string[]) => w.map(lower).join('/'),
} satisfies Record<string, Joiner>;

function joinIdentifier(text: string, join: Joiner, perLine: boolean): string {
  if (perLine) return mapLines(text, (line) => join(identifierWords(line)));
  return join(identifierWords(text));
}

export const toCamelCase = (t: string, perLine = true) => joinIdentifier(t, JOINERS.camel, perLine);
export const toPascalCase = (t: string, perLine = true) => joinIdentifier(t, JOINERS.pascal, perLine);
export const toSnakeCase = (t: string, perLine = true) => joinIdentifier(t, JOINERS.snake, perLine);
export const toScreamingSnakeCase = (t: string, perLine = true) => joinIdentifier(t, JOINERS['screaming-snake'], perLine);
export const toKebabCase = (t: string, perLine = true) => joinIdentifier(t, JOINERS.kebab, perLine);
export const toTrainCase = (t: string, perLine = true) => joinIdentifier(t, JOINERS.train, perLine);
export const toDotCase = (t: string, perLine = true) => joinIdentifier(t, JOINERS.dot, perLine);
export const toPathCase = (t: string, perLine = true) => joinIdentifier(t, JOINERS.path, perLine);

// --- the table of conversions -----------------------------------------------------------

export type CaseId =
  | 'upper'
  | 'lower'
  | 'title'
  | 'sentence'
  | 'camel'
  | 'pascal'
  | 'snake'
  | 'screaming-snake'
  | 'kebab'
  | 'train'
  | 'dot'
  | 'path'
  | 'alternating'
  | 'inverse';

export interface ConvertOptions {
  /** Identifier cases convert each line separately. */
  perLine: boolean;
  titleStyle: TitleStyle;
  keepAcronyms: boolean;
}

export const DEFAULT_OPTIONS: ConvertOptions = { perLine: true, titleStyle: 'simple', keepAcronyms: true };

export interface CaseDefinition {
  id: CaseId;
  /** Name written in the case it produces. */
  label: string;
  /** Where it is normally used. */
  hint: string;
  /** Identifier cases respond to the per-line option. */
  identifier: boolean;
  convert: (text: string, options: ConvertOptions) => string;
}

export const CASES: readonly CaseDefinition[] = [
  { id: 'upper', label: 'UPPER CASE', hint: 'Headings, emphasis', identifier: false, convert: (t) => toUpperCase(t) },
  { id: 'lower', label: 'lower case', hint: 'Normalising input', identifier: false, convert: (t) => toLowerCase(t) },
  { id: 'title', label: 'Title Case', hint: 'Headlines, titles', identifier: false, convert: (t, o) => toTitleCase(t, { style: o.titleStyle, keepAcronyms: o.keepAcronyms }) },
  { id: 'sentence', label: 'Sentence case', hint: 'Body copy, UI text', identifier: false, convert: (t) => toSentenceCase(t) },
  { id: 'camel', label: 'camelCase', hint: 'JavaScript variables', identifier: true, convert: (t, o) => toCamelCase(t, o.perLine) },
  { id: 'pascal', label: 'PascalCase', hint: 'Classes, components', identifier: true, convert: (t, o) => toPascalCase(t, o.perLine) },
  { id: 'snake', label: 'snake_case', hint: 'Python, SQL columns', identifier: true, convert: (t, o) => toSnakeCase(t, o.perLine) },
  { id: 'screaming-snake', label: 'SCREAMING_SNAKE', hint: 'Constants, env vars', identifier: true, convert: (t, o) => toScreamingSnakeCase(t, o.perLine) },
  { id: 'kebab', label: 'kebab-case', hint: 'URLs, CSS classes', identifier: true, convert: (t, o) => toKebabCase(t, o.perLine) },
  { id: 'train', label: 'Train-Case', hint: 'HTTP headers', identifier: true, convert: (t, o) => toTrainCase(t, o.perLine) },
  { id: 'dot', label: 'dot.case', hint: 'Config keys, namespaces', identifier: true, convert: (t, o) => toDotCase(t, o.perLine) },
  { id: 'path', label: 'path/case', hint: 'File paths, routes', identifier: true, convert: (t, o) => toPathCase(t, o.perLine) },
  { id: 'alternating', label: 'aLtErNaTiNg', hint: 'Memes and mockery', identifier: false, convert: (t) => toAlternatingCase(t) },
  { id: 'inverse', label: 'InVeRsE', hint: 'Fixing a stuck Caps Lock', identifier: false, convert: (t) => toInverseCase(t) },
];

export function isCaseId(value: unknown): value is CaseId {
  return typeof value === 'string' && CASES.some((c) => c.id === value);
}

export function getCase(id: CaseId): CaseDefinition {
  const found = CASES.find((c) => c.id === id);
  if (!found) throw new CaseConverterError(`Unknown case "${id}".`);
  return found;
}

export function convertCase(text: string, id: CaseId, options: ConvertOptions = DEFAULT_OPTIONS): string {
  assertWithinLimit(text);
  return getCase(id).convert(text, options);
}

export interface CaseResult {
  id: CaseId;
  label: string;
  hint: string;
  value: string;
}

export function convertAll(text: string, options: ConvertOptions = DEFAULT_OPTIONS): CaseResult[] {
  assertWithinLimit(text);
  return CASES.map((d) => ({ id: d.id, label: d.label, hint: d.hint, value: d.convert(text, options) }));
}

/** Every conversion as labelled plain text, for Copy all. */
export function formatAll(results: readonly CaseResult[]): string {
  return results.map((r) => `${r.label}\n${r.value}`).join('\n\n');
}

/** Counts for the status bar. */
export function textStats(text: string): { chars: number; words: number; lines: number } {
  return { chars: [...text].length, words: splitWords(text).length, lines: text === '' ? 0 : text.split('\n').length };
}

export const SAMPLE = 'the lord of the rings: the return of the king\nXMLHttpRequest returns JSON from the NASA API\nuser_id\nfirst-name\nlastUpdatedAt';
