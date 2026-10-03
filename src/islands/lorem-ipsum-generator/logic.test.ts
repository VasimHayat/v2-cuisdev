import { describe, expect, it } from 'vitest';
import {
  CLASSIC_SENTENCE,
  DEFAULT_OPTIONS,
  LoremError,
  VOCABULARIES,
  capitalize,
  countWords,
  formatItems,
  generateItems,
  generateLorem,
  mulberry32,
  pickWords,
  type LoremOptions,
} from './logic';

const opts = (patch: Partial<LoremOptions>): LoremOptions => ({ ...DEFAULT_OPTIONS, ...patch });

describe('PRNG and helpers', () => {
  it('mulberry32 is deterministic for a seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
  it('never repeats a word twice in a row', () => {
    const words = pickWords(mulberry32(1), 500, ['a', 'b']);
    for (let i = 1; i < words.length; i++) expect(words[i]).not.toBe(words[i - 1]);
  });
  it('capitalizes and counts words', () => {
    expect(capitalize('hello')).toBe('Hello');
    expect(capitalize('')).toBe('');
    expect(countWords(['one two', ' three '])).toBe(3);
  });
});

describe('generation', () => {
  it('is reproducible with the same seed and differs with another', () => {
    expect(generateLorem(opts({ seed: 123 })).output).toBe(generateLorem(opts({ seed: 123 })).output);
    expect(generateLorem(opts({ seed: 123 })).output).not.toBe(generateLorem(opts({ seed: 124 })).output);
  });
  it('starts with the classic opening when asked', () => {
    expect(generateItems(opts({ unit: 'sentences', count: 3 }))[0]).toBe(CLASSIC_SENTENCE);
    expect(generateItems(opts({ unit: 'paragraphs', count: 1 }))[0]?.startsWith(CLASSIC_SENTENCE)).toBe(true);
    expect(generateItems(opts({ unit: 'words', count: 3 }))).toEqual(['Lorem', 'ipsum', 'dolor']);
    expect(generateItems(opts({ unit: 'sentences', count: 2, startWithLorem: false }))[0]).not.toBe(CLASSIC_SENTENCE);
  });
  it('produces exactly the requested count for each unit', () => {
    expect(generateItems(opts({ unit: 'paragraphs', count: 5 }))).toHaveLength(5);
    expect(generateItems(opts({ unit: 'sentences', count: 9 }))).toHaveLength(9);
    expect(generateItems(opts({ unit: 'words', count: 37 }))).toHaveLength(37);
    expect(generateItems(opts({ unit: 'list', count: 6 }))).toHaveLength(6);
  });
  it('honours sentence and paragraph length ranges', () => {
    const items = generateItems(opts({ unit: 'sentences', count: 50, startWithLorem: false, sentenceLength: { min: 3, max: 4 } }));
    for (const s of items) expect(countWords([s])).toBeGreaterThanOrEqual(3), expect(countWords([s])).toBeLessThanOrEqual(4);
    const paras = generateItems(opts({ unit: 'paragraphs', count: 10, startWithLorem: false, paragraphLength: { min: 2, max: 2 } }));
    for (const p of paras) expect(p.match(/\./g)?.length).toBe(2);
  });
  it('uses the chosen flavour vocabulary', () => {
    const words = generateItems(opts({ unit: 'words', count: 40, startWithLorem: false, flavour: 'tech' }));
    const vocab = new Set(VOCABULARIES.tech.words);
    expect(words.every((w) => vocab.has(w))).toBe(true);
  });
  it('rejects bad options with a reason', () => {
    expect(() => generateLorem(opts({ count: 0 }))).toThrow(LoremError);
    expect(() => generateLorem(opts({ count: 2.5 }))).toThrow(/whole number/);
    expect(() => generateLorem(opts({ sentenceLength: { min: 9, max: 3 } }))).toThrow(/Words per sentence/);
    expect(() => generateLorem(opts({ unit: 'bogus' as never }))).toThrow(/Unknown unit/);
  });
});

describe('formatting', () => {
  it('formats paragraphs as plain, HTML and Markdown', () => {
    expect(formatItems(['A b.', 'C d.'], 'paragraphs', 'plain')).toBe('A b.\n\nC d.');
    expect(formatItems(['A <b>.'], 'paragraphs', 'html')).toBe('<p>A &lt;b&gt;.</p>');
    expect(formatItems(['A.', 'B.'], 'sentences', 'html')).toBe('<p>A. B.</p>');
  });
  it('formats list items for each format', () => {
    expect(formatItems(['One', 'Two'], 'list', 'markdown')).toBe('- One\n- Two');
    expect(formatItems(['One', 'Two'], 'list', 'html')).toBe('<ul>\n  <li>One</li>\n  <li>Two</li>\n</ul>');
    expect(formatItems(['One', 'Two'], 'list', 'plain')).toBe('One\nTwo');
  });
  it('reports words, characters and the seed', () => {
    const r = generateLorem(opts({ unit: 'words', count: 10, seed: 5 }));
    expect(r.words).toBe(10);
    expect(r.characters).toBe(r.output.length);
    expect(r.seed).toBe(5);
  });
});
