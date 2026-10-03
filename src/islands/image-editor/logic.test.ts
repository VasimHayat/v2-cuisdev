import { describe, expect, it } from 'vitest';
import {
  ImageError,
  assertUsableFile,
  baseName,
  centeredCrop,
  clampRect,
  describeState,
  dragRect,
  filterString,
  fitScale,
  flipRectH,
  flipState,
  initialState,
  isIdentity,
  matchAspect,
  normalizeHex,
  orientedSize,
  outputFileName,
  parseDimension,
  rotateRectCcw,
  rotateRectCw,
  rotateState,
  scaleByPercent,
  withCrop,
  DEFAULT_ADJUST,
} from './logic';

const SRC = { width: 1600, height: 1000 };

describe('files and names', () => {
  it('derives names and extensions', () => {
    expect(baseName('C:\\photos\\holiday.final.JPG')).toBe('holiday.final');
    expect(baseName('   ')).toBe('image');
    expect(outputFileName('photo.jpg', { width: 800, height: 450 }, 'image/webp')).toBe('photo-800x450.webp');
  });
  it('rejects non-images and oversized files', () => {
    expect(() => assertUsableFile({ name: 'a.txt', type: 'text/plain', size: 10 })).toThrow(ImageError);
    expect(() => assertUsableFile({ name: 'a.png', type: '', size: 0 })).toThrow(/empty/);
    expect(() => assertUsableFile({ name: 'a.png', type: 'image/png', size: 60 * 1024 * 1024 })).toThrow(/limit/);
    expect(() => assertUsableFile({ name: 'a.heic', type: '', size: 10 })).not.toThrow();
  });
  it('parses numbers and colours', () => {
    expect(parseDimension('800', 1)).toBe(800);
    expect(parseDimension('abc', 42)).toBe(42);
    expect(parseDimension('99999', 1)).toBe(16384);
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('nope', '#000000')).toBe('#000000');
  });
});

describe('geometry', () => {
  it('centres aspect crops', () => {
    expect(centeredCrop(SRC, 1)).toEqual({ x: 300, y: 0, width: 1000, height: 1000 });
    expect(centeredCrop(SRC, 16 / 9)).toEqual({ x: 0, y: 50, width: 1600, height: 900 });
    expect(centeredCrop(SRC, null)).toEqual({ x: 0, y: 0, width: 1600, height: 1000 });
  });
  it('clamps rects into the image', () => {
    expect(clampRect({ x: -10, y: 990, width: 2000, height: 50 }, SRC)).toEqual({ x: 0, y: 950, width: 1600, height: 50 });
    expect(clampRect({ x: 10, y: 10, width: 0, height: 0 }, SRC)).toEqual({ x: 10, y: 10, width: 1, height: 1 });
  });
  it('rotates and flips rects with the image', () => {
    const crop = { x: 100, y: 200, width: 400, height: 300 };
    const cw = rotateRectCw(crop, SRC);
    expect(cw).toEqual({ x: 500, y: 100, width: 300, height: 400 });
    expect(rotateRectCcw(cw, orientedSize(SRC, 1))).toEqual(crop);
    expect(flipRectH(crop, SRC)).toEqual({ ...crop, x: 1100 });
  });
  it('keeps aspect when one edge changes', () => {
    expect(matchAspect({ width: 800, height: 1 }, 16 / 9, 'width')).toEqual({ width: 800, height: 450 });
    expect(matchAspect({ width: 1, height: 450 }, 16 / 9, 'height')).toEqual({ width: 800, height: 450 });
    expect(scaleByPercent(SRC, 50)).toEqual({ width: 800, height: 500 });
  });
  it('fits the preview without upscaling', () => {
    expect(fitScale(SRC, { width: 800, height: 800 })).toBe(0.5);
    expect(fitScale({ width: 100, height: 100 }, { width: 800, height: 800 })).toBe(1);
  });
});

describe('dragRect', () => {
  const start = { x: 100, y: 100, width: 400, height: 300 };
  it('moves without leaving the image', () => {
    expect(dragRect(start, 'move', 50, -500, SRC, null)).toEqual({ x: 150, y: 0, width: 400, height: 300 });
  });
  it('resizes from a corner and an edge', () => {
    expect(dragRect(start, 'se', 100, 50, SRC, null)).toEqual({ x: 100, y: 100, width: 500, height: 350 });
    expect(dragRect(start, 'w', 50, 0, SRC, null)).toEqual({ x: 150, y: 100, width: 350, height: 300 });
    expect(dragRect(start, 'n', -200, -200, SRC, null)).toEqual({ x: 100, y: 0, width: 400, height: 400 });
  });
  it('keeps the ratio when locked', () => {
    const r = dragRect(start, 'se', 200, 0, SRC, 2);
    expect(r.width / r.height).toBeCloseTo(2, 1);
    const e = dragRect(start, 'e', 200, 0, SRC, 4 / 3);
    expect(e.width / e.height).toBeCloseTo(4 / 3, 1);
    expect(e.y + e.height).toBeLessThanOrEqual(SRC.height);
  });
  it('never collapses below the minimum size', () => {
    const r = dragRect(start, 'se', -1000, -1000, SRC, null);
    expect(r.width).toBeGreaterThanOrEqual(8);
    expect(r.height).toBeGreaterThanOrEqual(8);
  });
});

describe('state', () => {
  it('starts as identity and tracks edits', () => {
    const s = initialState(SRC);
    expect(isIdentity(s, SRC)).toBe(true);
    expect(describeState(s, SRC)).toBe('no edits yet');
    const rotated = rotateState(s, SRC, 'cw');
    expect(rotated.rotation).toBe(1);
    expect(rotated.crop).toEqual({ x: 0, y: 0, width: 1000, height: 1600 });
    expect(rotated.resize).toEqual({ width: 1000, height: 1600 });
    expect(isIdentity(rotated, SRC)).toBe(false);
    expect(rotateState(rotated, SRC, 'ccw')).toEqual(s);
  });
  it('rotates a crop and an explicit resize together', () => {
    const s = { ...withCrop(initialState(SRC), { x: 100, y: 200, width: 400, height: 300 }), resize: { width: 800, height: 600 } };
    const r = rotateState(s, SRC, 'cw');
    expect(r.crop).toEqual({ x: 500, y: 100, width: 300, height: 400 });
    expect(r.resize).toEqual({ width: 600, height: 800 });
    expect(describeState(r, SRC)).toBe('rotated 90°, cropped to 300 × 400, resized to 600 × 800');
  });
  it('flips and keeps the crop under the same pixels', () => {
    const s = withCrop(initialState(SRC), { x: 0, y: 0, width: 400, height: 300 });
    const f = flipState(s, SRC, 'h');
    expect(f.flipH).toBe(true);
    expect(f.crop.x).toBe(1200);
  });
  it('builds filter strings', () => {
    expect(filterString(DEFAULT_ADJUST)).toBe('');
    expect(filterString({ ...DEFAULT_ADJUST, brightness: 120, blur: 2, hue: -30 })).toBe('brightness(120%) hue-rotate(-30deg) blur(2px)');
  });
});
