import { describe, expect, it } from 'vitest';
import {
  AMBIGUOUS,
  DEFAULT_PASSPHRASE,
  DEFAULT_PASSWORD,
  DIGITS,
  LOWER,
  UPPER,
  crackTime,
  generatePassphrase,
  generatePassword,
  parsePrefs,
  passphraseEntropy,
  passwordEntropy,
  poolFor,
  randomInt,
  strength,
  validatePassword,
  type RandomSource,
} from './logic';
import { WORDS } from './words';

/** A source that replays fixed values, cycling. */
const seq = (values: number[]): RandomSource => {
  let i = 0;
  return (buf) => {
    for (let k = 0; k < buf.length; k++) buf[k] = values[i++ % values.length]! >>> 0;
  };
};

/** Small deterministic PRNG for repeatable distribution tests. */
const xorshift = (seed: number): RandomSource => {
  let x = seed >>> 0 || 1;
  return (buf) => {
    for (let k = 0; k < buf.length; k++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      buf[k] = x >>> 0;
    }
  };
};

describe('randomInt rejection sampling', () => {
  it('maps values below the limit with modulo and stays in range', () => {
    expect(randomInt(10, seq([0]))).toBe(0);
    expect(randomInt(10, seq([123456789]))).toBe(9);
    expect(randomInt(1, seq([999]))).toBe(0);
  });
  it('rejects values in the biased top slice and redraws', () => {
    // 2^32 % 10 = 6, so the top 6 values must be rejected.
    const top = 2 ** 32 - 1;
    expect(randomInt(10, seq([top, top - 5, 7]))).toBe(7);
    // top - 6 is the last accepted value
    expect(randomInt(10, seq([top - 6]))).toBe((top - 6) % 10);
  });
  it('rejects bad bounds', () => {
    expect(() => randomInt(0)).toThrow(RangeError);
    expect(() => randomInt(1.5)).toThrow(RangeError);
  });
  it('is roughly uniform over many draws', () => {
    const src = xorshift(42);
    const counts = new Array(6).fill(0);
    for (let i = 0; i < 60000; i++) counts[randomInt(6, src)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });
});

describe('passwords', () => {
  it('honours length and character classes', () => {
    const src = xorshift(7);
    for (let i = 0; i < 50; i++) {
      const p = generatePassword({ ...DEFAULT_PASSWORD, length: 16, symbols: false }, src);
      expect(p).toHaveLength(16);
      expect(p).toMatch(/^[A-Za-z0-9]+$/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
    }
  });
  it('excludes ambiguous characters and avoids repeats when asked', () => {
    const src = xorshift(9);
    const o = { ...DEFAULT_PASSWORD, length: 40, excludeAmbiguous: true, noRepeat: true };
    for (let i = 0; i < 30; i++) {
      const p = generatePassword(o, src);
      for (const c of AMBIGUOUS) expect(p.includes(c)).toBe(false);
      expect(new Set(p).size).toBe(p.length);
    }
  });
  it('uses a custom symbol set and builds the pool without duplicates', () => {
    const o = { ...DEFAULT_PASSWORD, upper: false, lower: false, digits: false, symbolSet: '@@##' };
    expect(poolFor(o)).toBe('@#');
    expect(generatePassword({ ...o, length: 6, requireEach: false }, xorshift(1))).toMatch(/^[@#]{6}$/);
  });
  it('validates impossible combinations', () => {
    expect(validatePassword({ ...DEFAULT_PASSWORD, upper: false, lower: false, digits: false, symbols: false })).toMatch(/at least one/);
    expect(validatePassword({ ...DEFAULT_PASSWORD, length: 3 })).toMatch(/between 4 and 128/);
    expect(validatePassword({ ...DEFAULT_PASSWORD, upper: false, lower: false, symbols: false, length: 12, noRepeat: true })).toMatch(/longest possible password is 10/);
    expect(() => generatePassword({ ...DEFAULT_PASSWORD, length: 200 })).toThrow(/between 4 and 128/);
  });
  it('computes entropy from the real pool', () => {
    const o = { ...DEFAULT_PASSWORD, length: 10, symbols: false };
    expect(poolFor(o)).toHaveLength(UPPER.length + LOWER.length + DIGITS.length);
    expect(passwordEntropy(o)).toBeCloseTo(10 * Math.log2(62), 6);
    const nr = { ...o, digits: false, upper: false, length: 3, noRepeat: true };
    expect(passwordEntropy(nr)).toBeCloseTo(Math.log2(26 * 25 * 24), 6);
  });
});

describe('passphrases', () => {
  it('has a large, clean word list', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(2048);
    expect(new Set(WORDS).size).toBe(WORDS.length);
    for (const w of WORDS) expect(w).toMatch(/^[a-z]{3,8}$/);
  });
  it('joins the chosen number of words with options applied', () => {
    const p = generatePassphrase({ words: 4, separator: '.', capitalize: true, addNumber: true, addSymbol: false }, xorshift(3));
    const parts = p.split('.');
    expect(parts).toHaveLength(4);
    for (const part of parts) expect(part).toMatch(/^[A-Z][a-z]+\d?$/);
    expect(p.match(/\d/g)).toHaveLength(1);
    const plain = generatePassphrase({ ...DEFAULT_PASSPHRASE, words: 2, capitalize: false, addNumber: false }, xorshift(4));
    expect(plain.split('-')).toHaveLength(3); // clamped to the minimum of 3
  });
  it('computes passphrase entropy', () => {
    expect(passphraseEntropy({ ...DEFAULT_PASSPHRASE, words: 5, addNumber: false, addSymbol: false }, 2048)).toBeCloseTo(55, 6);
    expect(passphraseEntropy({ ...DEFAULT_PASSPHRASE, words: 5, addNumber: true, addSymbol: false }, 2048)).toBeCloseTo(55 + Math.log2(10) + Math.log2(5), 6);
  });
});

describe('strength and prefs', () => {
  it('labels strength and estimates crack time', () => {
    expect(strength(20).label).toBe('Very weak');
    expect(strength(50).label).toBe('Fair');
    expect(strength(128).label).toBe('Very strong');
    expect(crackTime(10)).toBe('less than a second');
    expect(crackTime(50)).toMatch(/hours|minutes/);
    expect(crackTime(128)).toMatch(/billion years|universe/);
  });
  it('restores only valid options from storage', () => {
    const p = parsePrefs({ mode: 'passphrase', password: { length: 999, upper: 'yes' }, passphrase: { words: 2, separator: '----' }, count: 1000 });
    expect(p.mode).toBe('passphrase');
    expect(p.password.length).toBe(128);
    expect(p.password.upper).toBe(true);
    expect(p.passphrase.words).toBe(3);
    expect(p.passphrase.separator).toBe('-');
    expect(p.count).toBe(100);
    expect(parsePrefs(null).mode).toBe('password');
  });
});
