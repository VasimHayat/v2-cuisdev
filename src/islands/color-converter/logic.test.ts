import { describe, expect, it } from 'vitest';
import {
  ColorParseError,
  colorToLab,
  colorToOklch,
  contrast,
  formatAll,
  gamutMap,
  harmonies,
  inGamut,
  parseColor,
  tintsAndShades,
  toHex,
  toHex8,
} from './logic';

const row = (input: string, id: string) => formatAll(parseColor(input)).find((r) => r.id === id)?.value;

describe('parseColor', () => {
  it('reads hex in every length, with and without #', () => {
    expect(toHex(parseColor('#f00'))).toBe('#ff0000');
    expect(toHex8(parseColor('#f008'))).toBe('#ff000088');
    expect(toHex(parseColor('3b82f6'))).toBe('#3b82f6');
    expect(parseColor('#3b82f680').alpha).toBeCloseTo(128 / 255, 5);
    expect(() => parseColor('#12345')).toThrow(ColorParseError);
  });
  it('reads rgb in modern and legacy syntax, with alpha', () => {
    expect(toHex(parseColor('rgb(59 130 246)'))).toBe('#3b82f6');
    expect(toHex(parseColor('rgba(59, 130, 246, 0.5)'))).toBe('#3b82f6');
    expect(parseColor('rgba(59, 130, 246, 0.5)').alpha).toBe(0.5);
    expect(parseColor('rgb(100% 0% 0% / 25%)')).toMatchObject({ r: 1, g: 0, b: 0, alpha: 0.25 });
    expect(toHex(parseColor('255, 128, 0'))).toBe('#ff8000');
  });
  it('reads hsl, hwb, angles and none', () => {
    expect(toHex(parseColor('hsl(120 100% 25%)'))).toBe('#008000');
    expect(toHex(parseColor('hsl(0.5turn 100% 50%)'))).toBe('#00ffff');
    expect(toHex(parseColor('hwb(0 0% 0%)'))).toBe('#ff0000');
    expect(toHex(parseColor('hwb(none 50% 50%)'))).toBe('#808080');
  });
  it('reads named colours and transparent', () => {
    expect(toHex(parseColor('RebeccaPurple'))).toBe('#663399');
    expect(parseColor('transparent').alpha).toBe(0);
  });
  it('rejects nonsense with a helpful message', () => {
    expect(() => parseColor('blurple')).toThrow(/not a colour/);
    expect(() => parseColor('rgb(1 2)')).toThrow(/three values/);
    expect(() => parseColor('foo(1 2 3)')).toThrow(/not a supported colour function/);
  });
});

describe('colour spaces', () => {
  it('matches CSS Color 4 reference values for red', () => {
    expect(row('#ff0000', 'oklch')).toBe('oklch(62.8% 0.2577 29.23)');
    expect(row('#ff0000', 'oklab')).toBe('oklab(62.8% 0.2249 0.1258)');
    const lab = colorToLab(parseColor('#ff0000'));
    expect(lab.l).toBeCloseTo(54.29, 1);
    expect(lab.a).toBeCloseTo(80.8, 0);
    expect(lab.b).toBeCloseTo(69.89, 0);
  });
  it('round-trips through oklch, lab and lch', () => {
    for (const input of ['oklch(62.8% 0.2577 29.23)', 'lab(54.29% 80.8 69.89)', 'lch(54.29% 106.84 40.85)']) {
      expect(toHex(parseColor(input))).toBe('#ff0000');
    }
    expect(toHex(parseColor('oklab(0.7 -0.1 0.1)'))).toBe(toHex(parseColor(row('oklab(0.7 -0.1 0.1)', 'oklab')!)));
  });
  it('white and black are achromatic', () => {
    const w = colorToOklch(parseColor('white'));
    expect(w.l).toBeCloseTo(1, 4);
    expect(w.c).toBeLessThan(1e-4);
    expect(row('black', 'oklch')).toBe('oklch(0% 0 0)');
  });
  it('formats every row for a known colour', () => {
    const rows = Object.fromEntries(formatAll(parseColor('#3b82f6')).map((r) => [r.id, r.value]));
    expect(rows.rgb).toBe('rgb(59 130 246)');
    expect(rows.hsl).toBe('hsl(217.2 91.2% 59.8%)');
    expect(rows.hwb).toBe('hwb(217.2 23.1% 3.5%)');
    expect(rows.tailwind).toBe('bg-[#3b82f6]');
    expect(row('rgb(255 0 0 / 50%)', 'rgb')).toBe('rgb(255 0 0 / 50%)');
  });
});

describe('gamut mapping', () => {
  it('flags and maps out-of-gamut colours', () => {
    const vivid = parseColor('oklch(70% 0.4 145)');
    expect(inGamut(vivid)).toBe(false);
    const mapped = gamutMap(vivid);
    expect(inGamut(mapped)).toBe(true);
    const lch = colorToOklch(mapped);
    // The final clip may shift hue slightly, within the 0.02 deltaE OK tolerance.
    expect(Math.abs(lch.h - 145)).toBeLessThan(4);
    expect(lch.l).toBeGreaterThan(0.6);
  });
  it('leaves in-gamut colours alone', () => {
    expect(toHex(gamutMap(parseColor('#3b82f6')))).toBe('#3b82f6');
  });
});

describe('palettes and contrast', () => {
  it('builds ten tints and shades from light to dark', () => {
    const steps = tintsAndShades(parseColor('#3b82f6'));
    expect(steps).toHaveLength(10);
    const ls = steps.map((c) => colorToOklch(c).l);
    expect(ls.every((l, i) => i === 0 || l < ls[i - 1]!)).toBe(true);
    expect(steps.every((c) => inGamut(c))).toBe(true);
  });
  it('builds harmonies with the right hue offsets', () => {
    const h = harmonies(parseColor('#3b82f6'));
    const comp = h.find((x) => x.name === 'Complementary')!.colors;
    const d = Math.abs(colorToOklch(comp[0]!).h - colorToOklch(comp[1]!).h);
    expect(Math.min(d, 360 - d)).toBeGreaterThan(170);
    expect(h.find((x) => x.name === 'Triadic')!.colors).toHaveLength(3);
  });
  it('computes WCAG contrast', () => {
    expect(contrast(parseColor('black'), parseColor('white')).ratio).toBeCloseTo(21, 5);
    const r = contrast(parseColor('#777777'), parseColor('white'));
    expect(r.grade.aa).toBe(false);
    expect(r.grade.aaLarge).toBe(true);
  });
});
