import { describe, expect, it } from 'vitest';
import { Base64Error, base64ToBytes, bytesToBase64, decodeText, encodeText, looksLikeBase64, normalizeBase64, sniffType, toDataUrl } from './base64';
import { UrlEncodeError, decodeOnce, looksEncoded, parseUrl, urlDecode, urlEncode } from './url';
import { countEntities, entityDecode, entityEncode, findUnknownEntities, hasEntities } from './entities';

describe('base64', () => {
  it('round-trips UTF-8 text including emoji', () => {
    const text = 'ünïcödé ✓ 🚀';
    expect(decodeText(encodeText(text))).toBe(text);
    expect(encodeText('Hello')).toBe('SGVsbG8=');
  });
  it('supports URL-safe output, wrapping and data URLs', () => {
    expect(encodeText('???>>>', { urlSafe: true })).toBe('Pz8_Pj4-');
    expect(encodeText('a'.repeat(80), { wrapAt: 76 }).split('\n').map((l) => l.length)).toEqual([76, 32]);
    expect(toDataUrl(new TextEncoder().encode('hi'), 'text/plain')).toBe('data:text/plain;base64,aGk=');
  });
  it('normalises whitespace, url-safe alphabet, padding and data URLs', () => {
    expect(normalizeBase64('SGVs\nbG8')).toBe('SGVsbG8=');
    expect(normalizeBase64('Pz8_Pj4-')).toBe('Pz8/Pj4+');
    expect(decodeText('data:text/plain;base64,aGk=')).toBe('hi');
  });
  it('rejects bad input with reasons', () => {
    expect(() => base64ToBytes('abc$')).toThrow(/Invalid character "\$"/);
    expect(() => base64ToBytes('abcde')).toThrow(/length/);
    expect(() => decodeText('/////w==')).toThrow(Base64Error);
  });
  it('sniffs binary types and guesses encoded text', () => {
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47])).ext).toBe('png');
    expect(sniffType(new Uint8Array([0x25, 0x50, 0x44, 0x46])).mime).toBe('application/pdf');
    expect(looksLikeBase64('SGVsbG8sIEN1aXNkZXYhIEJhc2U2NA==')).toBe(true);
    expect(looksLikeBase64('Hello there, this is prose.')).toBe(false);
    expect(bytesToBase64(new Uint8Array([0, 255, 128]))).toBe('AP+A');
  });
});

describe('url', () => {
  it('encodes in the three modes', () => {
    expect(urlEncode('a b&c=d/é', 'component')).toBe('a%20b%26c%3Dd%2F%C3%A9');
    expect(urlEncode('https://x.io/a b?q=é&r=1#t', 'full')).toBe('https://x.io/a%20b?q=%C3%A9&r=1#t');
    expect(urlEncode("a b!'()~", 'form')).toBe('a+b%21%27%28%29%7E');
  });
  it('decodes once or repeatedly and reports passes', () => {
    expect(decodeOnce('a%20b%26c', 'component')).toBe('a b&c');
    expect(decodeOnce('a+b', 'form')).toBe('a b');
    expect(decodeOnce('%2F%3F', 'full')).toBe('%2F%3F');
    expect(urlDecode('a%252520b', 'component', true)).toEqual({ text: 'a b', passes: 3 });
    expect(urlDecode('plain', 'component', true)).toEqual({ text: 'plain', passes: 0 });
  });
  it('rejects malformed escapes with an offset', () => {
    const err = (() => {
      try {
        decodeOnce('ok%2Gbad');
      } catch (e) {
        return e as UrlEncodeError;
      }
    })();
    expect(err).toBeInstanceOf(UrlEncodeError);
    expect(err?.offset).toBe(2);
    expect(() => decodeOnce('%C3%28')).toThrow(/valid UTF-8/);
    expect(() => urlEncode('\ud800')).toThrow(/lone surrogate/);
  });
  it('parses absolute URLs into parts', () => {
    const u = parseUrl('https://user@example.com:8443/search%20results?q=caf%C3%A9&page=2#top');
    expect(u).toMatchObject({ protocol: 'https', host: 'example.com', port: '8443', path: '/search results', hash: 'top', username: 'user' });
    expect(u?.query).toEqual([{ key: 'q', value: 'café' }, { key: 'page', value: '2' }]);
    expect(parseUrl('not a url')).toBeNull();
    expect(looksEncoded('a%20b')).toBe(true);
  });
});

describe('entities', () => {
  it('escapes essential characters and more', () => {
    expect(entityEncode('<a href="x">Tom & Jerry\'s</a>')).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
    expect(entityEncode('© 5 € ≥ 4 — ok', 'non-ascii')).toBe('&copy; 5 &euro; &ge; 4 &mdash; ok');
    expect(entityEncode('A\nb', 'decimal')).toBe('&#65;\n&#98;');
    expect(entityEncode('🚀', 'hex')).toBe('&#x1F680;');
  });
  it('decodes named, numeric and legacy references', () => {
    expect(entityDecode('&lt;b&gt; &amp;&amp; &quot;q&quot; &#39;s&#39; &copy; &#169; &#xA9;')).toBe('<b> && "q" \'s\' © © ©');
    expect(entityDecode('&copy2024 &ampersand &nbsp;x')).toBe('©2024 &ersand  x');
    expect(entityDecode('Tom & Jerry, a &b c, &foo;')).toBe('Tom & Jerry, a &b c, &foo;');
    expect(entityDecode('&#128; &#150; &#0; &#xD800;')).toBe('€ – � �');
  });
  it('reports unknown and existing entities', () => {
    expect(findUnknownEntities('&foo; &amp; &bar; &foo;')).toEqual(['&foo;', '&bar;']);
    expect(hasEntities('&amp;')).toBe(true);
    expect(hasEntities('&foo;')).toBe(false);
    expect(hasEntities('&#169;')).toBe(true);
    expect(countEntities('&lt;&gt;&#169;&#xA9;&nope;')).toBe(5);
  });
});
