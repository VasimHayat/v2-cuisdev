import { describe, expect, it } from 'vitest';
import {
  BaseError,
  bitLength,
  bitsOf,
  byteLength,
  deserialize,
  formatValue,
  fromTwosComplement,
  groupDigits,
  parseInBase,
  rangeWarning,
  readInput,
  renderField,
  serialize,
  toTwosComplement,
  toggleBit,
  type ConvertOptions,
} from './logic';

const OPT: ConvertOptions = { signed: false, width: 32 };
const text = (input: string, from: number, to: number, o: Partial<ConvertOptions> = {}) => renderField(readInput(input, from, { ...OPT, ...o }), to, { ...OPT, ...o }).text;

describe('parsing', () => {
  it('reads every base with prefixes and separators', () => {
    expect(parseInBase('0xDEAD_BEEF', 16)).toEqual({ num: 3735928559n, den: 1n });
    expect(parseInBase('0b1010 1010', 2).num).toBe(170n);
    expect(parseInBase('0o777', 8).num).toBe(511n);
    expect(parseInBase('1,234,567', 10).num).toBe(1234567n);
    expect(parseInBase('-z', 36).num).toBe(-35n);
  });
  it('handles integers far beyond 64 bits exactly', () => {
    const big = parseInBase('1' + '0'.repeat(40), 10).num;
    expect(text(big.toString(), 10, 16)).toBe('1d6329f1c35ca4bfabb9f5610000000000');
    expect(parseInBase(big.toString(16), 16).num).toBe(big);
  });
  it('reports the position of an invalid digit', () => {
    try {
      parseInBase('1012', 2);
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BaseError);
      expect((e as BaseError).position).toBe(3);
      expect((e as BaseError).message).toMatch(/"2" is not a valid binary digit/);
    }
    expect(() => parseInBase('1.2.3', 10)).toThrow(/one radix point/);
    expect(() => parseInBase('  ', 10)).toThrow(/at least one digit/);
  });
});

describe('formatting', () => {
  it('converts between bases', () => {
    expect(text('255', 10, 2)).toBe('11111111');
    expect(text('255', 10, 8)).toBe('377');
    expect(text('255', 10, 16)).toBe('ff');
    expect(text('ff', 16, 10)).toBe('255');
    expect(text('255', 10, 36)).toBe('73');
  });
  it('groups, uppercases and prefixes', () => {
    expect(text('3735928559', 10, 16, { group: true, uppercase: true, prefix: true })).toBe('0xDEAD BEEF');
    expect(text('1234567', 10, 10, { group: true })).toBe('1,234,567');
    expect(text('255', 10, 2, { group: true, prefix: true })).toBe('0b1111 1111');
    expect(groupDigits('1010101', 4, ' ')).toBe('101 0101');
  });
  it('shows repeating fractions', () => {
    const tenth = parseInBase('0.1', 10);
    expect(formatValue(tenth, 2)).toEqual({ text: '0.0(0011)', repeats: true, truncated: false });
    expect(formatValue(parseInBase('0.625', 10), 2).text).toBe('0.101');
    expect(formatValue(parseInBase('0.1', 2), 10).text).toBe('0.5');
    expect(formatValue({ num: 1n, den: 3n }, 10).text).toBe('0.(3)');
  });
});

describe("two's complement", () => {
  it('converts both ways and checks the range', () => {
    expect(toTwosComplement(-1n, 8)).toBe(255n);
    expect(toTwosComplement(-128n, 8)).toBe(128n);
    expect(fromTwosComplement(0x80n, 8)).toBe(-128n);
    expect(() => toTwosComplement(128n, 8)).toThrow(/does not fit/);
  });
  it('renders negative values as padded patterns in signed mode', () => {
    expect(text('-1', 10, 2, { signed: true, width: 8 })).toBe('11111111');
    expect(text('-2', 10, 16, { signed: true, width: 16 })).toBe('fffe');
    expect(text('-1', 10, 2)).toBe('-1');
  });
  it('reads bit patterns as signed input', () => {
    expect(text('ff', 16, 10, { signed: true, width: 8 })).toBe('-1');
    expect(text('7f', 16, 10, { signed: true, width: 8 })).toBe('127');
    expect(() => readInput('1ff', 16, { signed: true, width: 8 })).toThrow(/wider than 8 bits/);
    expect(rangeWarning({ num: 200n, den: 1n }, { signed: true, width: 8 })).toMatch(/does not fit/);
  });
});

describe('bits and serialisation', () => {
  it('builds and toggles the bit grid', () => {
    const v = { num: 5n, den: 1n };
    expect(bitsOf(v, 8, false)).toEqual([false, false, false, false, false, true, false, true]);
    expect(toggleBit(v, 0, 8, false).num).toBe(133n);
    expect(toggleBit(v, 0, 8, true).num).toBe(-123n);
    expect(bitsOf({ num: -1n, den: 1n }, 8, false)).toBeNull();
    expect(bitsOf({ num: 1n, den: 2n }, 8, false)).toBeNull();
  });
  it('measures bit and byte length', () => {
    expect(bitLength(255n)).toBe(8);
    expect(bitLength(256n)).toBe(9);
    expect(byteLength(256n)).toBe(2);
    expect(bitLength(0n)).toBe(0);
  });
  it('serialises exact values for the URL', () => {
    expect(serialize({ num: -5n, den: 1n })).toBe('-5');
    expect(serialize(parseInBase('0.1', 10))).toBe('1/10');
    expect(deserialize('1/10')).toEqual({ num: 1n, den: 10n });
    expect(deserialize('2/4')).toEqual({ num: 1n, den: 2n });
    expect(deserialize('x')).toBeNull();
    expect(deserialize('1/0')).toBeNull();
  });
});
