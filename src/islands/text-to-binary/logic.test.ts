import { describe, expect, it } from 'vitest';
import {
  BinaryError,
  DEFAULT_OPTIONS,
  SAMPLE_TEXT,
  byteTable,
  bytesToText,
  decode,
  detectListing,
  encode,
  findInvalidUtf8,
  parseBytes,
  textStats,
  textToBytes,
  type BinaryOptions,
} from './logic';

const O = (patch: Partial<BinaryOptions> = {}): BinaryOptions => ({ ...DEFAULT_OPTIONS, ...patch });

describe('encode', () => {
  it('writes UTF-8 bytes in binary, octal, decimal and hex', () => {
    expect(encode('Hi', O())).toBe('01001000 01101001');
    expect(encode('Hi', O({ representation: 'octal' }))).toBe('110 151');
    expect(encode('Hi', O({ representation: 'decimal', pad: false }))).toBe('72 105');
    expect(encode('é', O({ representation: 'hex' }))).toBe('C3 A9');
  });
  it('applies prefixes, separators, grouping and case', () => {
    expect(encode('Hi', O({ representation: 'hex', prefix: true, separator: 'comma', uppercase: false }))).toBe('0x48, 0x69');
    expect(encode('Hi', O({ representation: 'hex', separator: 'none' }))).toBe('4869');
    expect(encode('Hi!!', O({ representation: 'hex', group: 2 }))).toBe('4869 2121');
    expect(encode('A', O({ pad: false }))).toBe('1000001');
    expect(encode('A\nB', O({ representation: 'decimal', separator: 'newline' }))).toBe('065\n010\n066');
  });
  it('writes code points, including astral characters', () => {
    expect(encode('A👋', O({ representation: 'codepoint' }))).toBe('U+0041 U+1F44B');
  });
  it('supports UTF-16 and rejects characters outside Latin-1 and ASCII', () => {
    expect(encode('A', O({ representation: 'hex', encoding: 'utf16be' }))).toBe('00 41');
    expect(encode('A', O({ representation: 'hex', encoding: 'utf16le' }))).toBe('41 00');
    expect(encode('é', O({ representation: 'hex', encoding: 'latin1' }))).toBe('E9');
    let err: BinaryError | undefined;
    try {
      encode('ok é', O({ encoding: 'ascii' }));
    } catch (e) {
      err = e as BinaryError;
    }
    expect(err?.message).toMatch(/Character 4 "é" \(U\+00E9\) cannot be written in ASCII/);
    expect(err?.offset).toBe(3);
  });
});

describe('decode', () => {
  it('round-trips the sample in every representation', () => {
    for (const representation of ['binary', 'octal', 'decimal', 'hex', 'codepoint'] as const) {
      expect(decode(encode(SAMPLE_TEXT, O({ representation })), O({ representation }))).toBe(SAMPLE_TEXT);
    }
  });
  it('accepts prefixes, mixed separators and continuous runs', () => {
    expect(decode('0b01001000,0b01101001', O())).toBe('Hi');
    expect(decode('0100100001101001', O())).toBe('Hi');
    expect(decode('\\x48\\x69', O({ representation: 'hex' }))).toBe('Hi');
    expect(decode('48 69;0x21', O({ representation: 'hex' }))).toBe('Hi!');
    expect(decode('u+48 \\u0069 1F44B', O({ representation: 'codepoint' }))).toBe('Hi👋');
  });
  it('reports invalid digits and oversized values with positions', () => {
    expect(() => decode('01001000 0102', O())).toThrow(/"2" at position 13 is not a valid binary digit/);
    expect(() => decode('300', O({ representation: 'decimal' }))).toThrow(/larger than one byte/);
    expect(() => decode('010010000', O())).toThrow(/does not divide into 8-digit bytes/);
    try {
      decode('48 6G', O({ representation: 'hex' }));
    } catch (e) {
      expect((e as BinaryError).offset).toBe(4);
    }
  });
  it('explains invalid UTF-8 and odd UTF-16 lengths', () => {
    expect(() => decode('C3 28', O({ representation: 'hex' }))).toThrow(/Byte 1 \(C3 28\) does not start a valid UTF-8 sequence/);
    expect(() => decode('E2 82', O({ representation: 'hex' }))).toThrow(/valid UTF-8/);
    expect(() => decode('00 41 00', O({ representation: 'hex', encoding: 'utf16be' }))).toThrow(/even number of bytes/);
    expect(() => decode('80', O({ representation: 'hex', encoding: 'ascii' }))).toThrow(/outside 7-bit ASCII/);
    expect(decode('E9', O({ representation: 'hex', encoding: 'latin1' }))).toBe('é');
  });
  it('rejects bad code points', () => {
    expect(() => decode('U+110000', O({ representation: 'codepoint' }))).toThrow(/beyond the last Unicode code point/);
    expect(() => decode('U+D800', O({ representation: 'codepoint' }))).toThrow(/surrogate/);
    expect(() => decode('U+ZZ', O({ representation: 'codepoint' }))).toThrow(/not a code point/);
  });
});

describe('byte helpers', () => {
  it('finds invalid UTF-8 and converts UTF-16 both ways', () => {
    expect(findInvalidUtf8(new Uint8Array([0x48, 0xc3, 0xa9]))).toBe(-1);
    expect(findInvalidUtf8(new Uint8Array([0x48, 0xc0, 0x80]))).toBe(1);
    expect(findInvalidUtf8(new Uint8Array([0xed, 0xa0, 0x80]))).toBe(0);
    expect(bytesToText(textToBytes('a👋', 'utf16le'), 'utf16le')).toBe('a👋');
    expect(Array.from(parseBytes('7 15', 'octal'))).toEqual([7, 13]);
  });
  it('builds the byte table and stats', () => {
    expect(byteTable('é👋')).toEqual([
      { char: 'é', codePoint: 'U+00E9', hex: 'C3 A9', binary: '11000011 10101001' },
      { char: '👋', codePoint: 'U+1F44B', hex: 'F0 9F 91 8B', binary: '11110000 10011111 10010001 10001011' },
    ]);
    expect(byteTable('abc', 2)).toHaveLength(2);
    expect(textStats('é👋', 'utf8')).toEqual({ chars: 2, bytes: 6, bits: 48 });
    expect(textStats('é', 'ascii')).toEqual({ chars: 1, bytes: null, bits: null });
  });
  it('detects pasted listings', () => {
    expect(detectListing('01001000 01101001')).toBe('binary');
    expect(detectListing('48 65 6C 6C 6F')).toBe('hex');
    expect(detectListing('U+0048 U+0069')).toBe('codepoint');
    expect(detectListing('Hello world')).toBeNull();
  });
});
