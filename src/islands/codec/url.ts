/**
 * URL percent-encoding: pure functions, no DOM.
 *
 * Three flavours:
 *  - component: encodeURIComponent, for a single query value or path segment.
 *  - full: encodeURI, keeps URL delimiters so a whole URL stays a URL.
 *  - form: application/x-www-form-urlencoded, spaces become + and ! ' ( ) ~ are escaped.
 */

export type UrlMode = 'component' | 'full' | 'form';

export class UrlEncodeError extends Error {
  override name = 'UrlEncodeError';
  offset?: number;
  constructor(message: string, offset?: number) {
    super(message);
    if (offset !== undefined) this.offset = offset;
  }
}

export interface UrlDecodeResult {
  text: string;
  /** Decode passes that changed the text (0 when nothing was encoded). */
  passes: number;
}

export interface QueryParam {
  key: string;
  value: string;
}

export interface ParsedUrl {
  protocol: string;
  username: string;
  password: string;
  host: string;
  port: string;
  path: string;
  query: QueryParam[];
  hash: string;
}

const MAX_PASSES = 10;
const HEX2 = /^[0-9A-Fa-f]{2}$/;
const RESERVED = ';/?:@&=+$,#';
const decoder = new TextDecoder('utf-8', { fatal: true });

export function urlEncode(text: string, mode: UrlMode = 'component'): string {
  if (text === '') return '';
  try {
    switch (mode) {
      case 'full':
        return encodeURI(text);
      case 'form':
        return encodeURIComponent(text)
          .replace(/[!'()~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
          .replace(/%20/g, '+');
      default:
        return encodeURIComponent(text);
    }
  } catch {
    const offset = findLoneSurrogate(text);
    throw new UrlEncodeError(`Cannot encode: the input contains a lone surrogate (an incomplete emoji or UTF-16 half) at offset ${offset}. Remove or fix that character.`, offset);
  }
}

export function urlDecode(text: string, mode: UrlMode = 'component', untilStable = false): UrlDecodeResult {
  let current = text;
  let passes = 0;
  const limit = untilStable ? MAX_PASSES : 1;
  for (let i = 0; i < limit; i++) {
    const next = decodeOnce(current, mode);
    if (next === current) break;
    current = next;
    passes++;
  }
  return { text: current, passes };
}

/** One percent-decoding pass. Throws UrlEncodeError with an offset on malformed input. */
export function decodeOnce(text: string, mode: UrlMode = 'component'): string {
  const plusAsSpace = mode === 'form';
  const preserveReserved = mode === 'full';
  if (!text.includes('%') && !(plusAsSpace && text.includes('+'))) return text;

  const out: string[] = [];
  const bytes: number[] = [];
  let runStart = 0;
  const flush = (): void => {
    if (bytes.length === 0) return;
    try {
      out.push(decoder.decode(new Uint8Array(bytes)));
    } catch {
      throw new UrlEncodeError(`The percent-escapes starting at offset ${runStart} (${text.slice(runStart, runStart + 12)}...) do not form valid UTF-8. The input was probably encoded with a different charset or is truncated.`, runStart);
    }
    bytes.length = 0;
  };

  const len = text.length;
  let i = 0;
  while (i < len) {
    const ch = text[i] as string;
    if (ch === '%') {
      const hex = text.slice(i + 1, i + 3);
      if (!HEX2.test(hex)) {
        flush();
        throw new UrlEncodeError(`Malformed percent-escape "${text.slice(i, i + 3)}" at offset ${i}: "%" must be followed by exactly two hex digits (for example %20). To keep a literal percent sign, write it as %25.`, i);
      }
      const byte = parseInt(hex, 16);
      if (preserveReserved && byte < 0x80 && RESERVED.includes(String.fromCharCode(byte))) {
        flush();
        out.push(text.slice(i, i + 3));
      } else {
        if (bytes.length === 0) runStart = i;
        bytes.push(byte);
      }
      i += 3;
      continue;
    }
    flush();
    out.push(ch === '+' && plusAsSpace ? ' ' : ch);
    i++;
  }
  flush();
  return out.join('');
}

export function looksEncoded(text: string): boolean {
  return /%[0-9A-Fa-f]{2}/.test(text);
}

/** Break an absolute URL into parts, or null when the text is not an absolute URL. */
export function parseUrl(text: string): ParsedUrl | null {
  const trimmed = text.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const query: QueryParam[] = [];
  for (const [key, value] of url.searchParams) query.push({ key, value });
  return {
    protocol: url.protocol.replace(/:$/, ''),
    username: safeDecode(url.username),
    password: safeDecode(url.password),
    host: url.hostname,
    port: url.port,
    path: safeDecode(url.pathname),
    query,
    hash: safeDecode(url.hash.replace(/^#/, '')),
  };
}

function safeDecode(part: string): string {
  try {
    return decodeOnce(part, 'component');
  } catch {
    return part;
  }
}

function findLoneSurrogate(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return i;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return i;
  }
  return -1;
}
