/**
 * Lorem Ipsum Generator: pure functions, no DOM.
 *
 * Text comes from a seeded PRNG (mulberry32), so the same seed and options always give
 * the same output. The UI shows the seed and offers a reroll; tests pass a fixed seed.
 */

export class LoremError extends Error {
  override name = 'LoremError';
}

export const LOREM_UNITS = ['paragraphs', 'sentences', 'words', 'list'] as const;
export type LoremUnit = (typeof LOREM_UNITS)[number];

export const LOREM_FORMATS = ['plain', 'html', 'markdown'] as const;
export type LoremFormat = (typeof LOREM_FORMATS)[number];

export const FLAVOURS = ['latin', 'tech', 'english', 'office'] as const;
export type Flavour = (typeof FLAVOURS)[number];

export const MIN_COUNT = 1;
export const MAX_COUNT = 200;

export interface Range {
  min: number;
  max: number;
}

export interface LoremOptions {
  unit: LoremUnit;
  count: number;
  startWithLorem: boolean;
  flavour: Flavour;
  format: LoremFormat;
  /** Words per sentence. */
  sentenceLength: Range;
  /** Sentences per paragraph. */
  paragraphLength: Range;
  seed: number;
}

export const DEFAULT_OPTIONS: LoremOptions = {
  unit: 'paragraphs',
  count: 3,
  startWithLorem: true,
  flavour: 'latin',
  format: 'plain',
  sentenceLength: { min: 6, max: 14 },
  paragraphLength: { min: 4, max: 8 },
  seed: 42,
};

export interface LoremResult {
  items: string[];
  output: string;
  words: number;
  characters: number;
  seed: number;
}

export const CLASSIC_SENTENCE = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
export const CLASSIC_WORDS: readonly string[] = ['Lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit'];

const split = (s: string): string[] => s.trim().split(/\s+/);

export const VOCABULARIES: Record<Flavour, { label: string; words: readonly string[] }> = {
  latin: {
    label: 'Classic Latin',
    words: split(`lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua
      enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit
      voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt
      mollit anim id est laborum ac accumsan aenean aliquam ante arcu at auctor augue bibendum blandit condimentum congue convallis cras
      curabitur cursus dapibus diam dictum dignissim donec efficitur egestas eget eleifend elementum erat eros etiam euismod facilisis
      fames faucibus felis fermentum feugiat finibus fringilla fusce gravida habitant hendrerit iaculis imperdiet integer interdum justo
      lacinia lacus laoreet lectus leo libero ligula lobortis luctus maecenas malesuada massa mattis mauris maximus metus mi molestie morbi
      nam nec neque netus nibh nisl nullam nunc odio orci ornare pellentesque pharetra phasellus placerat porta porttitor posuere praesent
      pretium proin pulvinar purus quam quisque rhoncus risus rutrum sagittis sapien scelerisque sem semper senectus sodales sollicitudin
      suscipit suspendisse tellus tempus tincidunt tortor tristique turpis ultrices ultricies urna varius vehicula vel venenatis vestibulum
      vitae vivamus viverra volutpat vulputate`),
  },
  tech: {
    label: 'Startup jargon',
    words: split(`agile synergy leverage pipeline scalable cloud native platform roadmap stakeholder deliverable bandwidth onboarding
      microservice deploy runtime latency throughput dashboard metrics funnel retention growth pivot iterate sprint backlog velocity
      blockchain machine learning model inference vector embedding data lake serverless container cluster observability telemetry
      api endpoint webhook integration workflow automation seamless frictionless disruptive ecosystem paradigm stack frontend backend
      edge cache feature flag rollout canary experiment cohort churn monetize unicorn runway traction alignment visibility ownership
      north star outcome customer journey touchpoint`),
  },
  english: {
    label: 'Plain English',
    words: split(`the quick morning light settled over a quiet town where people walked slowly between small shops and open windows
      every corner held a story about friends family and long summer evenings near the river children laughed while old dogs slept
      under warm benches bread cooled on wooden tables and the market smelled of coffee apples and fresh rain someone waved from a
      balcony a bicycle bell rang twice clouds drifted east toward green hills letters waited by the door music played softly in a
      kitchen and the day moved on at its own gentle pace`),
  },
  office: {
    label: 'Office memo',
    words: split(`please note the quarterly review meeting agenda has moved to thursday kindly confirm attendance with your manager
      action items budget forecast policy update headcount approval invoice receipt reimbursement deadline compliance training
      calendar invite conference room projector minutes follow up circle back touch base going forward per our discussion as
      discussed attached document version final revised draft feedback consolidated sign off timeline milestone escalation team
      lunch reminder holiday schedule parking facilities announcement`),
  },
};

export const FORMAT_EXTENSIONS: Record<LoremFormat, string> = { plain: 'txt', html: 'html', markdown: 'md' };
export const FORMAT_MIME_TYPES: Record<LoremFormat, string> = { plain: 'text/plain', html: 'text/html', markdown: 'text/markdown' };

// --- PRNG ----------------------------------------------------------------------

/** mulberry32: tiny, fast 32-bit seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** A fresh seed for interactive use, kept to 6 digits so it is easy to read and share. */
export function randomSeed(): number {
  return 1 + Math.floor(Math.random() * 999_999);
}

// --- generation ----------------------------------------------------------------

