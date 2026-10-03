/**
 * Slug Generator: pure functions, no DOM. Turns titles into URL slugs with
 * transliteration (Latin accents, German umlauts, Cyrillic, Greek), custom
 * replacements, stop-word removal and word-boundary trimming.
 */

export type Separator = '-' | '_' | '.';

export interface Replacement {
  from: string;
  to: string;
}

export interface SlugOptions {
  separator: Separator;
  lowercase: boolean;
  transliterate: boolean;
  /** ä becomes ae, ö becomes oe, ü becomes ue (German convention) instead of a, o, u. */
  germanUmlauts: boolean;
  removeStopWords: boolean;
  keepNumbers: boolean;
  /** 0 means no limit. Trimmed at a word boundary when possible. */
  maxLength: number;
  replacements: Replacement[];
}

export const DEFAULT_REPLACEMENTS: Replacement[] = [
  { from: '&', to: 'and' },
  { from: '+', to: 'plus' },
  { from: '@', to: 'at' },
  { from: '%', to: 'percent' },
];

export const DEFAULT_OPTIONS: SlugOptions = {
  separator: '-',
  lowercase: true,
  transliterate: true,
  germanUmlauts: false,
  removeStopWords: false,
  keepNumbers: true,
  maxLength: 0,
  replacements: DEFAULT_REPLACEMENTS,
};

/** Common English stop words removed when the option is on. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from', 'as', 'into', 'onto', 'about',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'how', 'what', 'why', 'when', 'where', 'which', 'who',
  'your', 'you', 'our', 'we', 'my', 'i', 'do', 'does', 'did', 'can', 'will', 'should', 'vs', 'via',
]);

/** Characters that do not decompose into a base letter plus accent under NFKD. */
const SPECIAL: Record<string, string> = {
  ß: 'ss', ẞ: 'SS', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ø: 'o', Ø: 'O', ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ð: 'd', Ð: 'D', þ: 'th', Þ: 'TH',
  ı: 'i', ħ: 'h', Ħ: 'H', ŋ: 'ng', Ŋ: 'NG', ĸ: 'k', ſ: 's', 'ƒ': 'f',
  '’': '', "'": '', '‘': '', '`': '', '´': '',
};

const GERMAN: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' };

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  є: 'ye', і: 'i', ї: 'yi', ґ: 'g', ў: 'u', ђ: 'dj', ј: 'j', љ: 'lj', њ: 'nj', ћ: 'c', џ: 'dz',
};

const GREEK: Record<string, string> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r',
  σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o', ά: 'a', έ: 'e', ή: 'i', ί: 'i', ό: 'o', ύ: 'y', ώ: 'o', ϊ: 'i', ϋ: 'y', ΐ: 'i', ΰ: 'y',
};

function scriptChar(char: string): string | undefined {
  const lowerChar = char.toLowerCase();
  const isUpper = lowerChar !== char;
  const mapped = CYRILLIC[lowerChar] ?? GREEK[lowerChar];
  if (mapped === undefined) return undefined;
  return isUpper && mapped ? mapped[0]!.toUpperCase() + mapped.slice(1) : mapped;
}

/** Replace accented and non-Latin letters with ASCII approximations. */
export function transliterate(text: string, germanUmlauts = false): string {
  let out = '';
  for (const char of text) {
    if (germanUmlauts && GERMAN[char] !== undefined) {
      out += GERMAN[char];
      continue;
    }
    if (SPECIAL[char] !== undefined) {
      out += SPECIAL[char];
      continue;
    }
    const script = scriptChar(char);
    if (script !== undefined) {
      out += script;
      continue;
    }
    // Strip combining marks after compatibility decomposition: é -> e, ﬁ -> fi.
    out += char.normalize('NFKD').replace(/\p{M}+/gu, '');
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Apply custom replacements as whole tokens with spaces around them, so "R&D" becomes "R and D". */
export function applyReplacements(text: string, replacements: readonly Replacement[]): string {
  let out = text;
  for (const r of replacements) {
    if (!r.from) continue;
    out = out.replace(new RegExp(escapeRegExp(r.from), 'g'), ` ${r.to} `);
  }
  return out;
}

/** Trim to `max` characters, cutting at the last separator when one falls inside the limit. */
export function trimToLength(slug: string, max: number, separator: string): string {
  if (max <= 0 || slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  if (slug[max] === separator) return cut.replace(new RegExp(`${escapeRegExp(separator)}+$`), '');
  const at = cut.lastIndexOf(separator);
  const trimmed = at > 0 ? cut.slice(0, at) : cut;
  return trimmed.replace(new RegExp(`${escapeRegExp(separator)}+$`), '');
}

/** Turn one title into a slug. */
export function slugify(title: string, options: SlugOptions = DEFAULT_OPTIONS): string {
  let text = applyReplacements(title, options.replacements);
  if (options.transliterate) text = transliterate(text, options.germanUmlauts);
  let words = text.split(/[^\p{L}\p{Nd}]+/u).filter(Boolean);
  if (!options.keepNumbers) words = words.filter((w) => !/^\p{Nd}+$/u.test(w));
  if (options.removeStopWords) {
    const kept = words.filter((w) => !STOP_WORDS.has(w.toLowerCase()));
    if (kept.length > 0) words = kept;
  }
  if (options.lowercase) words = words.map((w) => w.toLowerCase());
  const slug = words.join(options.separator);
  return trimToLength(slug, options.maxLength, options.separator);
}

/** Slugify each non-empty line; empty lines stay empty so the output lines up with the input. */
export function slugifyLines(text: string, options: SlugOptions = DEFAULT_OPTIONS): string[] {
  return text.split(/\r?\n/).map((line) => (line.trim() === '' ? '' : slugify(line, options)));
}

/** Slugs that appear more than once, so the UI can warn about collisions. */
export function duplicateSlugs(slugs: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const s of slugs) {
    if (!s) continue;
    if (seen.has(s)) dupes.add(s);
    seen.add(s);
  }
  return [...dupes];
}

/** base + slug, inserting a slash when the base lacks one. */
export function previewUrl(base: string, slug: string): string {
  const b = base.trim();
  if (!b) return slug;
  return b.endsWith('/') ? b + slug : `${b}/${slug}`;
}

/** Parse "from=to" pairs typed by the user. */
export function parseReplacement(text: string): Replacement | null {
  const i = text.indexOf('=');
  if (i <= 0) return null;
  return { from: text.slice(0, i), to: text.slice(i + 1).trim() };
}

export const SAMPLE = [
  '10 Tips & Tricks for Faster JavaScript in 2026',
  'Crème Brûlée: The Ultimate Guide',
  'Müller & Söhne GmbH Jahresbericht',
  'Как приготовить борщ',
  'Ελληνική σαλάτα συνταγή',
  'C++ vs Rust @ Scale: 50% Less Memory?',
].join('\n');
