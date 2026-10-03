/**
 * JWT decoding and optional HMAC verification: pure functions, no DOM.
 *
 * A JWS compact token is base64url(header).base64url(payload).base64url(signature).
 * Decoding never needs the secret; verification uses WebCrypto (crypto.subtle) for
 * HS256 / HS384 / HS512 and runs entirely on the caller's machine.
 */

export type JwtPart = 'token' | 'header' | 'payload' | 'signature';

export class JwtError extends Error {
  override name = 'JwtError';
  part: JwtPart;
  constructor(message: string, part: JwtPart = 'token') {
    super(message);
    this.part = part;
  }
}

export type JsonObject = Record<string, unknown>;

export interface DecodedJwt {
  header: JsonObject;
  payload: JsonObject;
  /** Raw base64url signature segment (empty for alg none). */
  signature: string;
  headerJson: string;
  payloadJson: string;
  raw: { header: string; payload: string; signature: string };
}

export type ClaimStatus = 'expired' | 'not-yet-valid' | 'ok';

export interface ClaimRow {
  name: string;
  value: string;
  meaning: string;
  date?: string;
  relative?: string;
  status?: ClaimStatus;
}

export interface TokenTiming {
  expired: boolean;
  notYetValid: boolean;
  expiresInMs?: number;
}

export type HmacAlg = 'HS256' | 'HS384' | 'HS512';

export const HMAC_HASHES: Readonly<Record<HmacAlg, string>> = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };

const REGISTERED_CLAIMS: Readonly<Record<string, string>> = {
  iss: 'Issuer: who created and signed the token',
  sub: 'Subject: whom the token is about',
  aud: 'Audience: the recipients the token is intended for',
  exp: 'Expiration time: must not be accepted after this',
  nbf: 'Not before: must not be accepted before this',
  iat: 'Issued at: when the token was created',
  jti: 'JWT ID: unique identifier, used to prevent replay',
};

/** Common public claims (OpenID Connect and friends) for the meaning column. */
const KNOWN_CLAIMS: Readonly<Record<string, string>> = {
  name: 'Full name', given_name: 'Given name', family_name: 'Family name', email: 'Email address', email_verified: 'Whether the email was verified',
  picture: 'Profile picture URL', nonce: 'Value binding the token to an auth request', azp: 'Authorized party: the client the token was issued to',
  auth_time: 'Time of the end-user authentication', scope: 'Granted scopes', scp: 'Granted scopes', roles: 'Assigned roles', role: 'Assigned role',
  sid: 'Session ID', client_id: 'OAuth client identifier', at_hash: 'Access token hash', amr: 'Authentication methods used', acr: 'Authentication context class',
  preferred_username: 'Preferred username', tenant: 'Tenant identifier', tid: 'Tenant ID', oid: 'Object ID of the user (Azure AD)', upn: 'User principal name',
};

const HEADER_PARAMS: Readonly<Record<string, string>> = {
  alg: 'Signing algorithm',
  typ: 'Token type',
  kid: 'Key ID: which key signed the token',
  cty: 'Content type of the payload',
  jku: 'URL of the JWK set holding the key',
  x5t: 'X.509 certificate thumbprint',
  'x5t#S256': 'X.509 certificate SHA-256 thumbprint',
  crit: 'Critical header parameters that must be understood',
  enc: 'Encryption algorithm (JWE)',
  zip: 'Compression algorithm',
};

const DATE_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time']);
const BASE64URL_RE = /^[A-Za-z0-9_-]*$/;
/** NumericDate values above this (year 9999 in seconds) are almost certainly milliseconds. */
const MAX_SECONDS = 253_402_300_799;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

// --- base64url ----------------------------------------------------------------

