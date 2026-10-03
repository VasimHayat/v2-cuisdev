/**
 * Number Base Converter: pure functions, no DOM.
 *
 * A value is held as an exact signed rational `num / den` with BigInt, so integers of
 * any size convert exactly and fractions convert digit by digit with repetition
 * detection (0.1 in binary is 0.0(0011), repeating). Signed mode interprets bit
 * patterns as two's complement at a chosen width.
 */

export class BaseError extends Error {
  override name = 'BaseError';
  constructor(
    message: string,
    /** 0-based index into the original input of the offending character, if any. */
    public readonly position?: number,
  ) {
    super(message);
  }
}

export const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
export const BIT_WIDTHS = [8, 16, 32, 64, 128] as const;
export type BitWidth = (typeof BIT_WIDTHS)[number];

/** Exact value: sign folded into num; den is always positive. */
export interface Value {
  num: bigint;
  den: bigint;
}

export const ZERO: Value = { num: 0n, den: 1n };

const PREFIX: Record<number, string> = { 2: '0b', 8: '0o', 16: '0x' };

export function baseName(base: number): string {
  return ({ 2: 'Binary', 8: 'Octal', 10: 'Decimal', 16: 'Hexadecimal' } as Record<number, string>)[base] ?? `Base ${base}`;
}

