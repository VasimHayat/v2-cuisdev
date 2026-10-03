/**
 * Word Counter: pure functions, no DOM. Words and sentences are segmented with
 * Intl.Segmenter when the runtime has it (handles CJK, emoji and abbreviations) and
 * fall back to regular expressions otherwise.
 */

export const READING_WPM = 238;
export const SPEAKING_WPM = 150;

interface Segment {
  segment: string;
  isWordLike?: boolean;
}
interface SegmenterLike {
  segment(input: string): Iterable<Segment>;
}
type SegmenterCtor = new (locales?: string | string[], options?: { granularity: 'word' | 'sentence' }) => SegmenterLike;

function getSegmenter(granularity: 'word' | 'sentence'): SegmenterLike | null {
  const intl = Intl as unknown as { Segmenter?: SegmenterCtor };
  if (!intl.Segmenter) return null;
  try {
    return new intl.Segmenter(undefined, { granularity });
  } catch {
    return null;
  }
}

const HAS_LETTER = /[\p{L}\p{Nd}]/u;
const WORD_PATTERN = /[\p{L}\p{Nd}]+(?:['’-][\p{L}\p{Nd}]+)*/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

export function splitWordsRegex(text: string): string[] {
  return text.match(WORD_PATTERN) ?? [];
}

/**
 * Words with the segmenter, then rejoined across apostrophes and hyphens so that
 * "don't" and "state-of-the-art" count once, as people expect.
 */
export function splitWords(text: string, useSegmenter = true): string[] {
  const seg = useSegmenter ? getSegmenter('word') : null;
  if (!seg) return splitWordsRegex(text);
  const parts = [...seg.segment(text)];
  const words: string[] = [];
  let joinNext = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (p.isWordLike) {
      if (joinNext && words.length && !CJK.test(p.segment)) words[words.length - 1] += p.segment;
      else words.push(p.segment);
      joinNext = false;
      continue;
    }
    const next = parts[i + 1];
    joinNext = /^['’-]$/.test(p.segment) && !!next?.isWordLike && words.length > 0 && parts[i - 1]?.isWordLike === true;
    if (joinNext) words[words.length - 1] += p.segment;
  }
  return words;
}

export function splitSentencesRegex(text: string): string[] {
  return text
    .split(/(?<=[.!?…。！？]["'”’)\]]*)\s*|\n+/u)
    .map((s) => s.trim())
    .filter((s) => HAS_LETTER.test(s));
}

export function splitSentences(text: string, useSegmenter = true): string[] {
  const seg = useSegmenter ? getSegmenter('sentence') : null;
  if (!seg) return splitSentencesRegex(text);
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    for (const part of seg.segment(block)) {
      const t = part.segment.trim();
      if (HAS_LETTER.test(t)) out.push(t);
    }
  }
  return out;
}

export function countParagraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((b) => HAS_LETTER.test(b)).length;
}

export function countLines(text: string): number {
  if (text === '') return 0;
  return text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').length;
}

/** Grapheme count when available (an emoji family counts as one), code points otherwise. */
export function countCharacters(text: string): number {
  const intl = Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => { segment(s: string): Iterable<unknown> } };
  if (intl.Segmenter) {
    let n = 0;
    for (const _ of new intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) n++;
    return n;
  }
  return [...text].length;
}

export function countCharactersNoSpaces(text: string): number {
  return countCharacters(text.replace(/\s+/gu, ''));
}

/** "4 min 12 s", "38 s", "0 s". */
export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m} min ${rest} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

// --- stats ---------------------------------------------------------------------

export interface TextStats {
  words: number;
  characters: number;
  charactersNoSpaces: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  readingSeconds: number;
  speakingSeconds: number;
  averageWordLength: number;
  longestWord: string;
}

export function analyze(text: string, useSegmenter = true): TextStats {
  const words = splitWords(text, useSegmenter);
  const letters = words.reduce((n, w) => n + [...w].length, 0);
  let longest = '';
  for (const w of words) if ([...w].length > [...longest].length) longest = w;
  return {
    words: words.length,
    characters: countCharacters(text),
    charactersNoSpaces: countCharactersNoSpaces(text),
    sentences: splitSentences(text, useSegmenter).length,
    paragraphs: countParagraphs(text),
    lines: countLines(text),
    readingSeconds: (words.length / READING_WPM) * 60,
    speakingSeconds: (words.length / SPEAKING_WPM) * 60,
    averageWordLength: words.length ? Math.round((letters / words.length) * 10) / 10 : 0,
    longestWord: longest,
  };
}

// --- keyword density -------------------------------------------------------------

// prettier-ignore
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'done', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here',
  'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', "it's", 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or',
  'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some', 'such',
  'than', 'that', "that's", 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
  'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yourself',
  'yourselves', "don't", "can't", "won't", "isn't", "i'm", "you're", "we're", "they're",
]);

