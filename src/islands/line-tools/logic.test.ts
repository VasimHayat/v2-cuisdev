import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, dedupeLines, joinLines, naturalCompare, processLines, seededRandom, sortKey, sortLines, splitLines, type LineOptions } from './logic';

const O = (p: Partial<LineOptions> = {}): LineOptions => ({ ...DEFAULT_OPTIONS, ...p });

describe('split and join', () => {
  it('handles CRLF and a trailing newline', () => {
    expect(splitLines('a\r\nb\r\n')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('\n')).toEqual(['']);
    expect(joinLines(['a', 'b'])).toBe('a\nb\n');
  });
});

describe('dedupe', () => {
  const lines = ['a', 'B', ' a ', 'b', 'c', 'a'];
  it('keeps the first occurrence, trimming for comparison', () => {
    expect(dedupeLines(lines, { dedupe: 'unique', ignoreCase: false, trimCompare: true, keep: 'first' }).lines).toEqual(['a', 'B', 'b', 'c']);
  });
  it('ignores case and keeps the last occurrence', () => {
    const r = dedupeLines(lines, { dedupe: 'unique', ignoreCase: true, trimCompare: true, keep: 'last' });
    expect(r.lines).toEqual(['b', 'c', 'a']);
    expect(r.removed).toBe(3);
  });
  it('shows only duplicates and counts occurrences', () => {
    expect(dedupeLines(lines, { dedupe: 'duplicates-only', ignoreCase: true, trimCompare: true, keep: 'first' }).lines).toEqual(['a', 'B']);
    expect(dedupeLines(lines, { dedupe: 'count', ignoreCase: true, trimCompare: true, keep: 'first' }).lines).toEqual(['3\ta', '2\tB', '1\tc']);
  });
  it('does nothing when off', () => {
    expect(dedupeLines(lines, { dedupe: 'off', ignoreCase: false, trimCompare: false, keep: 'first' }).lines).toEqual(lines);
  });
});

describe('sorting', () => {
  it('compares naturally, including negatives and decimals', () => {
    expect(['file10', 'file2', 'file1'].sort((a, b) => naturalCompare(a, b))).toEqual(['file1', 'file2', 'file10']);
    expect(['10', '-3.5', '2', '0.5'].sort((a, b) => naturalCompare(a, b))).toEqual(['-3.5', '0.5', '2', '10']);
  });
  it('sorts A to Z with a locale collator and Z to A', () => {
    const base = { sortIgnoreCase: true, locale: true, sensitivity: 'base' as const, column: 0, delimiter: ',', seed: 1 };
    expect(sortLines(['b', 'Äpfel', 'apple', 'C'], { ...base, sort: 'az' })).toEqual(['Äpfel', 'apple', 'b', 'C']);
    expect(sortLines(['b', 'a', 'c'], { ...base, sort: 'za' })).toEqual(['c', 'b', 'a']);
  });
  it('sorts by length, reverses and shuffles reproducibly', () => {
    const base = { sortIgnoreCase: true, locale: false, sensitivity: 'base' as const, column: 0, delimiter: ',', seed: 7 };
    expect(sortLines(['ccc', 'a', 'bb'], { ...base, sort: 'length' })).toEqual(['a', 'bb', 'ccc']);
    expect(sortLines(['1', '2', '3'], { ...base, sort: 'reverse' })).toEqual(['3', '2', '1']);
    const s1 = sortLines(['a', 'b', 'c', 'd', 'e'], { ...base, sort: 'shuffle' });
    expect(sortLines(['a', 'b', 'c', 'd', 'e'], { ...base, sort: 'shuffle' })).toEqual(s1);
    expect([...s1].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('sorts by a delimited column', () => {
    expect(sortKey('x,y,z', 2, ',')).toBe('y');
    expect(sortKey('x\ty', 2, '\\t')).toBe('y');
    const rows = ['bob,30', 'alice,4', 'carol,12'];
    expect(sortLines(rows, { sort: 'natural', sortIgnoreCase: true, locale: false, sensitivity: 'base', column: 2, delimiter: ',', seed: 1 })).toEqual(['alice,4', 'carol,12', 'bob,30']);
  });
  it('produces stable seeded randomness', () => {
    const r = seededRandom(42);
    const v = [r(), r(), r()];
    const r2 = seededRandom(42);
    expect([r2(), r2(), r2()]).toEqual(v);
    expect(v.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('pipeline', () => {
  it('trims, removes empties, dedupes, sorts and numbers', () => {
    const r = processLines('  b\n\na\nb \nA\n', O({ trim: true, removeEmpty: true, ignoreCase: true, sort: 'az', lineNumbers: true }));
    expect(r.lines).toEqual(['1. a', '2. b']);
    expect(r).toMatchObject({ inputCount: 5, outputCount: 2, duplicatesRemoved: 2, emptyRemoved: 1, duplicateGroups: 2 });
  });
  it('adds prefixes and suffixes', () => {
    expect(processLines('a\nb', O({ dedupe: 'off', prefix: "'", suffix: "'," })).lines).toEqual(["'a',", "'b',"]);
  });
  it('keeps count mode ordering by count', () => {
    expect(processLines('x\ny\ny', O({ dedupe: 'count', sort: 'az' })).lines).toEqual(['2\ty', '1\tx']);
  });
});
