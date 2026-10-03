/**
 * Text to Binary: pure functions, no DOM. Encodes text to bytes (UTF-8, UTF-16 BE/LE,
 * Latin-1, ASCII) written as binary, octal, decimal or hexadecimal, or to Unicode code
 * points, and decodes such listings back to text. Decoding is forgiving about
 * separators and prefixes and reports bad tokens with their position.
 */

export type Representation = 'binary' | 'octal' | 'decimal' | 'hex' | 'codepoint';
export type TextEncodingId = 'utf8' | 'utf16be' | 'utf16le' | 'latin1' | 'ascii';
export type Separator = 'space' | 'none' | 'comma' | 'newline';
export type GroupSize = 1 | 2 | 4;

export interface BinaryOptions {
  representation: Representation;
  encoding: TextEncodingId;
  separator: Separator;
  /** Bytes per token when encoding (1, 2 or 4). */
  group: GroupSize;
  /** Pad every byte to full width (8 binary digits, 3 octal or decimal, 2 hex). */
  pad: boolean;
  /** Prefix tokens with 0b, 0o or 0x. */
  prefix: boolean;
  uppercase: boolean;
}

export const DEFAULT_OPTIONS: BinaryOptions = {
  representation: 'binary',
  encoding: 'utf8',
  separator: 'space',
  group: 1,
  pad: true,
  prefix: false,
  uppercase: true,
};

export class BinaryError extends Error {
  override name = 'BinaryError';
  /** 0-based character offset in the input, when known. */
  offset?: number;
  constructor(message: string, offset?: number) {
    super(message);
    if (offset !== undefined) this.offset = offset;
  }
}

export const REPRESENTATIONS: { id: Representation; label: string }[] = [
  { id: 'binary', label: 'Binary' },
  { id: 'octal', label: 'Octal' },
  { id: 'decimal', label: 'Decimal' },
  { id: 'hex', label: 'Hexadecimal' },
  { id: 'codepoint', label: 'Code points (U+)' },
];

export const ENCODINGS: { id: TextEncodingId; label: string }[] = [
  { id: 'utf8', label: 'UTF-8' },
  { id: 'utf16be', label: 'UTF-16 BE' },
  { id: 'utf16le', label: 'UTF-16 LE' },
  { id: 'latin1', label: 'Latin-1 (ISO-8859-1)' },
  { id: 'ascii', label: 'ASCII (7-bit)' },
];

const RADIX: Record<Exclude<Representation, 'codepoint'>, number> = { binary: 2, octal: 8, decimal: 10, hex: 16 };
const WIDTH: Record<Exclude<Representation, 'codepoint'>, number> = { binary: 8, octal: 3, decimal: 3, hex: 2 };
const PREFIX: Record<Exclude<Representation, 'codepoint'>, string> = { binary: '0b', octal: '0o', decimal: '', hex: '0x' };
const DIGITS: Record<Exclude<Representation, 'codepoint'>, RegExp> = { binary: /^[01]+$/, octal: /^[0-7]+$/, decimal: /^[0-9]+$/, hex: /^[0-9a-fA-F]+$/ };
const SEPARATORS: Record<Separator, string> = { space: ' ', none: '', comma: ', ', newline: '\n' };

export function isRepresentation(v: unknown): v is Representation {
  return typeof v === 'string' && REPRESENTATIONS.some((r) => r.id === v);
}
export function isEncoding(v: unknown): v is TextEncodingId {
  return typeof v === 'string' && ENCODINGS.some((e) => e.id === v);
}

// --- text <-> bytes -------------------------------------------------------------

/** Characters (code points) with their UTF-16 offset in the source string. */
function codePoints(text: string): { char: string; cp: number; offset: number }[] {
  const out: { char: string; cp: number; offset: number }[] = [];
  let offset = 0;
  for (const char of text) {
    out.push({ char, cp: char.codePointAt(0) as number, offset });
    offset += char.length;
  }
  return out;
}

function describeChar(char: string, cp: number): string {
  return `"${char}" (U+${cp.toString(16).toUpperCase().padStart(4, '0')})`;
}

export function textToBytes(text: string, encoding: TextEncodingId): Uint8Array {
  switch (encoding) {
    case 'utf8':
      return new TextEncoder().encode(text);
    case 'utf16be':
    case 'utf16le': {
      const out = new Uint8Array(text.length * 2);
      for (let i = 0; i < text.length; i++) {
        const unit = text.charCodeAt(i);
        const hi = unit >> 8;
        const lo = unit & 0xff;
        out[i * 2] = encoding === 'utf16be' ? hi : lo;
        out[i * 2 + 1] = encoding === 'utf16be' ? lo : hi;
      }
      return out;
    }
    case 'latin1':
    case 'ascii': {
      const max = encoding === 'latin1' ? 0xff : 0x7f;
      const name = encoding === 'latin1' ? 'Latin-1' : 'ASCII';
      const out: number[] = [];
      let index = 0;
      for (const { char, cp, offset } of codePoints(text)) {
        index++;
        if (cp > max) throw new BinaryError(`Character ${index} ${describeChar(char, cp)} cannot be written in ${name}. Switch the encoding to UTF-8.`, offset);
        out.push(cp);
      }
      return new Uint8Array(out);
    }
  }
}

