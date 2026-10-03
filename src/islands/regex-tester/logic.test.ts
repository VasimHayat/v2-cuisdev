import { describe, expect, it } from 'vitest';
import {
  CHEATSHEET,
  DEFAULT_MATCH_LIMIT,
  RegexError,
  SAMPLE,
  buildRegex,
  captureGroupNames,
  describeMatchCount,
  findMatches,
  highlightSegments,
  matchesToText,
  normalizeFlags,
  replaceMatches,
  runRegex,
  validateFlags,
} from './logic';

describe('flags', () => {
  it('normalises and validates flags', () => {
    expect(normalizeFlags('ggi')).toBe('gi');
    expect(normalizeFlags(['g', 'im'])).toBe('gim');
    expect(() => validateFlags('gx')).toThrow(/Unknown flag "x"/);
    expect(() => validateFlags('uv')).toThrow(/cannot be used together/);
    expect(() => validateFlags('gimsuyd')).not.toThrow();
  });
  it('turns engine syntax errors into RegexError', () => {
    expect(() => buildRegex('(')).toThrow(RegexError);
    expect(() => buildRegex('a{2,1}')).toThrow(/Invalid regular expression/);
    expect(buildRegex('a', 'gi').flags).toBe('gi');
  });
});

describe('capture groups', () => {
  it('lists group names in order, ignoring non-capturing groups and classes', () => {
    expect(captureGroupNames('(a)(?<b>b)(?:c)(?=d)(?<!e)[(f)](g)')).toEqual([undefined, 'b', undefined]);
    expect(captureGroupNames('\\((x)')).toEqual([undefined]);
  });
  it('reports numbered and named groups with indices', () => {
    const { matches } = findMatches('(?<year>\\d{4})-(\\d{2})', 'g', 'on 2026-10 and 2027-01');
    expect(matches).toHaveLength(2);
    const first = matches[0]!;
    expect(first).toMatchObject({ value: '2026-10', start: 3, end: 10 });
    expect(first.groups[0]).toMatchObject({ index: 1, name: 'year', label: 'year', value: '2026', start: 3, end: 7 });
    expect(first.groups[1]).toMatchObject({ index: 2, name: undefined, label: '2', value: '10', start: 8, end: 10 });
  });
  it('marks groups that did not participate', () => {
    const { matches } = findMatches('(a)|(b)', '', 'b');
    expect(matches[0]!.groups[0]).toMatchObject({ value: undefined, start: -1, end: -1 });
    expect(matches[0]!.groups[1]!.value).toBe('b');
  });
});

describe('findMatches', () => {
  it('returns only the first match without g, every match with g', () => {
    expect(findMatches('o', '', 'foo boo').matches).toHaveLength(1);
    expect(findMatches('o', 'g', 'foo boo').matches.map((m) => m.start)).toEqual([1, 2, 5, 6]);
  });
  it('matches nothing for an empty pattern or empty text', () => {
    expect(findMatches('', 'g', 'abc').matches).toEqual([]);
    expect(findMatches('a', 'g', '').matches).toEqual([]);
  });
  it('advances past zero-length matches instead of looping', () => {
    const { matches, truncated } = findMatches('\\b', 'g', 'ab cd');
    expect(matches.map((m) => m.start)).toEqual([0, 2, 3, 5]);
    expect(truncated).toBe(false);
  });
  it('stops at the match limit and reports truncation', () => {
    const { matches, truncated } = findMatches('a', 'g', 'a'.repeat(50), { limit: 10 });
    expect(matches).toHaveLength(10);
    expect(truncated).toBe(true);
    expect(DEFAULT_MATCH_LIMIT).toBe(2000);
  });
  it('honours multiline and case-insensitive flags', () => {
    expect(findMatches('^b', 'gm', 'a\nb\nB').matches).toHaveLength(1);
    expect(findMatches('^b', 'gmi', 'a\nb\nB').matches).toHaveLength(2);
  });
});

describe('replacement and highlighting', () => {
  it('replaces with numbered and named references', () => {
    expect(replaceMatches('(?<first>\\w+) (?<last>\\w+)', '', 'Ada Lovelace', '$<last>, $<first>')).toBe('Lovelace, Ada');
    expect(replaceMatches('(\\d+)', 'g', 'a1 b22', '[$1]')).toBe('a[1] b[22]');
    expect(replaceMatches('o', '', 'foo', '0')).toBe('f0o');
    expect(replaceMatches('', 'g', 'keep', 'x')).toBe('keep');
  });
  it('builds highlight segments, skipping empty and overlapping matches', () => {
    const text = 'xaayaa';
    const { matches } = findMatches('aa', 'g', text);
    expect(highlightSegments(text, matches)).toEqual([
      { text: 'x', matchIndex: null },
      { text: 'aa', matchIndex: 0 },
      { text: 'y', matchIndex: null },
      { text: 'aa', matchIndex: 1 },
    ]);
    const overlapping = [
      { index: 0, value: 'abc', start: 0, end: 3, groups: [] },
      { index: 1, value: 'bc', start: 1, end: 3, groups: [] },
      { index: 2, value: '', start: 3, end: 3, groups: [] },
    ];
    expect(highlightSegments('abcd', overlapping)).toEqual([
      { text: 'abc', matchIndex: 0 },
      { text: 'd', matchIndex: null },
    ]);
  });
  it('formats match lists and counts', () => {
    const { matches } = findMatches('\\d', 'g', '1 2 3');
    expect(matchesToText(matches)).toBe('1\n2\n3');
    expect(describeMatchCount(0)).toBe('No matches');
    expect(describeMatchCount(1)).toBe('1 match');
    expect(describeMatchCount(2000, true)).toBe('First 2,000 matches (stopped at the limit)');
  });
});

describe('runRegex', () => {
  it('returns matches and the replacement in one call', () => {
    const r = runRegex({ pattern: SAMPLE.pattern, flags: SAMPLE.flags, text: SAMPLE.text, replacement: SAMPLE.replacement });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matches).toHaveLength(5);
    expect(r.matches[2]!.groups.find((g) => g.name === 'level')!.value).toBe('ERROR');
    expect(r.replaced!.split('\n')[0]).toBe('INFO at 09:14:02: Server started on port 8080');
    expect(r.replaced).toContain('debug: this line has no timestamp');
  });
  it('reports errors instead of throwing', () => {
    expect(runRegex({ pattern: '[', flags: 'g', text: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('Invalid regular expression') });
    expect(runRegex({ pattern: 'a', flags: 'q', text: 'x' })).toMatchObject({ ok: false, error: expect.stringContaining('Unknown flag') });
  });
  it('ships a usable cheat sheet', () => {
    expect(CHEATSHEET.length).toBeGreaterThanOrEqual(24);
    expect(CHEATSHEET.every((row) => row.token && row.meaning)).toBe(true);
  });
});
