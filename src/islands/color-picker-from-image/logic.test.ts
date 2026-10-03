import { describe, expect, it } from 'vitest';
import {
  addToPalette,
  bestTextColor,
  contrastRatio,
  exportPalette,
  extractPalette,
  formats,
  grade,
  nearestNamed,
  parseHex,
  sanitizePalette,
  toCmyk,
  toHex,
  toHsl,
  toHsv,
} from './logic';

const RED = { r: 255, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

describe('conversions', () => {
  it('formats and parses hex', () => {
    expect(toHex({ r: 79, g: 70, b: 229 })).toBe('#4f46e5');
    expect(parseHex('#ABC')).toEqual({ r: 170, g: 187, b: 204 });
    expect(parseHex('4f46e5')).toEqual({ r: 79, g: 70, b: 229 });
    expect(parseHex('#12')).toBeNull();
  });
  it('converts to HSL, HSV and CMYK', () => {
    expect(toHsl(RED)).toEqual({ h: 0, s: 100, l: 50 });
    expect(toHsl({ r: 0, g: 128, b: 128 })).toEqual({ h: 180, s: 100, l: 25 });
    expect(toHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 50 });
    expect(toHsv({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, v: 100 });
    expect(toCmyk(RED)).toEqual({ c: 0, m: 100, y: 100, k: 0 });
    expect(toCmyk(BLACK)).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });
  it('lists every format with the nearest name', () => {
    const f = formats({ r: 255, g: 99, b: 71 });
    expect(f.map((x) => x.id)).toEqual(['hex', 'rgb', 'hsl', 'hsv', 'cmyk', 'name']);
    expect(f[0]!.value).toBe('#ff6347');
    expect(f[5]!.value).toBe('tomato');
    expect(formats({ r: 254, g: 98, b: 70 })[5]!.value).toBe('tomato (closest)');
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBe(1);
    expect(contrastRatio({ r: 118, g: 118, b: 118 }, WHITE)).toBeCloseTo(4.54, 1);
  });
  it('grades against AA and AAA', () => {
    expect(grade(4.6)).toEqual({ ratio: 4.6, aa: true, aaLarge: true, aaa: false });
    expect(grade(3.2)).toMatchObject({ aa: false, aaLarge: true });
    expect(grade(7.1).aaa).toBe(true);
    expect(bestTextColor({ r: 250, g: 230, b: 100 })).toBe('#000000');
    expect(bestTextColor({ r: 30, g: 30, b: 90 })).toBe('#ffffff');
  });
  it('finds the nearest CSS name', () => {
    expect(nearestNamed({ r: 0, g: 0, b: 128 })).toEqual({ name: 'navy', exact: true, distance: 0 });
    expect(nearestNamed({ r: 250, g: 5, b: 5 }).name).toBe('red');
  });
});

describe('extractPalette', () => {
  const pixels = (colors: [number, number, number, number][]) => {
    const out = new Uint8ClampedArray(colors.length * 4);
    colors.forEach(([r, g, b, a], i) => out.set([r, g, b, a], i * 4));
    return out;
  };
  it('finds the main colours with their shares, largest first', () => {
    const data = pixels([...Array(600).fill([220, 20, 30, 255]), ...Array(300).fill([20, 40, 200, 255]), ...Array(100).fill([250, 250, 250, 255])]);
    const pal = extractPalette(data, 6);
    expect(pal.length).toBe(3);
    expect(toHex(pal[0]!)).toBe('#dc141e');
    expect(pal[0]!.share).toBeCloseTo(0.6, 2);
    expect(toHex(pal[1]!)).toBe('#1428c8');
    expect(pal.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 5);
  });
  it('skips transparent pixels and is deterministic', () => {
    const data = pixels([...Array(50).fill([0, 0, 0, 0]), ...Array(50).fill([10, 200, 10, 255])]);
    expect(extractPalette(data, 4)).toEqual([{ r: 10, g: 200, b: 10, share: 1 }]);
    expect(extractPalette(new Uint8ClampedArray(0))).toEqual([]);
    const noisy = pixels(Array.from({ length: 500 }, (_, i) => [(i * 37) % 256, (i * 91) % 256, (i * 13) % 256, 255] as [number, number, number, number]));
    expect(extractPalette(noisy, 8)).toEqual(extractPalette(noisy, 8));
    expect(extractPalette(noisy, 8).length).toBeLessThanOrEqual(8);
  });
});

describe('palette list and exports', () => {
  it('adds newest first, removes duplicates and caps the length', () => {
    let pal = addToPalette([], { ...RED, id: 'a' });
    pal = addToPalette(pal, { ...WHITE, id: 'b' });
    pal = addToPalette(pal, { ...RED, id: 'c' });
    expect(pal.map((p) => p.id)).toEqual(['c', 'b']);
    const many = Array.from({ length: 30 }, (_, i) => ({ r: i, g: 0, b: 0, id: String(i) }));
    expect(many.reduce((p, c) => addToPalette(p, c, 24), [] as typeof many)).toHaveLength(24);
  });
  it('exports CSS variables, JSON and Tailwind', () => {
    const cols = [RED, { r: 0, g: 0, b: 255 }];
    expect(exportPalette(cols, 'css')).toBe(':root {\n  --color-1: #ff0000;\n  --color-2: #0000ff;\n}\n');
    expect(JSON.parse(exportPalette(cols, 'json'))).toEqual(['#ff0000', '#0000ff']);
    const tw = exportPalette(cols, 'tailwind', 'brand');
    expect(tw).toContain("brand: {\n          '100': '#ff0000',\n          '200': '#0000ff',\n        },");
    expect(exportPalette(cols, 'hex')).toBe('#ff0000\n#0000ff\n');
  });
  it('sanitises stored palettes', () => {
    expect(sanitizePalette([{ r: 300, g: -4, b: 10.6, id: 'x' }, 'junk', { r: 1 }])).toEqual([{ r: 255, g: 0, b: 11, id: 'x' }]);
    expect(sanitizePalette(null)).toEqual([]);
  });
});