/** Offset of the first byte that starts an invalid UTF-8 sequence, or -1. */
export function findInvalidUtf8(bytes: Uint8Array): number {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] as number;
    let need = 0;
    let min = 0;
    if (b < 0x80) {
      i++;
      continue;
    } else if (b >= 0xc2 && b <= 0xdf) {
      need = 1;
      min = 0x80;
    } else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      min = 0x800;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      min = 0x10000;
    } else return i;
    // A missing continuation byte (truncated input) shows up as undefined below.
    let cp = b & (0xff >> (need + 2));
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return i;
      cp = (cp << 6) | (c & 0x3f);
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return i;
    i += need + 1;
  }
  return -1;
}

export function bytesToText(bytes: Uint8Array, encoding: TextEncodingId): string {
  switch (encoding) {
    case 'utf8': {
      const bad = findInvalidUtf8(bytes);
      if (bad !== -1) {
        const shown = Array.from(bytes.subarray(bad, bad + 4), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
        throw new BinaryError(`Byte ${bad + 1} (${shown}) does not start a valid UTF-8 sequence. The bytes may be truncated, or use a different encoding such as Latin-1.`);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
    case 'utf16be':
    case 'utf16le': {
      if (bytes.length % 2 !== 0) throw new BinaryError(`UTF-16 needs an even number of bytes, but there are ${bytes.length}. A byte is missing or extra.`);
      let out = '';
      for (let i = 0; i < bytes.length; i += 2) {
        const a = bytes[i] as number;
        const b = bytes[i + 1] as number;
        out += String.fromCharCode(encoding === 'utf16be' ? (a << 8) | b : (b << 8) | a);
      }
      return out;
    }
    case 'latin1':
    case 'ascii': {
      let out = '';
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i] as number;
        if (encoding === 'ascii' && b > 0x7f) throw new BinaryError(`Byte ${i + 1} has value ${b}, which is outside 7-bit ASCII (0 to 127). Try Latin-1 or UTF-8.`);
        out += String.fromCharCode(b);
      }
      return out;
    }
  }
}

// --- encode ---------------------------------------------------------------------

function formatByteDigits(value: number, rep: Exclude<Representation, 'codepoint'>, pad: boolean, uppercase: boolean): string {
  let s = value.toString(RADIX[rep]);
  if (rep === 'hex' && uppercase) s = s.toUpperCase();
  return pad ? s.padStart(WIDTH[rep], '0') : s;
}

/** Encode text to a listing in the chosen representation. */
export function encode(text: string, options: BinaryOptions): string {
  if (text === '') return '';
  const sep = SEPARATORS[options.separator];
  if (options.representation === 'codepoint') {
    return codePoints(text)
      .map(({ cp }) => {
        const hex = cp.toString(16).padStart(4, '0');
        return `U+${options.uppercase ? hex.toUpperCase() : hex}`;
      })
      .join(sep || ' ');
  }
  const rep = options.representation;
  const bytes = textToBytes(text, options.encoding);
  // Grouped tokens or no separator need full width to stay decodable.
  const pad = options.pad || options.group > 1 || options.separator === 'none';
  const prefix = options.prefix ? PREFIX[rep] : '';
  const tokens: string[] = [];
  for (let i = 0; i < bytes.length; i += options.group) {
    const digits = Array.from(bytes.subarray(i, i + options.group), (b) => formatByteDigits(b, rep, pad, options.uppercase)).join('');
    tokens.push(prefix + digits);
  }
  return tokens.join(sep);
}

// --- decode ---------------------------------------------------------------------

interface Token {
  text: string;
  offset: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const re = /[^\s,;]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) tokens.push({ text: m[0], offset: m.index });
  return tokens;
}

