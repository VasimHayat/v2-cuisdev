/**
 * Regex Tester: pure functions, no DOM. Everything the UI needs (matching, capture
 * groups, highlight segments, replacement) lives here so it can be unit tested and, in
 * the browser, run inside a Web Worker where a catastrophically backtracking pattern
 * cannot freeze the page.
 */

export class RegexError extends Error {
  override name = 'RegexError';
}

/** Flags a user may toggle. `d` (hasIndices) is added internally for group ranges. */
export const USER_FLAGS = ['g', 'i', 'm', 's', 'u', 'y'] as const;
export type RegexFlag = (typeof USER_FLAGS)[number];

export const FLAG_MEANINGS: Record<RegexFlag, string> = {
  g: 'Global: find every match, not just the first',
  i: 'Ignore case',
  m: 'Multiline: ^ and $ match at line breaks',
  s: 'Dot all: . also matches line breaks',
  u: 'Unicode: \\u{...} escapes and code point matching',
  y: 'Sticky: match only at lastIndex',
};

/** Matching stops here so a pathological pattern cannot produce a million rows. */
export const DEFAULT_MATCH_LIMIT = 2000;

export interface CaptureGroup {
  /** 1-based position of the group in the pattern. */
  index: number;
  /** Group name for (?<name>...), otherwise undefined. */
  name: string | undefined;
  /** `name` when the group is named, otherwise the number as a string. */
  label: string;
  /** undefined when the group did not participate in the match. */
  value: string | undefined;
  /** -1 when the group did not participate. */
  start: number;
  end: number;
}

export interface RegexMatch {
  /** 0-based position in the result list. */
  index: number;
  value: string;
  start: number;
  end: number;
  groups: CaptureGroup[];
}

export interface MatchOutcome {
  matches: RegexMatch[];
  /** True when matching stopped at the limit. */
  truncated: boolean;
}

export interface RegexRequest {
  pattern: string;
  flags: string;
  text: string;
  /** When set, the replacement result is computed too. */
  replacement?: string | undefined;
  limit?: number | undefined;
}

export type RegexResult =
  | {
      ok: true;
      matches: RegexMatch[];
      truncated: boolean;
      /** null when no replacement was requested. */
      replaced: string | null;
    }
  | { ok: false; error: string };

/** Remove duplicate flag characters, preserving the order they were given in. */
export function normalizeFlags(flags: string | readonly string[]): string {
  const chars = typeof flags === 'string' ? [...flags] : flags.flatMap((f) => [...f]);
  const seen = new Set<string>();
  for (const char of chars) if (char.trim() !== '') seen.add(char);
  return [...seen].join('');
}

/** Throw a friendly RegexError for flags the engine would reject cryptically. */
export function validateFlags(flags: string): void {
  const allowed: readonly string[] = [...USER_FLAGS, 'v'];
  for (const char of flags) {
    if (char === 'd') continue; // harmless, added internally
    if (!allowed.includes(char)) {
      throw new RegexError(`Unknown flag "${char}". Valid flags are g, i, m, s, u and y.`);
    }
  }
  if (flags.includes('u') && flags.includes('v')) {
    throw new RegexError('Flags u and v cannot be used together. v is the newer Unicode mode; pick one.');
  }
}

/**
 * Compile a pattern, turning the engine's SyntaxError into a RegexError with the
 * engine's own (usually very specific) message.
 */
export function buildRegex(pattern: string, flags: string | readonly string[] = ''): RegExp {
  const normalized = normalizeFlags(flags);
  validateFlags(normalized);
  try {
    return new RegExp(pattern, normalized);
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Invalid regular expression.';
    throw new RegexError(raw.replace(/^Invalid regular expression: \/.*\/[a-z]*: /, 'Invalid regular expression: '));
  }
}

/**
 * Names of the capturing groups in source order: undefined for a plain (...), the name
 * for (?<name>...). Non-capturing groups, lookarounds and anything inside a character
 * class are ignored.
 */
