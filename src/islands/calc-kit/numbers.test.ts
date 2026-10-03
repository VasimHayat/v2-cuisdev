import { describe, expect, it } from 'vitest';
import { formatNumber, fromQuery, parseNumber, round, toQuery } from './numbers';

describe('parseNumber', () => {
  it('reads dots, commas and thousands separators', () => {
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1234,5')).toBe(1234.5);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('0,5')).toBe(0.5);
    expect(parseNumber(' 12 ')).toBe(12);
    expect(parseNumber('-3.25')).toBe(-3.25);
    expect(parseNumber('1 000 000')).toBe(1000000);
  });
  it('rejects empty and junk input', () => {
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('-')).toBeNaN();
    expect(parseNumber('12abc')).toBeNaN();
  });
});

describe('formatting and rounding', () => {
  it('formats with grouping and trimmed decimals', () => {
    expect(formatNumber(1234.5, 2, 'en-US')).toBe('1,234.5');
    expect(formatNumber(Number.NaN)).toBe('–');
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(-2.675, 2)).toBe(-2.68);
  });
  it('round-trips state through the query string', () => {
    const q = toQuery({ a: '1', b: '', c: 'x y' });
    expect(q).toBe('a=1&c=x+y');
    expect(fromQuery(`?${q}&zz=1`, { a: '', b: '', c: '' })).toEqual({ a: '1', c: 'x y' });
  });
});