export function base64UrlDecode(segment: string): Uint8Array {
  if (!BASE64URL_RE.test(segment)) {
    const bad = segment.match(/[^A-Za-z0-9_-]/)?.[0] ?? '';
    const hint = bad === '+' || bad === '/' || bad === '=' ? ' JWTs use the URL-safe alphabet (- and _) without = padding.' : '';
    throw new JwtError(`Invalid base64url character ${JSON.stringify(bad)}. Only A-Z, a-z, 0-9, - and _ are allowed.${hint}`);
  }
  if (segment.length % 4 === 1) throw new JwtError('Invalid base64url length: a segment cannot have a remainder of 1 character; the token is probably truncated.');
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (segment.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlEncodeText(text: string): string {
  return base64UrlEncode(encoder.encode(text));
}

// --- decoding -------------------------------------------------------------------

/** Strip a BOM, whitespace, surrounding quotes and an optional "Authorization: Bearer" prefix. */
export function normalizeToken(input: string): string {
  return input
    .replace(/^﻿/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^\s*(?:authorization\s*:\s*)?bearer\s+/i, '')
    .replace(/\s+/g, '');
}

function decodeJsonPart(segment: string, part: 'header' | 'payload'): JsonObject {
  const label = part === 'header' ? 'Header' : 'Payload';
  if (segment === '') throw new JwtError(`${label} is empty: there is nothing between the dots.`, part);
  let text: string;
  try {
    text = decoder.decode(base64UrlDecode(segment));
  } catch (err) {
    if (err instanceof JwtError) throw new JwtError(`${label}: ${err.message}`, part);
    throw new JwtError(`${label} decodes to bytes that are not UTF-8 text. This is not a JWT; it may be an opaque token or a different format.`, part);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message.split('\n')[0] : 'invalid JSON';
    throw new JwtError(`${label} is not valid JSON (${detail}). It decoded to: ${truncate(text, 60)}`, part);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new JwtError(`${label} must be a JSON object, but decoded to ${describeType(value)}: ${truncate(text, 60)}`, part);
  return value as JsonObject;
}

/** Decode a compact JWS/JWT without verifying it. Throws JwtError with a specific message. */
export function decodeJwt(input: string): DecodedJwt {
  const token = normalizeToken(input);
  if (token === '') throw new JwtError('Paste a JWT to decode it.');
  const parts = token.split('.');
  if (parts.length !== 3) {
    let hint = '';
    if (parts.length === 5) hint = ' Five segments means this is an encrypted JWE; its payload cannot be read without the key.';
    else if (parts.length === 2) hint = ' If the token uses alg "none" it still needs a trailing dot for the empty signature.';
    else if (parts.length === 1) hint = ' A JWT starts with a base64url header such as eyJhbGciOi... and contains two dots.';
    throw new JwtError(`A JWT has 3 dot-separated segments (header.payload.signature), but this input has ${parts.length}.${hint}`);
  }
  const [rawHeader, rawPayload, rawSignature] = parts as [string, string, string];
  const header = decodeJsonPart(rawHeader, 'header');
  const payload = decodeJsonPart(rawPayload, 'payload');
  if (rawSignature !== '') {
    try {
      base64UrlDecode(rawSignature);
    } catch (err) {
      throw new JwtError(`Signature: ${(err as Error).message}`, 'signature');
    }
  }
  return {
    header,
    payload,
    signature: rawSignature,
    headerJson: JSON.stringify(header, null, 2),
    payloadJson: JSON.stringify(payload, null, 2),
    raw: { header: rawHeader, payload: rawPayload, signature: rawSignature },
  };
}

// --- claims ----------------------------------------------------------------------

/** Human-readable relative time, e.g. "in 5 minutes" or "3 days ago". */
export function formatRelative(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  if (abs < 1_000) return 'just now';
  const units: [number, string][] = [
    [365 * 86_400_000, 'year'],
    [30 * 86_400_000, 'month'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second'],
  ];
  for (const [size, unit] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
      return diff > 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return 'just now';
}

/** Read a NumericDate claim (seconds since the epoch) as milliseconds, or undefined. */
export function numericDateMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value > MAX_SECONDS ? value : value * 1000;
}

export function getTiming(payload: JsonObject, nowMs: number = Date.now()): TokenTiming {
  const exp = numericDateMs(payload.exp);
  const nbf = numericDateMs(payload.nbf);
  const timing: TokenTiming = { expired: exp !== undefined && exp <= nowMs, notYetValid: nbf !== undefined && nbf > nowMs };
  if (exp !== undefined) timing.expiresInMs = exp - nowMs;
  return timing;
}

/** Turn a payload into display rows; registered claims first, in RFC 7519 order. */
export function describeClaims(payload: JsonObject, nowMs: number = Date.now()): ClaimRow[] {
  const names = Object.keys(payload);
  const registered = Object.keys(REGISTERED_CLAIMS).filter((n) => names.includes(n));
  const others = names.filter((n) => !(n in REGISTERED_CLAIMS));
  return [...registered, ...others].map((name) => {
    const value = payload[name];
    const row: ClaimRow = { name, value: typeof value === 'string' ? value : JSON.stringify(value), meaning: REGISTERED_CLAIMS[name] ?? KNOWN_CLAIMS[name] ?? '' };
    if (DATE_CLAIMS.has(name)) {
      const ms = numericDateMs(value);
      if (ms !== undefined) {
        row.date = new Date(ms).toISOString();
        row.relative = formatRelative(ms, nowMs);
        if (name === 'exp') row.status = ms <= nowMs ? 'expired' : 'ok';
        if (name === 'nbf') row.status = ms > nowMs ? 'not-yet-valid' : 'ok';
      }
    }
    return row;
  });
}

/** Header parameters as display rows, with meanings for the standard ones. */
export function describeHeader(header: JsonObject): ClaimRow[] {
  return Object.keys(header).map((name) => {
    const value = header[name];
    let meaning = HEADER_PARAMS[name] ?? '';
    if (name === 'alg' && typeof value === 'string') meaning = describeAlg(value);
    return { name, value: typeof value === 'string' ? value : JSON.stringify(value), meaning };
  });
}

export function describeAlg(alg: string): string {
  if (alg === 'none') return 'Unsigned token. Never accept this in production.';
  if (/^HS(256|384|512)$/.test(alg)) return `HMAC with SHA-${alg.slice(2)} using a shared secret`;
  if (/^RS(256|384|512)$/.test(alg)) return `RSA PKCS#1 v1.5 signature with SHA-${alg.slice(2)}`;
  if (/^PS(256|384|512)$/.test(alg)) return `RSA-PSS signature with SHA-${alg.slice(2)}`;
  if (/^ES(256|384|512|256K)$/.test(alg)) return `ECDSA signature with SHA-${alg.slice(2).replace('K', '')}`;
  if (alg === 'EdDSA') return 'Edwards-curve signature (Ed25519 or Ed448)';
  return 'Signing algorithm';
}

/** One-line verdict for the status bar. */
export function summarize(decoded: DecodedJwt, nowMs: number = Date.now()): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  const alg = typeof decoded.header.alg === 'string' ? decoded.header.alg : 'unknown alg';
  const t = getTiming(decoded.payload, nowMs);
  if (alg === 'none') return { text: 'Unsigned token (alg none)', tone: 'bad' };
  if (t.expired) return { text: `${alg} · expired ${formatRelative(numericDateMs(decoded.payload.exp)!, nowMs)}`, tone: 'bad' };
  if (t.notYetValid) return { text: `${alg} · not valid yet, becomes valid ${formatRelative(numericDateMs(decoded.payload.nbf)!, nowMs)}`, tone: 'warn' };
  if (t.expiresInMs !== undefined) return { text: `${alg} · expires ${formatRelative(nowMs + t.expiresInMs, nowMs)}`, tone: 'ok' };
  return { text: `${alg} · no expiry claim`, tone: 'warn' };
}

// --- verification ----------------------------------------------------------------

export function isHmacAlg(alg: unknown): alg is HmacAlg {
  return typeof alg === 'string' && Object.hasOwn(HMAC_HASHES, alg);
}

async function importHmacKey(alg: HmacAlg, secret: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new JwtError('WebCrypto is not available in this browser, so the signature cannot be checked here.', 'signature');
  return subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: HMAC_HASHES[alg] }, false, usage);
}

/** Secret bytes: UTF-8 text, or the decoded bytes when the secret itself is base64url encoded. */
export function secretBytes(secret: string, base64Encoded: boolean): Uint8Array {
  if (!base64Encoded) return encoder.encode(secret);
  return base64UrlDecode(secret.replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
}

/**
 * Check an HS256/HS384/HS512 signature against a shared secret. Resolves true when it
 * matches and false when it does not. Throws JwtError when the token does not use an
 * HMAC algorithm (RSA, ECDSA and none cannot be checked with a secret).
 */
export async function verifyHmac(token: string, secret: string, base64Secret = false): Promise<boolean> {
  const decoded = decodeJwt(token);
  const alg = decoded.header.alg;
  if (!isHmacAlg(alg)) {
    const shown = typeof alg === 'string' ? `"${alg}"` : 'missing';
    throw new JwtError(
      alg === 'none'
        ? 'The header says alg "none": this token is unsigned, so there is no signature to verify. Reject such tokens in production.'
        : `Algorithm ${shown} cannot be verified with a shared secret. Only HS256, HS384 and HS512 are supported here; RS, ES and PS tokens need the issuer's public key.`,
      'signature',
    );
  }
  if (secret === '') throw new JwtError('Enter the secret to verify the signature.', 'signature');
  if (decoded.signature === '') return false;
  const key = await importHmacKey(alg, secretBytes(secret, base64Secret), ['verify']);
  const data = encoder.encode(`${decoded.raw.header}.${decoded.raw.payload}`);
  return crypto.subtle.verify('HMAC', key, base64UrlDecode(decoded.signature) as BufferSource, data);
}

/** Produce a signed HS* token from a header and payload. */
export async function signHmac(header: JsonObject, payload: JsonObject, secret: string, base64Secret = false): Promise<string> {
  const alg = header.alg;
  if (!isHmacAlg(alg)) throw new JwtError('Cannot sign: header.alg must be HS256, HS384 or HS512.', 'header');
  const signingInput = `${base64UrlEncodeText(JSON.stringify(header))}.${base64UrlEncodeText(JSON.stringify(payload))}`;
  const key = await importHmacKey(alg, secretBytes(secret, base64Secret), ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

// --- helpers ------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/** The classic example token (HS256, secret "your-256-bit-secret"), with a far-future expiry. */
export const SAMPLE_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImVtYWlsIjoiYWRhQGV4YW1wbGUuY29tIiwicm9sZXMiOlsiYWRtaW4iLCJiaWxsaW5nIl0sImlzcyI6Imh0dHBzOi8vYXV0aC5leGFtcGxlLmNvbSIsImF1ZCI6ImN1aXNkZXYiLCJpYXQiOjE3NTk0ODAwMDAsImV4cCI6MjA3NTA0MDAwMH0.R-vVGgASM2eWXIQZnVH_84ju6J3MIi8Vl7Ln-lRuF3E';
export const SAMPLE_SECRET = 'your-256-bit-secret';