export function capitalize(text: string): string {
  return text.length === 0 ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** Pick `count` words, never the same word twice in a row. */
export function pickWords(rng: () => number, count: number, vocabulary: readonly string[], previous = ''): string[] {
  if (vocabulary.length === 0) throw new LoremError('The vocabulary must not be empty.');
  const out: string[] = [];
  let prev = previous;
  for (let i = 0; i < count; i++) {
    let word = vocabulary[Math.floor(rng() * vocabulary.length)] as string;
    if (vocabulary.length > 1) while (word === prev) word = vocabulary[Math.floor(rng() * vocabulary.length)] as string;
    out.push(word);
    prev = word;
  }
  return out;
}

export function generateSentence(rng: () => number, vocabulary: readonly string[], length: Range = DEFAULT_OPTIONS.sentenceLength): string {
  const n = randomInt(rng, length.min, length.max);
  const words = pickWords(rng, n, vocabulary);
  if (n >= 8 && rng() < 0.6) {
    const at = randomInt(rng, 2, n - 3);
    words[at] = `${words[at]},`;
  }
  return `${capitalize(words.join(' '))}.`;
}

export function generateParagraph(rng: () => number, vocabulary: readonly string[], options: Pick<LoremOptions, 'sentenceLength' | 'paragraphLength'>, first?: string): string {
  const n = randomInt(rng, options.paragraphLength.min, options.paragraphLength.max);
  const sentences: string[] = [];
  if (first !== undefined) sentences.push(first);
  while (sentences.length < n) sentences.push(generateSentence(rng, vocabulary, options.sentenceLength));
  return sentences.join(' ');
}

function validRange(range: Range, label: string, floor: number, ceil: number): Range {
  const min = Math.round(range.min);
  const max = Math.round(range.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < floor || max > ceil || min > max) {
    throw new LoremError(`${label} must be a range between ${floor} and ${ceil} with the minimum not above the maximum.`);
  }
  return { min, max };
}

export function validateOptions(options: LoremOptions): LoremOptions {
  if (!LOREM_UNITS.includes(options.unit)) throw new LoremError(`Unknown unit "${String(options.unit)}".`);
  if (!LOREM_FORMATS.includes(options.format)) throw new LoremError(`Unknown format "${String(options.format)}".`);
  if (!FLAVOURS.includes(options.flavour)) throw new LoremError(`Unknown flavour "${String(options.flavour)}".`);
  const { count } = options;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) {
    throw new LoremError(`Count must be a whole number between ${MIN_COUNT} and ${MAX_COUNT}.`);
  }
  if (!Number.isFinite(options.seed)) throw new LoremError('Seed must be a number.');
  return {
    ...options,
    sentenceLength: validRange(options.sentenceLength, 'Words per sentence', 2, 40),
    paragraphLength: validRange(options.paragraphLength, 'Sentences per paragraph', 1, 20),
  };
}

/** Generate the raw units: one item per paragraph, sentence, word or list item. */
export function generateItems(input: LoremOptions): string[] {
  const opts = validateOptions(input);
  const rng = mulberry32(opts.seed);
  const vocab = VOCABULARIES[opts.flavour].words;
  const lorem = opts.startWithLorem;
  const items: string[] = [];
  switch (opts.unit) {
    case 'words': {
      if (lorem) items.push(...CLASSIC_WORDS.slice(0, opts.count));
      const rest = opts.count - items.length;
      if (rest > 0) items.push(...pickWords(rng, rest, vocab, items.at(-1) ?? ''));
      break;
    }
    case 'sentences':
      if (lorem) items.push(CLASSIC_SENTENCE);
      while (items.length < opts.count) items.push(generateSentence(rng, vocab, opts.sentenceLength));
      break;
    case 'list':
      if (lorem) items.push('Lorem ipsum dolor sit amet');
      while (items.length < opts.count) {
        const words = pickWords(rng, randomInt(rng, 2, Math.max(2, Math.min(8, opts.sentenceLength.max))), vocab);
        items.push(capitalize(words.join(' ')));
      }
      break;
    case 'paragraphs':
      if (lorem) items.push(generateParagraph(rng, vocab, opts, CLASSIC_SENTENCE));
      while (items.length < opts.count) items.push(generateParagraph(rng, vocab, opts));
      break;
  }
  return items;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Turn generated items into the requested output format. */
export function formatItems(items: readonly string[], unit: LoremUnit, format: LoremFormat): string {
  if (unit === 'list') {
    if (format === 'html') return `<ul>\n${items.map((i) => `  <li>${escapeHtml(i)}</li>`).join('\n')}\n</ul>`;
    if (format === 'markdown') return items.map((i) => `- ${i}`).join('\n');
    return items.join('\n');
  }
  if (format === 'html') {
    return unit === 'paragraphs' ? items.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n') : `<p>${escapeHtml(items.join(' '))}</p>`;
  }
  return unit === 'paragraphs' ? items.join('\n\n') : items.join(' ');
}

export function countWords(items: readonly string[]): number {
  let total = 0;
  for (const item of items) total += item.match(/\S+/g)?.length ?? 0;
  return total;
}

/** Generate and format in one call. Deterministic for a given seed. */
export function generateLorem(options: LoremOptions): LoremResult {
  const opts = validateOptions(options);
  const items = generateItems(opts);
  const output = formatItems(items, opts.unit, opts.format);
  return { items, output, words: countWords(items), characters: output.length, seed: opts.seed };
}
