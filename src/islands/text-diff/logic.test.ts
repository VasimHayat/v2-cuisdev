import { describe, expect, it } from 'vitest';
import {
  MAX_CHARS_FOR_CHARACTERS,
  SAMPLE_CHANGED,
  SAMPLE_ORIGINAL,
  TextDiffError,
  buildLineOps,
  computeDiff,
  diffSegments,
  formatStats,
  normalizeLine,
  splitLines,
  toInlineRows,
  toUnifiedDiff,
} from './logic';

describe('text helpers', () => {
  it('splits lines across BOM, CRLF and CR', () => {
    expect(splitLines('﻿a\r\nb\rc\n')).toEqual(['a', 'b', 'c']);
    expect(splitLines('')).toEqual([]);
  });
  it('applies ignore options', () => {
    expect(normalizeLine('  Hello   World ', { ignoreWhitespace: true, ignoreCase: true })).toBe('hello world');
  });
});

describe('line ops and rows', () => {
  it('pairs deletions with additions and keeps line numbers', () => {
    const { ops } = buildLineOps('a\nb\nc', 'a\nB\nc\nd');
    expect(ops.map((o) => o.type)).toEqual(['equal', 'del', 'add', 'equal', 'add']);
    expect(ops[1]).toMatchObject({ oldLine: 2, newLine: null, oldText: 'b' });
    expect(ops[4]).toMatchObject({ oldLine: null, newLine: 4, newText: 'd' });
  });
  it('treats an empty side as replace-all', () => {
    const { ops, approximate } = buildLineOps('', 'x\ny');
    expect(ops.map((o) => o.type)).toEqual(['add', 'add']);
    expect(approximate).toBe(false);
  });
  it('highlights words inside a changed line', () => {
    const { left, right } = diffSegments('listen 80;', 'listen 443 ssl;', 'words');
    expect(left.some((s) => s.kind === 'removed' && s.text === '80')).toBe(true);
    expect(right.some((s) => s.kind === 'added' && s.text.includes('443'))).toBe(true);
  });
  it('builds side-by-side rows with changed pairs', () => {
    const result = computeDiff(SAMPLE_ORIGINAL, SAMPLE_CHANGED, { granularity: 'words' });
    expect(result.identical).toBe(false);
    expect(result.stats).toEqual({ additions: 5, deletions: 4, unchanged: 6 });
    const kinds = result.rows.map((r) => r.kind);
    expect(kinds).toContain('changed');
    expect(kinds).toContain('added');
    expect(formatStats(result.stats)).toBe('5 additions · 4 deletions · 6 unchanged lines');
  });
  it('reports identical texts, honouring ignore options', () => {
    expect(computeDiff('a\nb', 'a\nb').identical).toBe(true);
    expect(computeDiff('A\n  b', 'a\nb', { ignoreCase: true, ignoreWhitespace: true }).identical).toBe(true);
    expect(computeDiff('A', 'a').identical).toBe(false);
  });
  it('orders inline rows deletions first', () => {
    const { ops } = buildLineOps('a\nb', 'a\nc');
    const rows = toInlineRows(ops, { granularity: 'chars' });
    expect(rows.map((r) => r.sign)).toEqual([' ', '-', '+']);
  });
  it('enforces the character-mode limit', () => {
    const big = 'x'.repeat(MAX_CHARS_FOR_CHARACTERS + 1);
    expect(() => computeDiff(big, '', { granularity: 'chars' })).toThrow(TextDiffError);
    expect(() => computeDiff(big, '', { granularity: 'lines' })).not.toThrow();
  });
});

describe('unified diff', () => {
  it('emits headers, hunks and context', () => {
    const patch = toUnifiedDiff('a\nb\nc\nd\ne\nf\ng\nh', 'a\nb\nc\nd\nE\nf\ng\nh', { context: 1 });
    expect(patch).toBe(['--- a/original.txt', '+++ b/changed.txt', '@@ -4,3 +4,3 @@', ' d', '-e', '+E', ' f', ''].join('\n'));
  });
  it('returns an empty string for identical texts', () => {
    expect(toUnifiedDiff('same', 'same')).toBe('');
  });
});