export function captureGroupNames(pattern: string): (string | undefined)[] {
  const names: (string | undefined)[] = [];
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (char === ']') inClass = false;
      continue;
    }
    if (char === '[') {
      inClass = true;
      continue;
    }
    if (char !== '(') continue;
    if (pattern[i + 1] !== '?') {
      names.push(undefined);
      continue;
    }
    const named = /^\(\?<(?![=!])([^>]*)>/.exec(pattern.slice(i));
    if (named) names.push(named[1]);
  }
  return names;
}

/** True when the flags make the regex walk the whole string. */
export function isGlobal(flags: string): boolean {
  return flags.includes('g') || flags.includes('y');
}

/**
 * Run `pattern` over `text` and collect every match with its capture groups. An empty
 * pattern matches nothing here (rather than every position), because an empty input
 * box should not report thousands of zero-length matches.
 */
export function findMatches(pattern: string, flags: string | readonly string[], text: string, options: { limit?: number } = {}): MatchOutcome {
  const limit = options.limit ?? DEFAULT_MATCH_LIMIT;
  const normalized = normalizeFlags(flags);
  validateFlags(normalized);
  if (pattern === '' || text === '') return { matches: [], truncated: false };

  const regex = buildRegex(pattern, normalizeFlags(`${normalized}d`));
  const names = captureGroupNames(pattern);
  const matches: RegexMatch[] = [];
  let truncated = false;

  if (!isGlobal(normalized)) {
    const single = regex.exec(text);
    if (single) matches.push(toMatch(single, 0, names));
    return { matches, truncated };
  }

  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (matches.length >= limit) {
      truncated = true;
      break;
    }
    matches.push(toMatch(m, matches.length, names));
    // A zero-length match would otherwise loop forever on the same index.
    if (m[0] === '') regex.lastIndex += 1;
    if (regex.lastIndex > text.length) break;
  }
  return { matches, truncated };
}

function toMatch(m: RegExpExecArray, index: number, names: (string | undefined)[]): RegexMatch {
  const start = m.index;
  const value = m[0] ?? '';
  const indices = (m as RegExpExecArray & { indices?: ([number, number] | undefined)[] }).indices;
  const groups: CaptureGroup[] = [];
  for (let i = 1; i < m.length; i++) {
    const name = names[i - 1];
    const range = indices?.[i];
    groups.push({
      index: i,
      name,
      label: name ?? String(i),
      value: m[i],
      start: range ? range[0] : -1,
      end: range ? range[1] : -1,
    });
  }
  return { index, value, start, end: start + value.length, groups };
}

/**
 * Apply a replacement string. $1, $<name>, $&, $`, $' and $$ behave exactly as they do
 * in String.prototype.replace, which is what this uses. Without the g flag only the
 * first match is replaced.
 */
export function replaceMatches(pattern: string, flags: string | readonly string[], text: string, replacement: string): string {
  if (pattern === '') return text;
  const regex = buildRegex(pattern, flags);
  return text.replace(regex, replacement);
}

export interface HighlightSegment {
  text: string;
  /** null for the text between matches. */
  matchIndex: number | null;
}

/**
 * Split `text` into plain and matched segments so the UI can rebuild it with <mark>
 * elements without touching innerHTML. Zero-length matches have nothing to highlight
 * and are skipped; overlapping matches keep the first one.
 */
export function highlightSegments(text: string, matches: readonly RegexMatch[]): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.end <= match.start) continue;
    if (match.start < cursor) continue;
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start), matchIndex: null });
    segments.push({ text: text.slice(match.start, match.end), matchIndex: match.index });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matchIndex: null });
  return segments;
}

/** One match per line, what the Copy matches button puts on the clipboard. */
export function matchesToText(matches: readonly RegexMatch[]): string {
  return matches.map((m) => m.value).join('\n');
}

