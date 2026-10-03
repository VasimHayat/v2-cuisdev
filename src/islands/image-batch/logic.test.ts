import { describe, expect, it } from 'vitest';
import { defaultSettings, describeTotals, outputName, planResize, resolveFormat, resolveQuality, sanitizeSettings, savingsPercent, searchQuality, totals, wantsTargetSize, type Settings } from './logic';

const SRC = { width: 4000, height: 3000 };
const resize = (patch: Partial<Settings>): Settings => ({ ...defaultSettings('resize'), ...patch });

describe('settings', () => {
  it('enables the section that matches the page', () => {
    expect(defaultSettings('compress')).toMatchObject({ compress: true, convert: false, resize: false });
    expect(defaultSettings('convert')).toMatchObject({ compress: false, convert: true, resize: false });
    expect(defaultSettings('resize')).toMatchObject({ compress: false, convert: false, resize: true });
  });
  it('sanitizes stored values field by field', () => {
    const s = sanitizeSettings({ quality: 400, convertTo: 'image/tiff', width: 800, fit: 'cover', background: '#abc', preset: 'nope' }, 'convert');
    expect(s.quality).toBe(100);
    expect(s.convertTo).toBe('image/webp');
    expect(s.width).toBe(800);
    expect(s.fit).toBe('cover');
    expect(s.background).toBe('#aabbcc');
    expect(s.preset).toBe(defaultSettings('convert').preset);
    expect(sanitizeSettings('junk', 'resize')).toEqual(defaultSettings('resize'));
  });
});

describe('formats', () => {
  it('lets convert win, then forced compress formats, then the source', () => {
    const c = defaultSettings('compress');
    expect(resolveFormat('image/png', c)).toBe('image/png');
    expect(resolveFormat('image/png', { ...c, compressFormat: 'image/webp' })).toBe('image/webp');
    expect(resolveFormat('image/png', { ...c, convert: true, convertTo: 'image/jpeg' })).toBe('image/jpeg');
    expect(resolveFormat('image/gif', c)).toBe('image/png');
    expect(resolveFormat('image/jpg', c)).toBe('image/jpeg');
  });
  it('falls back when the browser cannot write the target', () => {
    const s = { ...defaultSettings('convert'), convertTo: 'image/avif' as const };
    expect(resolveFormat('image/jpeg', s, (m) => m !== 'image/avif')).toBe('image/jpeg');
  });
  it('picks quality and target-size mode', () => {
    expect(resolveQuality(defaultSettings('compress'))).toBe(75);
    expect(resolveQuality(defaultSettings('convert'))).toBe(90);
    const t = { ...defaultSettings('compress'), sizeMode: 'target' as const };
    expect(wantsTargetSize(t, 'image/jpeg')).toBe(true);
    expect(wantsTargetSize(t, 'image/png')).toBe(false);
  });
});

describe('planResize', () => {
  it('leaves the size alone when resize is off', () => {
    expect(planResize(SRC, defaultSettings('compress'))).toEqual({ width: 4000, height: 3000, sx: 0, sy: 0, sw: 4000, sh: 3000 });
  });
  it('scales by width, height, longest edge and percent', () => {
    expect(planResize(SRC, resize({ resizeMode: 'width', width: 1200 }))).toMatchObject({ width: 1200, height: 900 });
    expect(planResize(SRC, resize({ resizeMode: 'height', height: 600 }))).toMatchObject({ width: 800, height: 600 });
    expect(planResize(SRC, resize({ resizeMode: 'longest', longest: 1000 }))).toMatchObject({ width: 1000, height: 750 });
    expect(planResize(SRC, resize({ resizeMode: 'percent', percent: 25 }))).toMatchObject({ width: 1000, height: 750 });
  });
  it('fits inside, stretches, or fills and crops a box', () => {
    expect(planResize(SRC, resize({ resizeMode: 'both', width: 800, height: 800, fit: 'contain' }))).toMatchObject({ width: 800, height: 600 });
    expect(planResize(SRC, resize({ resizeMode: 'both', width: 800, height: 800, fit: 'stretch' }))).toMatchObject({ width: 800, height: 800 });
    expect(planResize(SRC, resize({ resizeMode: 'both', width: 800, height: 800, fit: 'cover' }))).toEqual({ width: 800, height: 800, sx: 500, sy: 0, sw: 3000, sh: 3000 });
  });
  it('never enlarges unless allowed', () => {
    const small = { width: 400, height: 300 };
    expect(planResize(small, resize({ resizeMode: 'width', width: 1200 }))).toMatchObject({ width: 400, height: 300 });
    expect(planResize(small, resize({ resizeMode: 'width', width: 1200, noUpscale: false }))).toMatchObject({ width: 1200, height: 900 });
    expect(planResize(small, resize({ resizeMode: 'both', width: 1000, height: 1000, fit: 'cover' }))).toMatchObject({ width: 300, height: 300, sw: 300, sh: 300 });
  });
});

describe('searchQuality', () => {
  // A fake encoder whose size grows linearly with quality: 10 KB per quality step.
  const fake = async (q: number) => ({ size: q * 10_240, value: `q${q}` });
  it('finds the highest quality under the target', async () => {
    const r = await searchQuality(500 * 1024, fake);
    expect(r.met).toBe(true);
    expect(r.quality).toBeLessThanOrEqual(50);
    expect(r.quality).toBeGreaterThanOrEqual(45);
    expect(r.value).toBe(`q${r.quality}`);
  });
  it('returns the smallest attempt when the target cannot be met', async () => {
    const r = await searchQuality(10, fake);
    expect(r.met).toBe(false);
    expect(r.quality).toBe(5);
  });
});

describe('naming and totals', () => {
  it('names outputs with the new extension and optional size', () => {
    expect(outputName('Holiday photo.PNG', 'image/webp', null)).toBe('Holiday photo.webp');
    expect(outputName('a.jpeg', 'image/jpeg', { width: 800, height: 600 })).toBe('a-800x600.jpg');
  });
  it('summarizes savings and growth', () => {
    expect(savingsPercent(1000, 250)).toBe(75);
    expect(savingsPercent(1000, 1100)).toBe(-10);
    const t = totals([{ size: 2048, resultSize: 1024 }, { size: 1024 }]);
    expect(t).toEqual({ files: 2, done: 1, before: 2048, after: 1024, saved: 50 });
    expect(describeTotals(t)).toBe('1 of 2 done · 2.0 KB → 1.0 KB · saved 50%');
    expect(describeTotals(totals([]))).toBe('No files yet');
  });
});
