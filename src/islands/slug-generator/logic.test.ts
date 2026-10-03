import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, applyReplacements, duplicateSlugs, parseReplacement, previewUrl, slugify, slugifyLines, transliterate, trimToLength } from './logic';

const O = DEFAULT_OPTIONS;

describe('transliterate', () => {
  it('strips accents and maps special Latin letters', () => {
    expect(transliterate('Crème Brûlée')).toBe('Creme Brulee');
    expect(transliterate('Straße Æsir Øre Łódź')).toBe('Strasse AEsir Ore Lodz');
  });
  it('supports German umlauts, Cyrillic and Greek', () => {
    expect(transliterate('Müller', true)).toBe('Mueller');
    expect(transliterate('Müller')).toBe('Muller');
    expect(transliterate('Как дела')).toBe('Kak dela');
    expect(transliterate('Ελληνική')).toBe('Elliniki');
  });
});

describe('slugify', () => {
  it('makes a clean lower-case slug', () => {
    expect(slugify('10 Tips & Tricks for Faster JavaScript in 2026')).toBe('10-tips-and-tricks-for-faster-javascript-in-2026');
    expect(slugify('  Hello,   World!  ')).toBe('hello-world');
    expect(slugify('Crème Brûlée: The Ultimate Guide')).toBe('creme-brulee-the-ultimate-guide');
  });
  it('honours separator, case and number options', () => {
    expect(slugify('Hello World 2', { ...O, separator: '_', lowercase: false })).toBe('Hello_World_2');
    expect(slugify('Top 10 Tips', { ...O, keepNumbers: false })).toBe('top-tips');
  });
  it('removes stop words but never everything', () => {
    expect(slugify('How to Write a Great Title', { ...O, removeStopWords: true })).toBe('write-great-title');
    expect(slugify('The And Of', { ...O, removeStopWords: true })).toBe('the-and-of');
  });
  it('applies replacements and transliteration together', () => {
    expect(slugify('C++ vs Rust @ Scale: 50% Less Memory?')).toBe('c-plus-plus-vs-rust-at-scale-50-percent-less-memory');
    expect(slugify('Müller & Söhne', { ...O, germanUmlauts: true })).toBe('mueller-and-soehne');
    expect(slugify('Как приготовить борщ')).toBe('kak-prigotovit-borshch');
  });
  it('can keep non-Latin letters when transliteration is off', () => {
    expect(slugify('Café Tokyo 東京', { ...O, transliterate: false })).toBe('café-tokyo-東京');
  });
});

describe('length and helpers', () => {
  it('trims at a word boundary', () => {
    expect(trimToLength('the-quick-brown-fox', 12, '-')).toBe('the-quick');
    expect(trimToLength('abcdefghij', 4, '-')).toBe('abcd');
    expect(slugify('the quick brown fox jumps', { ...O, maxLength: 15 })).toBe('the-quick-brown');
  });
  it('processes lines and finds duplicates', () => {
    expect(slugifyLines('Hello World\n\nhello, world!')).toEqual(['hello-world', '', 'hello-world']);
    expect(duplicateSlugs(['a', 'b', 'a', '', ''])).toEqual(['a']);
  });
  it('builds preview URLs and parses replacements', () => {
    expect(previewUrl('https://example.com/blog/', 'x')).toBe('https://example.com/blog/x');
    expect(previewUrl('https://example.com/blog', 'x')).toBe('https://example.com/blog/x');
    expect(parseReplacement('#=sharp')).toEqual({ from: '#', to: 'sharp' });
    expect(parseReplacement('nope')).toBeNull();
    expect(applyReplacements('R&D', [{ from: '&', to: 'and' }])).toBe('R and D');
  });
});