export function describeMatchCount(count: number, truncated = false): string {
  if (truncated) return `First ${count.toLocaleString()} matches (stopped at the limit)`;
  if (count === 0) return 'No matches';
  if (count === 1) return '1 match';
  return `${count.toLocaleString()} matches`;
}

/**
 * Everything the UI needs, in one serializable call. This is what the Web Worker runs,
 * so a catastrophic pattern burns a worker instead of the page.
 */
export function runRegex(request: RegexRequest): RegexResult {
  try {
    const { matches, truncated } = findMatches(request.pattern, request.flags, request.text, {
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });
    const replaced = request.replacement === undefined ? null : replaceMatches(request.pattern, request.flags, request.text, request.replacement);
    return { ok: true, matches, truncated, replaced };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not run this regular expression.' };
  }
}

// --- sample and cheat sheet --------------------------------------------------

export const SAMPLE = {
  pattern: '(?<date>\\d{4}-\\d{2}-\\d{2}) (?<time>\\d{2}:\\d{2}:\\d{2}) \\[(?<level>INFO|WARN|ERROR)\\] (?<message>.+)',
  flags: 'gm',
  text: [
    '2026-10-03 09:14:02 [INFO] Server started on port 8080',
    '2026-10-03 09:14:05 [WARN] Cache miss for key user:4821',
    '2026-10-03 09:15:11 [ERROR] Payment gateway timeout after 30s',
    '2026-10-03 09:15:12 [INFO] Retrying payment for order 1193',
    'debug: this line has no timestamp and is not matched',
    '2026-10-03 09:16:40 [INFO] Payment confirmed for order 1193',
  ].join('\n'),
  replacement: '$<level> at $<time>: $<message>',
};

export const CHEATSHEET: { token: string; meaning: string }[] = [
  { token: '.', meaning: 'Any character except a line break' },
  { token: '\\d  \\D', meaning: 'Digit 0-9 / not a digit' },
  { token: '\\w  \\W', meaning: 'Word character [A-Za-z0-9_] / not one' },
  { token: '\\s  \\S', meaning: 'Whitespace / not whitespace' },
  { token: '\\b  \\B', meaning: 'Word boundary / not a boundary' },
  { token: '^  $', meaning: 'Start / end of input (of a line with the m flag)' },
  { token: '[abc]', meaning: 'One of a, b or c' },
  { token: '[^abc]', meaning: 'Any character except a, b or c' },
  { token: '[a-z]', meaning: 'Character in the range a to z' },
  { token: 'a|b', meaning: 'a or b' },
  { token: '*', meaning: 'Zero or more (greedy)' },
  { token: '+', meaning: 'One or more (greedy)' },
  { token: '?', meaning: 'Zero or one' },
  { token: '{n}  {n,}  {n,m}', meaning: 'Exactly n / at least n / between n and m' },
  { token: '*?  +?  ??', meaning: 'Lazy versions: match as little as possible' },
  { token: '(abc)', meaning: 'Capturing group, referenced as $1' },
  { token: '(?<name>abc)', meaning: 'Named group, referenced as $<name>' },
  { token: '(?:abc)', meaning: 'Non-capturing group' },
  { token: '\\1', meaning: 'Backreference to group 1' },
  { token: '(?=abc)', meaning: 'Lookahead: followed by abc' },
  { token: '(?!abc)', meaning: 'Negative lookahead: not followed by abc' },
  { token: '(?<=abc)', meaning: 'Lookbehind: preceded by abc' },
  { token: '(?<!abc)', meaning: 'Negative lookbehind: not preceded by abc' },
  { token: '\\.  \\*  \\(', meaning: 'Escape a metacharacter to match it literally' },
  { token: '\\n  \\t  \\uFFFF', meaning: 'Newline, tab, Unicode code unit' },
  { token: '\\p{L}', meaning: 'Unicode property, e.g. any letter (needs the u flag)' },
];