export interface DensityRow {
  term: string;
  count: number;
  /** Share of all words (single words) or of all word pairs (phrases), in percent. */
  percent: number;
}

export interface DensityOptions {
  excludeStopWords?: boolean;
  minLength?: number;
  limit?: number;
  useSegmenter?: boolean;
}

function normalizeWord(w: string): string {
  return w.toLocaleLowerCase().replace(/’/g, "'");
}

function rank(counts: Map<string, number>, total: number, limit: number): DensityRow[] {
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count, percent: total ? Math.round((count / total) * 1000) / 10 : 0 }));
}

/** Top single words, excluding stop words and short words when asked. */
export function keywordDensity(text: string, options: DensityOptions = {}): DensityRow[] {
  const { excludeStopWords = true, minLength = 3, limit = 15, useSegmenter = true } = options;
  const words = splitWords(text, useSegmenter).map(normalizeWord);
  const counts = new Map<string, number>();
  for (const w of words) {
    if ([...w].length < minLength && !CJK.test(w)) continue;
    if (excludeStopWords && STOP_WORDS.has(w)) continue;
    if (/^\d+$/.test(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return rank(counts, words.length, limit);
}

/** Top two-word phrases within sentences; pairs made only of stop words are skipped. */
export function phraseDensity(text: string, options: DensityOptions = {}): DensityRow[] {
  const { excludeStopWords = true, minLength = 3, limit = 15, useSegmenter = true } = options;
  const counts = new Map<string, number>();
  let total = 0;
  for (const sentence of splitSentences(text, useSegmenter)) {
    const words = splitWords(sentence, useSegmenter).map(normalizeWord);
    for (let i = 0; i + 1 < words.length; i++) {
      total++;
      const a = words[i]!;
      const b = words[i + 1]!;
      if (excludeStopWords && (STOP_WORDS.has(a) || STOP_WORDS.has(b))) continue;
      if ([...a].length < minLength && [...b].length < minLength) continue;
      const key = `${a} ${b}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return rank(counts, total, limit).filter((r) => r.count > 1);
}

// --- limits ----------------------------------------------------------------------

export interface LimitTarget {
  id: string;
  label: string;
  /** Unit counted against the limit. */
  unit: 'characters';
  min?: number;
  max: number;
}

export const LIMITS: readonly LimitTarget[] = [
  { id: 'x', label: 'X post', unit: 'characters', max: 280 },
  { id: 'meta', label: 'Meta description', unit: 'characters', min: 155, max: 160 },
  { id: 'title', label: 'SEO title', unit: 'characters', max: 60 },
  { id: 'sms', label: 'SMS', unit: 'characters', max: 160 },
];

export interface LimitStatus {
  target: LimitTarget;
  state: 'ok' | 'short' | 'over';
  /** Characters left (ok/short) or over the limit (over). */
  amount: number;
  text: string;
}

export function limitStatus(characters: number, target: LimitTarget): LimitStatus {
  if (characters > target.max) {
    const amount = characters - target.max;
    return { target, state: 'over', amount, text: `${amount} over` };
  }
  if (target.min !== undefined && characters < target.min) {
    const amount = target.max - characters;
    return { target, state: 'short', amount, text: `${target.min - characters} short of ${target.min}` };
  }
  const amount = target.max - characters;
  return { target, state: 'ok', amount, text: `${amount} left` };
}

export const SAMPLE_TEXT = `Writing for the web is different from writing for print. Readers scan before they read, so the first sentence of every paragraph has to carry its point. Short paragraphs help. So do clear headings and plain words.

A word counter answers the practical questions: is this meta description under 160 characters, will this post fit in a single tweet, how long will this talk take to deliver? Reading time assumes about 238 words per minute, the average for adults reading non-fiction on a screen. Speaking time assumes 150 words per minute, a comfortable presentation pace.

Keyword density shows which words dominate the text. If a page is about word counting, the phrase "word counter" should appear, but stuffing it into every sentence reads badly and helps nobody. Write for people first; the counts are a check, not a target.`;
