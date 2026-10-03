import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFS,
  MAX_EDGE,
  combineLayout,
  combinedName,
  exceedsLimit,
  formatInfo,
  maxSafeDpi,
  megapixels,
  normalizeHex,
  normalizePrefs,
  outputName,
  pixelSize,
  rangeFromSelection,
  scaleForDpi,
  selectionFromRange,
} from './logic';

const A4 = { width: 595.28, height: 841.89 };

describe('resolution', () => {
  it('converts DPI to scale and pixel size', () => {
    expect(scaleForDpi(72)).toBe(1);
    expect(scaleForDpi(144)).toBe(2);
    expect(pixelSize(A4, 72)).toEqual({ width: 595, height: 841 });
    expect(pixelSize(A4, 300)).toEqual({ width: 2480, height: 3507 });
    expect(megapixels({ width: 2000, height: 1000 })).toBe(2);
  });
  it('guards against pages that are too large', () => {
    expect(exceedsLimit(A4, 300)).toBe(false);
    const poster = { width: 2384, height: 3370 }; // A0
    expect(exceedsLimit(poster, 300)).toBe(true);
    expect(exceedsLimit({ width: 100, height: 4000 }, 300)).toBe(true); // edge over 16384
    expect(maxSafeDpi(poster)).toBe(150);
    expect(maxSafeDpi(A4)).toBe(300);
  });
});

describe('names', () => {
  it('builds per-page and combined names', () => {
    expect(outputName('Annual Report.pdf', 3, 'png')).toBe('Annual Report-page-3.png');
    expect(outputName('scan.PDF', 12, 'jpeg')).toBe('scan-page-12.jpg');
    expect(combinedName('slides.pdf', 'webp')).toBe('slides-pages.webp');
    expect(formatInfo('webp').mime).toBe('image/webp');
  });
});

describe('selection', () => {
  it('turns range text into a page set', () => {
    expect([...selectionFromRange('', 4)]).toEqual([1, 2, 3, 4]);
    expect([...selectionFromRange('1-2, 4', 5)].sort()).toEqual([1, 2, 4]);
    expect(() => selectionFromRange('9', 3)).toThrow(/does not exist/);
  });
  it('turns a selection back into compact text', () => {
    expect(rangeFromSelection([1, 2, 3, 5, 7, 8], 10)).toBe('1-3, 5, 7-8');
    expect(rangeFromSelection([4], 10)).toBe('4');
    expect(rangeFromSelection([1, 2, 3], 3)).toBe('');
    expect(rangeFromSelection([3, 1, 1, 2, 9], 5)).toBe('1-3');
  });
});

describe('combineLayout', () => {
  it('stacks pages centred with a gap', () => {
    const l = combineLayout([
      { width: 100, height: 200 },
      { width: 80, height: 100 },
    ], 10);
    expect(l).toMatchObject({ width: 100, height: 310, scale: 1 });
    expect(l.placements).toEqual([
      { x: 0, y: 0, width: 100, height: 200 },
      { x: 10, y: 210, width: 80, height: 100 },
    ]);
  });
  it('scales down to the canvas edge limit', () => {
    const pages = Array.from({ length: 10 }, () => ({ width: 2480, height: 3508 }));
    const l = combineLayout(pages);
    expect(l.height).toBeLessThanOrEqual(MAX_EDGE);
    expect(l.scale).toBeLessThan(1);
    expect(l.placements).toHaveLength(10);
    expect(combineLayout([])).toEqual({ width: 0, height: 0, scale: 1, placements: [] });
  });
});

describe('prefs', () => {
  it('normalises colours and stored prefs', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('red', '#000000')).toBe('#000000');
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ format: 'jpeg', dpi: 300, quality: 75, background: '#FFF', transparent: true, combine: true })).toEqual({ format: 'jpeg', dpi: 300, quality: 75, background: '#ffffff', transparent: true, combine: true });
    expect(normalizePrefs({ format: 'gif', dpi: 123, quality: 500 })).toEqual(DEFAULT_PREFS);
  });
});

describe('more edge cases', () => {
  it('marks lossy formats and their extensions', () => {
    expect(formatInfo('png')).toMatchObject({ lossy: false, ext: 'png' });
    expect(formatInfo('jpeg')).toMatchObject({ lossy: true, ext: 'jpg', mime: 'image/jpeg' });
    expect(formatInfo('webp').lossy).toBe(true);
  });
  it('accepts open-ended and reversed ranges', () => {
    expect([...selectionFromRange('3-', 5)].sort()).toEqual([3, 4, 5]);
    expect([...selectionFromRange('4-2', 5)].sort()).toEqual([2, 3, 4]);
    expect(rangeFromSelection([], 5)).toBe('');
  });
  it('centres narrower pages after scaling', () => {
    const l = combineLayout([
      { width: 1000, height: 10000 },
      { width: 500, height: 10000 },
    ], 0, 10000);
    expect(l.scale).toBe(0.5);
    expect(l.width).toBe(500);
    expect(l.placements[1]).toEqual({ x: 125, y: 5000, width: 250, height: 5000 });
  });
});
