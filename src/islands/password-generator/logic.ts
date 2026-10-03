/**
 * Password and passphrase generation: pure functions. Randomness comes from an
 * injectable source (crypto.getRandomValues in the browser) and indices are drawn with
 * rejection sampling, so every choice is uniform with no modulo bias. Nothing here
 * stores or sends what it generates.
 */
import { WORDS } from './words';

/** Fills the array with random 32-bit values. */
export type RandomSource = (buf: Uint32Array) => void;

export const cryptoSource: RandomSource = (buf) => {
  crypto.getRandomValues(buf);
};

/**
 * Uniform integer in [0, max) by rejection sampling: values in the incomplete top
 * slice of the 32-bit range are discarded and redrawn.
 */
export function randomInt(max: number, source: RandomSource = cryptoSource): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError(`max must be an integer from 1 to 2^32, got ${max}`);
  if (max === 1) return 0;
  const range = 2 ** 32;
  const limit = range - (range % max); // largest multiple of max that fits
  const buf = new Uint32Array(1);
  for (let tries = 0; tries < 1000; tries++) {
    source(buf);
    const v = buf[0]!;
    if (v < limit) return v % max;
  }
  throw new Error('Random source did not produce a usable value');
}

/** Fisher-Yates shuffle with unbiased indices. */
export function shuffle<T>(items: readonly T[], source: RandomSource = cryptoSource): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, source);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// --- passwords ---------------------------------------------------------------

export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const DIGITS = '0123456789';
export const DEFAULT_SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';
/** Characters that are easy to confuse when read or typed. */
export const AMBIGUOUS = 'Il1O0o|`\'"';

export interface PasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  symbolSet: string;
  excludeAmbiguous: boolean;
  /** Guarantee at least one character from every selected class. */
  requireEach: boolean;
  /** Never use the same character twice. */
  noRepeat: boolean;
}

export const DEFAULT_PASSWORD: PasswordOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  symbolSet: DEFAULT_SYMBOLS,
  excludeAmbiguous: false,
  requireEach: true,
  noRepeat: false,
};

export class PasswordError extends Error {
  override name = 'PasswordError';
}

const uniqueChars = (s: string) => [...new Set([...s])].join('');

/** The character classes in use after exclusions, in a fixed order. */
export function classesFor(o: PasswordOptions): string[] {
  const strip = (s: string) => (o.excludeAmbiguous ? [...s].filter((c) => !AMBIGUOUS.includes(c)).join('') : s);
  const out: string[] = [];
  if (o.upper) out.push(strip(UPPER));
  if (o.lower) out.push(strip(LOWER));
  if (o.digits) out.push(strip(DIGITS));
  if (o.symbols) out.push(strip(uniqueChars(o.symbolSet.replace(/\s/g, ''))));
  return out.filter((c) => c.length > 0);
}

export function poolFor(o: PasswordOptions): string {
  return uniqueChars(classesFor(o).join(''));
}

export function validatePassword(o: PasswordOptions): string | null {
  const pool = poolFor(o);
  if (pool.length === 0) return 'Pick at least one character type.';
  if (!Number.isInteger(o.length) || o.length < 4 || o.length > 128) return 'Length must be between 4 and 128.';
  if (o.requireEach && classesFor(o).length > o.length) return 'The password is shorter than the number of required character types.';
  if (o.noRepeat && o.length > pool.length) return `Without repeats the longest possible password is ${pool.length} characters.`;
  return null;
}

export function generatePassword(o: PasswordOptions, source: RandomSource = cryptoSource): string {
  const problem = validatePassword(o);
  if (problem) throw new PasswordError(problem);
  const classes = classesFor(o);
  const pool = poolFor(o);
  const chars: string[] = [];
  const used = new Set<string>();
  const pick = (from: string) => {
    const options = o.noRepeat ? [...from].filter((c) => !used.has(c)) : [...from];
    if (options.length === 0) throw new PasswordError('Ran out of unique characters; turn off "no repeats" or shorten the password.');
    const c = options[randomInt(options.length, source)]!;
    used.add(c);
    chars.push(c);
  };
  if (o.requireEach) for (const cls of classes) pick(cls);
  while (chars.length < o.length) pick(pool);
  return shuffle(chars, source).join('');
}

/**
 * Entropy in bits of the generator's output: log2(pool) per character. With
 * "require each" the true value is very slightly lower; the difference is reported as
 * negligible in the UI. With "no repeats", log2 of the falling factorial.
 */
export function passwordEntropy(o: PasswordOptions): number {
  const n = poolFor(o).length;
  if (n === 0) return 0;
  if (o.noRepeat) {
    let bits = 0;
    for (let i = 0; i < o.length && n - i > 0; i++) bits += Math.log2(n - i);
    return bits;
  }
  return o.length * Math.log2(n);
}

// --- passphrases -------------------------------------------------------------

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  /** Append a random digit to one random word. */
  addNumber: boolean;
  /** Append a random symbol to one random word. */
  addSymbol: boolean;
}