export function isInteger(v: Value): boolean {
  return v.den === 1n;
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function gcd(a: bigint, b: bigint): bigint {
  a = abs(a);
  b = abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function reduce(v: Value): Value {
  const g = gcd(v.num, v.den);
  return { num: v.num / g, den: v.den / g };
}

// --- parsing ------------------------------------------------------------------------

/**
 * Parse text in `base`. Accepts a sign, the base's prefix (0b, 0o, 0x), underscores,
 * spaces and (in base 10) commas as separators, and one radix point. Throws BaseError
 * with the position of the first invalid character.
 */
export function parseInBase(text: string, base: number): Value {
  if (base < 2 || base > 36) throw new BaseError('The base must be between 2 and 36.');
  let i = 0;
  const n = text.length;
  while (i < n && /\s/.test(text[i]!)) i++;
  let negative = false;
  if (text[i] === '-' || text[i] === '+') {
    negative = text[i] === '-';
    i++;
  }
  const prefix = PREFIX[base];
  if (prefix && text.slice(i, i + 2).toLowerCase() === prefix) i += 2;

  let intPart = 0n;
  let fracNum = 0n;
  let fracDen = 1n;
  let seenPoint = false;
  let digits = 0;
  const B = BigInt(base);
  for (; i < n; i++) {
    const ch = text[i]!;
    if (ch === '_' || ch === ' ' || ch === ' ' || (ch === ',' && base === 10) || ch === '\t') continue;
    if (ch === '.') {
      if (seenPoint) throw new BaseError('A number can only have one radix point.', i);
      seenPoint = true;
      continue;
    }
    const d = DIGITS.indexOf(ch.toLowerCase());
    if (d === -1 || d >= base) {
      const allowed = base <= 10 ? `0 to ${base - 1}` : `0 to 9 and a to ${DIGITS[base - 1]}`;
      throw new BaseError(`"${ch}" is not a valid ${baseName(base).toLowerCase()} digit (allowed: ${allowed}).`, i);
    }
    digits++;
    if (seenPoint) {
      fracNum = fracNum * B + BigInt(d);
      fracDen *= B;
    } else intPart = intPart * B + BigInt(d);
  }
  if (digits === 0) throw new BaseError('Enter at least one digit.');
  const num = intPart * fracDen + fracNum;
  return reduce({ num: negative ? -num : num, den: fracDen });
}

// --- formatting ---------------------------------------------------------------------

export interface FormatOptions {
  group?: boolean;
  uppercase?: boolean;
  prefix?: boolean;
  /** Maximum fractional digits before stopping. */
  precision?: number;
}

export interface Formatted {
  text: string;
  /** True when the fraction repeats; the repeating block is in parentheses. */
  repeats: boolean;
  /** True when the fraction was cut off at the precision limit without repeating. */
  truncated: boolean;
}

export const GROUP: Record<number, { size: number; sep: string }> = { 2: { size: 4, sep: ' ' }, 8: { size: 3, sep: ' ' }, 10: { size: 3, sep: ',' }, 16: { size: 4, sep: ' ' } };

export function groupDigits(digits: string, size: number, sep: string): string {
  if (size <= 0 || digits.length <= size) return digits;
  const out: string[] = [];
  for (let end = digits.length; end > 0; end -= size) out.unshift(digits.slice(Math.max(0, end - size), end));
  return out.join(sep);
}

function intToBase(n: bigint, base: number): string {
  return n.toString(base);
}

/** Format an exact value in `base`, with repetition detection for fractions. */
export function formatValue(v: Value, base: number, options: FormatOptions = {}): Formatted {
  const negative = v.num < 0n;
  const num = abs(v.num);
  const B = BigInt(base);
  let intDigits = intToBase(num / v.den, base);
  let rem = num % v.den;
  let frac = '';
  let repeats = false;
  let truncated = false;
  if (rem !== 0n) {
    const precision = options.precision ?? (base === 2 ? 64 : 32);
    const seen = new Map<bigint, number>();
    const digits: string[] = [];
    while (rem !== 0n) {
      if (seen.has(rem)) {
        const start = seen.get(rem)!;
        frac = `${digits.slice(0, start).join('')}(${digits.slice(start).join('')})`;
        repeats = true;
        break;
      }
      if (digits.length >= precision) {
        frac = digits.join('');
        truncated = true;
        break;
      }
      seen.set(rem, digits.length);
      rem *= B;
      digits.push(DIGITS[Number(rem / v.den)]!);
      rem %= v.den;
    }
    if (!repeats && !truncated) frac = digits.join('');
  }
  const g = GROUP[base];
  if (options.group && g) intDigits = groupDigits(intDigits, g.size, g.sep);
  let text = intDigits + (frac ? `.${frac}` : '');
  if (options.uppercase) text = text.toUpperCase();
  if (options.prefix && PREFIX[base]) text = PREFIX[base] + text;
  return { text: (negative ? '-' : '') + text, repeats, truncated };
}

// --- two's complement ---------------------------------------------------------------

export function signedRange(bits: number): { min: bigint; max: bigint } {
  return { min: -(1n << BigInt(bits - 1)), max: (1n << BigInt(bits - 1)) - 1n };
}

export function unsignedMax(bits: number): bigint {
  return (1n << BigInt(bits)) - 1n;
}

/** Bit pattern (unsigned) of an integer in `bits`-wide two's complement. Throws if it does not fit. */
export function toTwosComplement(n: bigint, bits: number): bigint {
  const { min, max } = signedRange(bits);
  if (n < min || n > max) throw new BaseError(`${n} does not fit in a ${bits}-bit signed integer (${min} to ${max}).`);
  return n < 0n ? (1n << BigInt(bits)) + n : n;
}

/** Signed value of a `bits`-wide pattern. */
export function fromTwosComplement(pattern: bigint, bits: number): bigint {
  if (pattern < 0n || pattern > unsignedMax(bits)) throw new BaseError(`That pattern is wider than ${bits} bits.`);
  const top = 1n << BigInt(bits - 1);
  return pattern & top ? pattern - (1n << BigInt(bits)) : pattern;
}

export function bitLength(n: bigint): number {
  const a = abs(n);
  return a === 0n ? 0 : a.toString(2).length;
}

export function byteLength(n: bigint): number {
  return Math.ceil(bitLength(n) / 8);
}

// --- conversion for the UI ----------------------------------------------------------

export interface ConvertOptions extends FormatOptions {
  signed: boolean;
  width: BitWidth;
}

export interface Field {
  base: number;
  text: string;
  repeats: boolean;
  truncated: boolean;
}

/**
 * Interpret text typed in `base`. In signed mode, non-decimal input that is a bit pattern
 * (no sign, no fraction) and fits the width is read as two's complement.
 */
export function readInput(text: string, base: number, options: Pick<ConvertOptions, 'signed' | 'width'>): Value {
  const v = parseInBase(text, base);
  if (!options.signed || base === 10 || !isInteger(v) || v.num < 0n) return v;
  if (v.num > unsignedMax(options.width)) throw new BaseError(`That pattern is wider than ${options.width} bits. Choose a larger width or turn off Signed.`);
  return { num: fromTwosComplement(v.num, options.width), den: 1n };
}

/** Render the value for one field. Signed mode shows negative integers as two's complement in non-decimal bases. */
export function renderField(v: Value, base: number, options: ConvertOptions): Field {
  if (options.signed && base !== 10 && isInteger(v) && v.num < 0n) {
    const pattern = toTwosComplement(v.num, options.width);
    let digits = pattern.toString(base);
    // pad to the full width for power-of-two bases
    const per = base === 2 ? 1 : base === 16 ? 4 : base === 8 ? 3 : 0;
    if (per) digits = digits.padStart(Math.ceil(options.width / per), '0');
    const g = GROUP[base];
    if (options.group && g) digits = groupDigits(digits, g.size, g.sep);
    if (options.uppercase) digits = digits.toUpperCase();
    if (options.prefix && PREFIX[base]) digits = PREFIX[base] + digits;
    return { base, text: digits, repeats: false, truncated: false };
  }
  const f = formatValue(v, base, options);
  return { base, ...f };
}

/** Warning when signed mode is on and the value does not fit the width. */
export function rangeWarning(v: Value, options: Pick<ConvertOptions, 'signed' | 'width'>): string | null {
  if (!isInteger(v)) return options.signed ? 'Two\'s complement applies to whole numbers only; the fraction is shown as a signed value.' : null;
  if (!options.signed) return null;
  const { min, max } = signedRange(options.width);
  if (v.num < min || v.num > max) return `${v.num} does not fit in ${options.width} signed bits (${min} to ${max}).`;
  return null;
}

/** Bits of the value for the bit grid: two's complement in signed mode, plain otherwise. */
export function bitsOf(v: Value, width: number, signed: boolean): boolean[] | null {
  if (!isInteger(v)) return null;
  let pattern: bigint;
  if (v.num < 0n) {
    if (!signed) return null;
    try {
      pattern = toTwosComplement(v.num, width);
    } catch {
      return null;
    }
  } else {
    if (v.num > unsignedMax(width)) return null;
    pattern = v.num;
  }
  return Array.from({ length: width }, (_, i) => ((pattern >> BigInt(width - 1 - i)) & 1n) === 1n);
}

/** Value after flipping bit `index` (0 = most significant) in the grid. */
export function toggleBit(v: Value, index: number, width: number, signed: boolean): Value {
  const bits = bitsOf(v, width, signed);
  if (!bits) return v;
  bits[index] = !bits[index];
  const pattern = bits.reduce((acc, b) => (acc << 1n) | (b ? 1n : 0n), 0n);
  return { num: signed ? fromTwosComplement(pattern, width) : pattern, den: 1n };
}

/** Decimal string of a value for the URL (exact for integers; fractions as num/den). */
export function serialize(v: Value): string {
  return v.den === 1n ? v.num.toString() : `${v.num}/${v.den}`;
}

export function deserialize(s: string): Value | null {
  const m = /^(-?\d+)(?:\/(\d+))?$/.exec(s.trim());
  if (!m) return null;
  const den = m[2] ? BigInt(m[2]) : 1n;
  if (den === 0n) return null;
  return reduce({ num: BigInt(m[1]!), den });
}

export const SAMPLE = '3735928559';
