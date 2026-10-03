import { describe, expect, it } from 'vitest';
import {
  HashError,
  SAMPLE_TEXT,
  base64ToHex,
  chunkBlob,
  compareHash,
  formatDigest,
  guessAlgorithmByLength,
  hashBlob,
  hashOne,
  hashText,
  hexToBytes,
  tableToText,
} from './logic';

describe('known vectors', () => {
  it('matches standard test vectors', async () => {
    expect(await hashOne('md5', '')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(await hashOne('sha1', 'abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await hashOne('sha256', 'abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await hashOne('crc32', '123456789')).toBe('cbf43926');
  });
  it('computes HMAC-SHA256', async () => {
    expect(await hashOne('sha256', SAMPLE_TEXT, 'key')).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });
  it('returns null for algorithms without HMAC when a key is set', async () => {
    const t = await hashText('x', ['crc32', 'md5'], { hmacKey: 'k' });
    expect(t.crc32).toBeNull();
    expect(typeof t.md5).toBe('string');
    await expect(hashOne('blake3', 'x', 'k')).rejects.toThrow(HashError);
  });
  it('hashes many algorithms in one pass', async () => {
    const t = await hashText('abc', ['md5', 'sha1', 'sha256', 'sha512', 'sha3-256', 'blake3', 'xxhash64']);
    expect(Object.keys(t)).toHaveLength(7);
    expect(t.sha512).toHaveLength(128);
    expect(t.xxhash64).toHaveLength(16);
  });
});

describe('formatting', () => {
  it('formats as uppercase hex or Base64', () => {
    const hex = 'd41d8cd98f00b204e9800998ecf8427e';
    expect(formatDigest(hex, { uppercase: true })).toBe(hex.toUpperCase());
    expect(formatDigest(hex, { base64: true })).toBe('1B2M2Y8AsgTpgAmY7PhCfg==');
    expect(base64ToHex('1B2M2Y8AsgTpgAmY7PhCfg==')).toBe(hex);
    expect(base64ToHex('not base64!')).toBeNull();
  });
  it('builds the Copy all text', async () => {
    const t = await hashText('abc', ['md5', 'sha1']);
    expect(tableToText(t, ['md5', 'sha1'], {}, false)).toBe('MD5: 900150983cd24fb0d6963f7d28e17f72\nSHA-1: a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(tableToText(t, ['md5'], {}, true)).toMatch(/^HMAC-MD5: /);
  });
});

describe('hex input', () => {
  it('parses hex with separators and a 0x prefix', async () => {
    expect([...hexToBytes('0x61 62:63')]).toEqual([0x61, 0x62, 0x63]);
    const t = await hashText('61-62-63', ['sha256'], { hexInput: true });
    expect(t.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('rejects odd lengths and non-hex digits', () => {
    expect(() => hexToBytes('abc')).toThrow(/odd number/);
    expect(() => hexToBytes('zz')).toThrow(/not a hex digit/);
  });
});

describe('compareHash', () => {
  it('matches hex in any case, with prefixes, or as Base64', async () => {
    const t = await hashText('abc', ['md5', 'sha256']);
    expect(compareHash('  BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD ', t)).toMatchObject({ status: 'match', algorithm: 'sha256' });
    expect(compareHash('sha256: ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', t)).toMatchObject({ status: 'match', algorithm: 'sha256' });
    expect(compareHash('kAFQmDzST7DWlj99KOF/cg==', t)).toMatchObject({ status: 'match', algorithm: 'md5' });
  });
  it('reports empty and no-match', async () => {
    const t = await hashText('abc', ['md5']);
    expect(compareHash('   ', t)).toEqual({ status: 'empty' });
    expect(compareHash('deadbeef', t)).toEqual({ status: 'no-match' });
  });
  it('guesses algorithms by digest length', () => {
    expect(guessAlgorithmByLength('d41d8cd98f00b204e9800998ecf8427e').map((a) => a.id)).toEqual(['md5']);
    expect(guessAlgorithmByLength('x').length).toBe(0);
  });
});

describe('blobs', () => {
  it('streams a Blob in chunks and matches text hashing', async () => {
    const text = 'a'.repeat(10_000);
    const fromText = await hashText(text, ['sha256', 'md5']);
    let progress = 0;
    const blob = new Blob([text]);
    const fromBlob = await hashBlob(blob, ['sha256', 'md5'], {}, (n) => (progress = n));
    expect(fromBlob).toEqual(fromText);
    expect(progress).toBe(10_000);
    const sizes: number[] = [];
    for await (const c of chunkBlob(blob, 4096)) sizes.push(c.length);
    expect(sizes).toEqual([4096, 4096, 1808]);
  });
  it('hashes an empty Blob', async () => {
    expect((await hashBlob(new Blob([]), ['md5'])).md5).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
});
