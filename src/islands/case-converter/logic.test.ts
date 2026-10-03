import { describe, expect, it } from 'vitest';
import {
  CASES,
  CaseConverterError,
  DEFAULT_OPTIONS,
  assertWithinLimit,
  convertAll,
  convertCase,
  formatAll,
  splitWords,
  textStats,
  toAlternatingCase,
  toCamelCase,
  toInverseCase,
  toPathCase,
  toSentenceCase,
  toSnakeCase,
  toTitleCase,
} from './logic';

describe('splitWords', () => {
  it('splits camel, Pascal and acronyms', () => {
    expect(splitWords('XMLHttpRequest')).toEqual(['XML', 'Http', 'Request']);
    expect(splitWords('lastUpdatedAt')).toEqual(['last', 'Updated', 'At']);
    expect(splitWords('user_id-first name')).toEqual(['user', 'id', 'first', 'name']);
  });
  it('keeps digits and Unicode letters', () => {
    expect(splitWords('html5 parser v2')).toEqual(['html5', 'parser', 'v2']);
    expect(splitWords('Grüße aus München')).toEqual(['Grüße', 'aus', 'München']);
    expect(splitWords('東京 タワー')).toEqual(['東京', 'タワー']);
  });
});

describe('identifier cases', () => {
  it('convert each line by default', () => {
    expect(toCamelCase('user id\nfirst-name')).toBe('userId\nfirstName');
    expect(toSnakeCase('XMLHttpRequest')).toBe('xml_http_request');
    expect(convertCase("don't stop", 'kebab')).toBe('dont-stop');
  });
  it('join the whole text when per-line is off', () => {
    expect(toCamelCase('user id\nfirst-name', false)).toBe('userIdFirstName');
    expect(convertCase('a b\nc', 'screaming-snake', { ...DEFAULT_OPTIONS, perLine: false })).toBe('A_B_C');
  });
  it('cover every identifier style', () => {
    const text = 'Last updated at';
    const values = Object.fromEntries(convertAll(text).map((r) => [r.id, r.value]));
    expect(values).toMatchObject({
      camel: 'lastUpdatedAt',
      pascal: 'LastUpdatedAt',
      snake: 'last_updated_at',
      'screaming-snake': 'LAST_UPDATED_AT',
      kebab: 'last-updated-at',
      train: 'Last-Updated-At',
      dot: 'last.updated.at',
      path: 'last/updated/at',
    });
    expect(toPathCase('src Components Button')).toBe('src/components/button');
  });
});

describe('title case', () => {
  it('lower-cases small words except first and last', () => {
    expect(toTitleCase('the lord of the rings')).toBe('The Lord of the Rings');
    expect(toTitleCase('what are you looking at')).toBe('What Are You Looking At');
  });
  it('follows AP and Chicago styles', () => {
    expect(toTitleCase('a walk through the park with friends', { style: 'ap' })).toBe('A Walk Through the Park With Friends');
    expect(toTitleCase('a walk through the park with friends', { style: 'chicago' })).toBe('A Walk through the Park with Friends');
  });
  it('keeps acronyms unless told otherwise', () => {
    expect(toTitleCase('the NASA API guide')).toBe('The NASA API Guide');
    expect(toTitleCase('the NASA API guide', { keepAcronyms: false })).toBe('The Nasa Api Guide');
  });
});

describe('prose cases', () => {
  it('sentence case capitalises sentences and lines', () => {
    expect(toSentenceCase('HELLO WORLD. how ARE you?\nnew line')).toBe('Hello world. How are you?\nNew line');
  });
  it('alternating and inverse', () => {
    expect(toAlternatingCase('hello world')).toBe('hElLo WoRlD');
    expect(toInverseCase('Hello World')).toBe('hELLO wORLD');
  });
});

describe('helpers', () => {
  it('has fourteen cases with unique ids', () => {
    expect(CASES).toHaveLength(14);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(14);
  });
  it('formats all results and counts text', () => {
    const out = formatAll(convertAll('ab'));
    expect(out.startsWith('UPPER CASE\nAB\n\nlower case\nab')).toBe(true);
    expect(textStats('one two\nthree')).toEqual({ chars: 13, words: 3, lines: 2 });
    expect(textStats('')).toEqual({ chars: 0, words: 0, lines: 0 });
  });
  it('enforces the size limit', () => {
    expect(() => assertWithinLimit('x'.repeat(200_001))).toThrow(CaseConverterError);
  });
});
