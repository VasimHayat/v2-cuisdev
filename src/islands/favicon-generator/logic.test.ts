import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPTIONS,
  ICO_SIZES,
  PNG_OUTPUTS,
  buildHtml,
  buildIco,
  buildManifest,
  containIn,
  fileList,
  fontSizeFor,
  graphemeCount,
  layout,
  normalizeBasePath,
  normalizeHex,
  readIcoDirectory,
  sanitizePrefs,
} from './logic';

const fakePng = (n: number, fill: number) => new Uint8Array(n).fill(fill);

describe('ICO container', () => {
  it('writes the ICONDIR header little-endian', () => {
    const ico = buildIco([{ size: 16, png: fakePng(10, 1) }, { size: 32, png: fakePng(20, 2) }, { size: 48, png: fakePng(30, 3) }]);
    expect(Array.from(ico.subarray(0, 6))).toEqual([0, 0, 1, 0, 3, 0]);
    expect(ico.length).toBe(6 + 3 * 16 + 60);
  });
  it('writes each ICONDIRENTRY with size, bpp, length and offset', () => {
    const ico = buildIco([{ size: 16, png: fakePng(10, 1) }, { size: 32, png: fakePng(20, 2) }]);
    const first = Array.from(ico.subarray(6, 22));
    expect(first).toEqual([16, 16, 0, 0, 1, 0, 32, 0, 10, 0, 0, 0, 38, 0, 0, 0]);
    const dir = readIcoDirectory(ico);
    expect(dir.entries[1]).toEqual({ width: 32, height: 32, bpp: 32, size: 20, offset: 48 });
    expect(ico[48]).toBe(2);
    expect(ico[ico.length - 1]).toBe(2);
  });
  it('stores 256 px as 0 and rejects bad sizes or an empty list', () => {
    const ico = buildIco([{ size: 256, png: fakePng(4, 9) }]);
    expect(ico[6]).toBe(0);
    expect(readIcoDirectory(ico).entries[0]!.width).toBe(256);
    expect(() => buildIco([])).toThrow(/at least one/);
    expect(() => buildIco([{ size: 300, png: fakePng(1, 0) }])).toThrow(/1 to 256/);
  });
});

describe('manifest and HTML', () => {
  it('builds a web manifest with both Android icons', () => {
    const m = JSON.parse(buildManifest({ ...DEFAULT_OPTIONS, appName: 'Cuisdev Tools', shortName: 'Cuisdev', basePath: '/assets' }));
    expect(m.name).toBe('Cuisdev Tools');
    expect(m.short_name).toBe('Cuisdev');
    expect(m.display).toBe('standalone');
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual(['/assets/android-chrome-192x192.png', '/assets/android-chrome-512x512.png']);
    expect(m.theme_color).toBe('#4f46e5');
  });
  it('falls back for empty names and truncates long short names', () => {
    const m = JSON.parse(buildManifest({ ...DEFAULT_OPTIONS, appName: '  ', shortName: 'A very long short name' }));
    expect(m.name).toBe('My Website');
    expect(m.short_name).toBe('A very long ');
  });
  it('writes the HTML snippet with or without an SVG icon', () => {
    const withSvg = buildHtml({ themeColor: '#ABC', basePath: '/' }, true);
    expect(withSvg).toContain('<link rel="icon" href="/icon.svg" type="image/svg+xml">');
    expect(withSvg).toContain('<meta name="theme-color" content="#aabbcc">');
    expect(buildHtml({ themeColor: '#fff', basePath: '/' }, false)).not.toContain('icon.svg');
  });
  it('normalises base paths', () => {
    expect(normalizeBasePath('')).toBe('/');
    expect(normalizeBasePath('static')).toBe('/static/');
    expect(normalizeBasePath('//a//b')).toBe('/a/b/');
    expect(normalizeBasePath('https://cdn.example.com/icons')).toBe('https://cdn.example.com/icons/');
  });
  it('lists every output file', () => {
    expect(fileList(false)).toEqual(['favicon.ico', ...PNG_OUTPUTS.map((o) => o.name), 'site.webmanifest', 'favicon-html.txt']);
    expect(fileList(true)).toContain('icon.svg');
    expect(ICO_SIZES).toEqual([16, 32, 48]);
    expect(PNG_OUTPUTS.find((o) => o.name === 'apple-touch-icon.png')).toMatchObject({ size: 180, opaque: true });
  });
});

describe('geometry and options', () => {
  it('computes padding and radius', () => {
    expect(layout(100, { padding: 10, radius: 50 })).toEqual({ radius: 50, inner: { x: 10, y: 10, size: 80 } });
    expect(layout(16, { padding: 99, radius: -5 })).toEqual({ radius: 0, inner: { x: 5, y: 5, size: 6 } });
  });
  it('fits images inside the box keeping their aspect ratio', () => {
    expect(containIn(200, 100, { x: 0, y: 0, size: 100 })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(containIn(50, 100, { x: 10, y: 10, size: 80 })).toEqual({ x: 30, y: 10, w: 40, h: 80 });
  });
  it('sizes text by grapheme count', () => {
    expect(graphemeCount('👨‍👩‍👧')).toBe(1);
    expect(graphemeCount(' AB ')).toBe(2);
    expect(fontSizeFor(100, 1)).toBeGreaterThan(fontSizeFor(100, 2));
    expect(fontSizeFor(100, 3)).toBeCloseTo(30, 0);
  });
  it('sanitises stored preferences', () => {
    const p = sanitizePrefs({ source: 'image', text: 'ABCDEFG', padding: 99, radius: 12.6, background: 'red', font: 'nope', transparent: true });
    expect(p).toMatchObject({ source: 'image', text: 'ABCD', padding: 30, radius: 13, background: '#4f46e5', font: 'system-ui', transparent: true });
    expect(sanitizePrefs(null)).toEqual(DEFAULT_OPTIONS);
    expect(normalizeHex('#FfF')).toBe('#ffffff');
  });
});