function stripPrefix(token: string, rep: Exclude<Representation, 'codepoint'>): { digits: string; skipped: number } {
  const patterns: Record<Exclude<Representation, 'codepoint'>, RegExp> = {
    binary: /^(0b|b)/i,
    octal: /^(0o|o|\\)/i,
    decimal: /^(0d|d)/i,
    hex: /^(0x|\\x|x|#|%)/i,
  };
  const m = patterns[rep].exec(token);
  return m ? { digits: token.slice(m[0].length), skipped: m[0].length } : { digits: token, skipped: 0 };
}

/** Parse a listing of byte values into bytes. */
export function parseBytes(input: string, rep: Exclude<Representation, 'codepoint'>): Uint8Array {
  const width = WIDTH[rep];
  const name = REPRESENTATIONS.find((r) => r.id === rep)!.label.toLowerCase();
  const out: number[] = [];
  // Escapes such as \x48\x69 or %48%69 separate bytes too; spaces of equal length keep offsets.
  const source = rep === 'hex' ? input.replace(/\\x|%/gi, (m) => ' '.repeat(m.length)) : input;
  for (const token of tokenize(source)) {
    const { digits, skipped } = stripPrefix(token.text, rep);
    const at = token.offset + skipped;
    if (digits === '') throw new BinaryError(`Empty value after the prefix at position ${token.offset + 1}.`, token.offset);
    if (!DIGITS[rep].test(digits)) {
      const badIndex = [...digits].findIndex((c) => !DIGITS[rep].test(c));
      const bad = digits[badIndex] ?? '';
      throw new BinaryError(`"${bad}" at position ${at + badIndex + 1} is not a valid ${name} digit.`, at + badIndex);
    }
    // Long runs without separators are split into fixed-width bytes.
    const chunks: { digits: string; offset: number }[] = [];
    const splittable = rep !== 'decimal' && digits.length > width;
    if (splittable) {
      if (digits.length % width !== 0) {
        throw new BinaryError(`The run of ${digits.length} ${name} digits at position ${at + 1} does not divide into ${width}-digit bytes. Add separators or fix the length.`, at);
      }
      for (let i = 0; i < digits.length; i += width) chunks.push({ digits: digits.slice(i, i + width), offset: at + i });
    } else chunks.push({ digits, offset: at });
    for (const c of chunks) {
      const value = parseInt(c.digits, RADIX[rep]);
      if (value > 255) throw new BinaryError(`${c.digits} at position ${c.offset + 1} is ${value}, larger than one byte (255).`, c.offset);
      out.push(value);
    }
  }
  return new Uint8Array(out);
}

/** Parse U+XXXX, \\uXXXX, 0xXXXX or bare hex code points into text. */
export function parseCodePoints(input: string): string {
  let out = '';
  for (const token of tokenize(input)) {
    const m = /^(?:U\+|u\+|\\u\{?|0x)?([0-9a-fA-F]{1,6})\}?$/.exec(token.text);
    if (!m) throw new BinaryError(`"${token.text}" at position ${token.offset + 1} is not a code point. Use forms like U+0041 or 1F600.`, token.offset);
    const cp = parseInt(m[1] as string, 16);
    if (cp > 0x10ffff) throw new BinaryError(`${token.text} at position ${token.offset + 1} is beyond the last Unicode code point (U+10FFFF).`, token.offset);
    if (cp >= 0xd800 && cp <= 0xdfff) throw new BinaryError(`${token.text} at position ${token.offset + 1} is a surrogate, which is not a character on its own.`, token.offset);
    out += String.fromCodePoint(cp);
  }
  return out;
}

export function decode(input: string, options: BinaryOptions): string {
  if (input.trim() === '') return '';
  if (options.representation === 'codepoint') return parseCodePoints(input);
  return bytesToText(parseBytes(input, options.representation), options.encoding);
}

// --- helpers --------------------------------------------------------------------

export interface ByteRow {
  char: string;
  codePoint: string;
  hex: string;
  binary: string;
}

/** Per-character UTF-8 breakdown for the byte table (first `limit` characters). */
export function byteTable(text: string, limit = 200): ByteRow[] {
  const rows: ByteRow[] = [];
  const enc = new TextEncoder();
  for (const { char, cp } of codePoints(text)) {
    if (rows.length >= limit) break;
    const bytes = Array.from(enc.encode(char));
    rows.push({
      char,
      codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`,
      hex: bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
      binary: bytes.map((b) => b.toString(2).padStart(8, '0')).join(' '),
    });
  }
  return rows;
}

export function textStats(text: string, encoding: TextEncodingId): { chars: number; bytes: number | null; bits: number | null } {
  const chars = codePoints(text).length;
  try {
    const bytes = textToBytes(text, encoding).length;
    return { chars, bytes, bits: bytes * 8 };
  } catch {
    return { chars, bytes: null, bits: null };
  }
}

/** Guess whether pasted text is a byte listing, and in which representation. */
export function detectListing(text: string): Representation | null {
  const t = text.trim();
  if (t.length < 4) return null;
  if (/^((U\+|\\u)[0-9a-fA-F]{4,6}[\s,]*)+$/.test(t)) return 'codepoint';
  const compact = t.replace(/[\s,;]+/g, '');
  if (/^(0b)?[01]+$/i.test(compact.replace(/0b/gi, '')) && compact.replace(/0b/gi, '').length >= 8) return 'binary';
  if (/^((0x|\\x)?[0-9a-fA-F]{2}[\s,;]+)+(0x|\\x)?[0-9a-fA-F]{2}$/i.test(t)) return 'hex';
  return null;
}

export const SAMPLE_TEXT = 'Hi! café 👋';
