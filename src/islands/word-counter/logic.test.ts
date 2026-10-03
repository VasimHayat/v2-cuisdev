import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  SAMPLE_TEXT,
  analyze,
  countCharacters,
  countCharactersNoSpaces,
  countLines,
  countParagraphs,
  formatDuration,
  keywordDensity,
  limitStatus,
  phraseDensity,
  splitSentences,
  splitWords,
} from './logic';

describe('words', () => {
  it('counts contractions and hyphenated words once, with and without the segmenter', () => {
    const text = "Don't stop: state-of-the-art tools rock.";
    expect(splitWords(text)).toEqual(["Don't", 'stop', 'state-of-the-art', 'tools', 'rock']);
    expect(splitWords(text, false)).toEqual(["Don't", 'stop', 'state-of-the-art', 'tools', 'rock']);
  });
  it('ignores punctuation and emoji, keeps numbers', () => {
    expect(splitWords('Hello, world! 🚀 2026 -- ok')).toEqual(['Hello', 'world', '2026', 'ok']);
  });
  it('segments CJK text into words', () => {
    expect(splitWords('我喜欢编程').length).toBeGreaterThan(1);
  });
});

describe('characters, lines and paragraphs', () => {
  it('counts graphemes so emoji families count once', () => {
    expect(countCharacters('a👨‍👩‍👧b')).toBe(3);
    expect(countCharactersNoSpaces('a b\tc\n')).toBe(3);
  });
  it('counts lines and paragraphs', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\r\nb\r\nc')).toBe(3);
    expect(countParagraphs('One.\n\nTwo.\n\n\n  \nThree.')).toBe(3);
  });
  it('splits sentences on terminal punctuation and line breaks', () => {
    expect(splitSentences('Hi there. How are you? Fine!')).toHaveLength(3);
    expect(splitSentences('Title\nBody text here.', false)).toHaveLength(2);
  });
});

describe('analyze', () => {
  it('computes the full stats block', () => {
    const s = analyze('The quick brown fox jumps over the lazy dog. Again!');
    expect(s.words).toBe(10);
    expect(s.sentences).toBe(2);
    expect(s.paragraphs).toBe(1);
    expect(s.longestWord).toBe('quick');
    expect(s.averageWordLength).toBe(4);
    expect(s.readingSeconds).toBeCloseTo((10 / 238) * 60, 5);
    expect(s.speakingSeconds).toBe(4);
  });
  it('handles empty text', () => {
    expect(analyze('')).toMatchObject({ words: 0, characters: 0, sentences: 0, lines: 0, averageWordLength: 0, longestWord: '' });
  });
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0 s');
    expect(formatDuration(38.4)).toBe('38 s');
    expect(formatDuration(252)).toBe('4 min 12 s');
    expect(formatDuration(120)).toBe('2 min');
    expect(formatDuration(3720)).toBe('1 h 2 min');
  });
});

describe('density', () => {
  it('ranks keywords, skipping stop words and short words', () => {
    const rows = keywordDensity('Cats like cats. The cat and the dog. Cats!');
    expect(rows[0]).toEqual({ term: 'cats', count: 3, percent: 33.3 });
    expect(rows.find((r) => r.term === 'the')).toBeUndefined();
    expect(keywordDensity('the the the', { excludeStopWords: false })[0]).toMatchObject({ term: 'the', count: 3, percent: 100 });
  });
  it('finds repeated two-word phrases within sentences', () => {
    const rows = phraseDensity(SAMPLE_TEXT);
    expect(rows.some((r) => r.term === 'word counter')).toBe(true);
    expect(phraseDensity('red apple. green apple.')).toEqual([]);
  });
});

describe('limits', () => {
  it('reports remaining, short and over', () => {
    const [x, meta] = LIMITS;
    expect(limitStatus(270, x!)).toMatchObject({ state: 'ok', text: '10 left' });
    expect(limitStatus(300, x!)).toMatchObject({ state: 'over', text: '20 over' });
    expect(limitStatus(150, meta!)).toMatchObject({ state: 'short', text: '5 short of 155' });
    expect(limitStatus(158, meta!)).toMatchObject({ state: 'ok', text: '2 left' });
  });
});
