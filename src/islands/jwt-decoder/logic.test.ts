import { describe, expect, it } from 'vitest';
import {
  JwtError,
  SAMPLE_SECRET,
  SAMPLE_TOKEN,
  base64UrlDecode,
  base64UrlEncodeText,
  decodeJwt,
  describeAlg,
  describeClaims,
  describeHeader,
  formatRelative,
  getTiming,
  normalizeToken,
  numericDateMs,
  signHmac,
  summarize,
  verifyHmac,
} from './logic';

const b64 = (o: unknown) => base64UrlEncodeText(JSON.stringify(o));
const make = (header: unknown, payload: unknown, sig = 'sig') => `${b64(header)}.${b64(payload)}.${sig}`;

describe('normalizeToken and base64url', () => {
  it('strips bearer prefixes, quotes and whitespace', () => {
    expect(normalizeToken('  Authorization: Bearer abc.def.ghi \n')).toBe('abc.def.ghi');
    expect(normalizeToken('"abc.def.ghi"')).toBe('abc.def.ghi');
    expect(normalizeToken('bearer abc.\ndef.ghi')).toBe('abc.def.ghi');
  });
  it('decodes base64url and rejects standard alphabet characters', () => {
    expect(new TextDecoder().decode(base64UrlDecode('aGk'))).toBe('hi');
    expect(() => base64UrlDecode('ab+c')).toThrow(/URL-safe alphabet/);
    expect(() => base64UrlDecode('abcde')).toThrow(/truncated/);
  });
});

describe('decodeJwt', () => {
  it('decodes the sample', () => {
    const d = decodeJwt(SAMPLE_TOKEN);
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(d.payload.name).toBe('Ada Lovelace');
    expect(d.payload.roles).toEqual(['admin', 'billing']);
    expect(d.raw.signature.length).toBe(43);
  });
  it('explains segment count problems', () => {
    expect(() => decodeJwt('a.b')).toThrow(/trailing dot/);
    expect(() => decodeJwt('a.b.c.d.e')).toThrow(/JWE/);
    expect(() => decodeJwt('nodots')).toThrow(/contains two dots/);
    expect(() => decodeJwt('')).toThrow(/Paste a JWT/);
  });
  it('explains bad segments with the part name', () => {
    const err = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e as JwtError;
      }
    };
    expect(err(() => decodeJwt(`.${b64({})}.x`))).toMatchObject({ part: 'header', message: expect.stringContaining('empty') });
    expect(err(() => decodeJwt(`${base64UrlEncodeText('not json')}.${b64({})}.x`))).toMatchObject({ part: 'header', message: expect.stringContaining('not valid JSON') });
    expect(err(() => decodeJwt(`${b64({ alg: 'none' })}.${b64([1])}.`))).toMatchObject({ part: 'payload', message: expect.stringContaining('an array') });
    expect(err(() => decodeJwt(`${b64({ alg: 'HS256' })}.${b64({})}.bad+sig`))).toMatchObject({ part: 'signature' });
  });
});

describe('claims', () => {
  const now = Date.UTC(2026, 9, 3, 12, 0, 0);
  it('formats relative times', () => {
    expect(formatRelative(now + 90_000, now)).toBe('in 2 minutes');
    expect(formatRelative(now - 3 * 86_400_000, now)).toBe('3 days ago');
    expect(formatRelative(now + 500, now)).toBe('just now');
  });
  it('treats large NumericDates as milliseconds', () => {
    expect(numericDateMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(numericDateMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(numericDateMs('x')).toBeUndefined();
  });
  it('judges expiry and not-before', () => {
    const exp = Math.floor(now / 1000) - 60;
    expect(getTiming({ exp }, now)).toEqual({ expired: true, notYetValid: false, expiresInMs: -60_000 });
    expect(getTiming({ nbf: Math.floor(now / 1000) + 60 }, now).notYetValid).toBe(true);
    expect(getTiming({}, now)).toEqual({ expired: false, notYetValid: false });
  });
  it('orders registered claims first and resolves dates', () => {
    const rows = describeClaims({ name: 'Ada', exp: Math.floor(now / 1000) + 3600, sub: '1', email: 'a@x.io' }, now);
    expect(rows.map((r) => r.name)).toEqual(['sub', 'exp', 'name', 'email']);
    const exp = rows[1]!;
    expect(exp.date).toBe('2026-10-03T13:00:00.000Z');
    expect(exp.relative).toBe('in 1 hour');
    expect(exp.status).toBe('ok');
    expect(rows[3]!.meaning).toBe('Email address');
  });
  it('describes header params and algorithms', () => {
    const rows = describeHeader({ alg: 'RS256', kid: 'k1' });
    expect(rows[0]!.meaning).toBe('RSA PKCS#1 v1.5 signature with SHA-256');
    expect(rows[1]!.meaning).toMatch(/Key ID/);
    expect(describeAlg('none')).toMatch(/Unsigned/);
    expect(describeAlg('ES256')).toMatch(/ECDSA/);
  });
  it('summarizes the token state', () => {
    const d = decodeJwt(SAMPLE_TOKEN);
    expect(summarize(d, now)).toMatchObject({ tone: 'ok', text: expect.stringMatching(/^HS256 · expires in/) });
    expect(summarize(decodeJwt(make({ alg: 'none' }, { sub: 1 }, '')), now).tone).toBe('bad');
    expect(summarize(decodeJwt(make({ alg: 'HS256' }, { exp: 1 })), now)).toMatchObject({ tone: 'bad', text: expect.stringContaining('expired') });
  });
});

describe('HMAC verification', () => {
  it('verifies the sample with its secret and rejects a wrong secret', async () => {
    expect(await verifyHmac(SAMPLE_TOKEN, SAMPLE_SECRET)).toBe(true);
    expect(await verifyHmac(SAMPLE_TOKEN, 'wrong')).toBe(false);
  });
  it('signs and verifies HS384 and base64 secrets', async () => {
    const t = await signHmac({ alg: 'HS384', typ: 'JWT' }, { sub: 'x' }, 'k');
    expect(await verifyHmac(t, 'k')).toBe(true);
    const t2 = await signHmac({ alg: 'HS256' }, { sub: 'x' }, 'c2VjcmV0', true);
    expect(await verifyHmac(t2, 'secret')).toBe(true);
  });
  it('refuses non-HMAC algorithms and empty secrets', async () => {
    await expect(verifyHmac(make({ alg: 'RS256' }, {}), 'k')).rejects.toThrow(/public key/);
    await expect(verifyHmac(make({ alg: 'none' }, {}, ''), 'k')).rejects.toThrow(/unsigned/);
    await expect(verifyHmac(SAMPLE_TOKEN, '')).rejects.toThrow(/Enter the secret/);
  });
});