export const DEFAULT_PASSPHRASE: PassphraseOptions = { words: 5, separator: '-', capitalize: true, addNumber: true, addSymbol: false };

export const PASSPHRASE_SYMBOLS = '!@#$%&*?';

export function generatePassphrase(o: PassphraseOptions, source: RandomSource = cryptoSource, list: readonly string[] = WORDS): string {
  const count = Math.min(12, Math.max(3, Math.round(o.words)));
  const words = Array.from({ length: count }, () => list[randomInt(list.length, source)]!);
  const out = words.map((w) => (o.capitalize ? w[0]!.toUpperCase() + w.slice(1) : w));
  if (o.addNumber) {
    const i = randomInt(out.length, source);
    out[i] = out[i] + String(randomInt(10, source));
  }
  if (o.addSymbol) {
    const i = randomInt(out.length, source);
    out[i] = out[i] + PASSPHRASE_SYMBOLS[randomInt(PASSPHRASE_SYMBOLS.length, source)]!;
  }
  return out.join(o.separator);
}

export function passphraseEntropy(o: PassphraseOptions, listSize: number = WORDS.length): number {
  const count = Math.min(12, Math.max(3, Math.round(o.words)));
  let bits = count * Math.log2(listSize);
  if (o.addNumber) bits += Math.log2(10) + Math.log2(count);
  if (o.addSymbol) bits += Math.log2(PASSPHRASE_SYMBOLS.length) + Math.log2(count);
  return bits;
}

// --- strength ----------------------------------------------------------------

export type StrengthLevel = 'very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong';

export function strength(bits: number): { level: StrengthLevel; label: string } {
  if (bits < 28) return { level: 'very-weak', label: 'Very weak' };
  if (bits < 40) return { level: 'weak', label: 'Weak' };
  if (bits < 60) return { level: 'fair', label: 'Fair' };
  if (bits < 90) return { level: 'strong', label: 'Strong' };
  return { level: 'very-strong', label: 'Very strong' };
}

/** Guesses per second assumed for an offline attack on a fast hash. */
export const GUESSES_PER_SECOND = 1e10;

/** Average time to guess (half the space) at GUESSES_PER_SECOND, in plain words. */
export function crackTime(bits: number, rate: number = GUESSES_PER_SECOND): string {
  const seconds = Math.pow(2, bits - 1) / rate;
  if (!Number.isFinite(seconds) || seconds > 1e18 * 3.156e7) return 'longer than the age of the universe many times over';
  if (seconds < 1) return 'less than a second';
  const units: [number, string][] = [
    [3.156e7 * 1e9, 'billion years'],
    [3.156e7 * 1e6, 'million years'],
    [3.156e7 * 1e3, 'thousand years'],
    [3.156e7 * 100, 'centuries'],
    [3.156e7, 'years'],
    [86400 * 30, 'months'],
    [86400, 'days'],
    [3600, 'hours'],
    [60, 'minutes'],
    [1, 'seconds'],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size) {
      const n = seconds / size;
      if (unit === 'centuries') return `${Math.round(n)} centuries`;
      const shown = n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '');
      return `${shown} ${unit}`;
    }
  }
  return 'less than a second';
}

// --- prefs -------------------------------------------------------------------

export type Mode = 'password' | 'passphrase';

export interface Prefs {
  mode: Mode;
  password: PasswordOptions;
  passphrase: PassphraseOptions;
  count: number;
}

export const DEFAULT_PREFS: Prefs = { mode: 'password', password: DEFAULT_PASSWORD, passphrase: DEFAULT_PASSPHRASE, count: 5 };

const clamp = (n: unknown, lo: number, hi: number, d: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Validate saved options. Options only: generated values are never stored. */
export function parsePrefs(raw: unknown): Prefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const r = raw as Record<string, Record<string, unknown> | unknown>;
  const pw = (r.password ?? {}) as Record<string, unknown>;
  const pp = (r.passphrase ?? {}) as Record<string, unknown>;
  return {
    mode: r.mode === 'passphrase' ? 'passphrase' : 'password',
    password: {
      length: clamp(pw.length, 4, 128, DEFAULT_PASSWORD.length),
      upper: bool(pw.upper, true),
      lower: bool(pw.lower, true),
      digits: bool(pw.digits, true),
      symbols: bool(pw.symbols, true),
      symbolSet: typeof pw.symbolSet === 'string' && pw.symbolSet.length <= 64 ? pw.symbolSet : DEFAULT_SYMBOLS,
      excludeAmbiguous: bool(pw.excludeAmbiguous, false),
      requireEach: bool(pw.requireEach, true),
      noRepeat: bool(pw.noRepeat, false),
    },
    passphrase: {
      words: clamp(pp.words, 3, 12, DEFAULT_PASSPHRASE.words),
      separator: typeof pp.separator === 'string' && pp.separator.length <= 3 ? pp.separator : '-',
      capitalize: bool(pp.capitalize, true),
      addNumber: bool(pp.addNumber, true),
      addSymbol: bool(pp.addSymbol, false),
    },
    count: clamp(r.count, 1, 100, 5),
  };
}
