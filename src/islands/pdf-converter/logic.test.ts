import { describe, expect, it } from 'vitest';
import {
  PdfError,
  classify,
  describeBatch,
  moveItem,
  outputFileName,
  pagesFor,
  parsePageRange,
  pixelsToPoints,
  placeImage,
  rotatedDims,
  totalPages,
} from './logic';

describe('files', () => {
  it('classifies images and PDFs by type or extension', () => {
    expect(classify({ name: 'a.pdf', type: '' })).toBe('pdf');
    expect(classify({ name: 'x', type: 'application/pdf' })).toBe('pdf');
    expect(classify({ name: 'photo.HEIC', type: '' })).toBe('image');
    expect(classify({ name: 'a.png', type: 'image/png' })).toBe('image');
    expect(classify({ name: 'notes.txt', type: 'text/plain' })).toBeNull();
  });
  it('names the output sensibly', () => {
    expect(outputFileName([], '')).toBe('document.pdf');
    expect(outputFileName([{ name: 'scan.jpg', kind: 'image' }], '')).toBe('scan.pdf');
    expect(outputFileName([{ name: 'a.pdf', kind: 'pdf' }, { name: 'b.pdf', kind: 'pdf' }], '')).toBe('a-merged.pdf');
    expect(outputFileName([{ name: 'a.jpg', kind: 'image' }, { name: 'b.jpg', kind: 'image' }, { name: 'c.jpg', kind: 'image' }], '')).toBe('a-and-2-more.pdf');
    expect(outputFileName([{ name: 'a.jpg', kind: 'image' }, { name: 'b.pdf', kind: 'pdf' }], '')).toBe('combined.pdf');
    expect(outputFileName([], 'Q3: report / final')).toBe('Q3- report - final.pdf');
  });
});

describe('page ranges', () => {
  it('parses lists, ranges and open ends', () => {
    expect(parsePageRange('', 3)).toEqual([0, 1, 2]);
    expect(parsePageRange('1-3, 5', 6)).toEqual([0, 1, 2, 4]);
    expect(parsePageRange('4-', 6)).toEqual([3, 4, 5]);
    expect(parsePageRange('-2', 6)).toEqual([0, 1]);
    expect(parsePageRange('3-1', 6)).toEqual([0, 1, 2]);
    expect(parsePageRange('2 2', 6)).toEqual([1, 1]);
  });
  it('rejects bad input with a reason', () => {
    expect(() => parsePageRange('0', 3)).toThrow(/start at 1/);
    expect(() => parsePageRange('7', 3)).toThrow(/Page 7 does not exist/);
    expect(() => parsePageRange('a-b', 3)).toThrow(PdfError);
    expect(() => parsePageRange('-', 3)).toThrow(/not a page range/);
  });
  it('counts pages per item and in total', () => {
    const img = { kind: 'image' as const, range: '' };
    const pdf = { kind: 'pdf' as const, pageCount: 10, range: '1-3' };
    const bad = { kind: 'pdf' as const, pageCount: 10, range: '99' };
    const loading = { kind: 'pdf' as const, range: '' };
    expect(pagesFor(img)).toBe(1);
    expect(pagesFor(pdf)).toBe(3);
    expect(pagesFor(bad)).toBe(0);
    expect(pagesFor(loading)).toBe(0);
    expect(totalPages([img, pdf, bad, loading])).toBe(4);
  });
});

describe('placement', () => {
  it('converts pixels to points at 96 dpi', () => {
    expect(pixelsToPoints(96)).toBe(72);
  });
  it('sizes a fit page to the image plus margins', () => {
    const p = placeImage({ width: 960, height: 480 }, { pageSize: 'fit', orientation: 'auto', margin: 'none', fit: 'contain' });
    expect(p.page).toEqual({ width: 720, height: 360 });
    expect(p).toMatchObject({ x: 0, y: 0, width: 720, height: 360 });
    const m = placeImage({ width: 96, height: 96 }, { pageSize: 'fit', orientation: 'auto', margin: 'small', fit: 'contain' });
    expect(m.page.width).toBeCloseTo(72 + 2 * 28.35, 2);
    expect(m.x).toBeCloseTo(28.35, 2);
  });
  it('orients named pages automatically and contains the image', () => {
    const p = placeImage({ width: 2000, height: 1000 }, { pageSize: 'a4', orientation: 'auto', margin: 'none', fit: 'contain' });
    expect(p.page).toEqual({ width: 841.89, height: 595.28 });
    expect(p.width).toBeCloseTo(841.89, 2);
    expect(p.height).toBeCloseTo(420.945, 2);
    expect(p.y).toBeCloseTo((595.28 - 420.945) / 2, 2);
    const forced = placeImage({ width: 2000, height: 1000 }, { pageSize: 'a4', orientation: 'portrait', margin: 'medium', fit: 'contain' });
    expect(forced.page).toEqual({ width: 595.28, height: 841.89 });
    expect(forced.width).toBeCloseTo(595.28 - 2 * 56.69, 2);
  });
  it('covers the page when asked, cropping to the box', () => {
    const p = placeImage({ width: 1000, height: 1000 }, { pageSize: 'letter', orientation: 'portrait', margin: 'none', fit: 'cover' });
    expect(p.width).toBe(612);
    expect(p.height).toBe(792);
  });
  it('swaps dimensions for odd rotations', () => {
    expect(rotatedDims({ width: 4, height: 3 }, 1)).toEqual({ width: 3, height: 4 });
    expect(rotatedDims({ width: 4, height: 3 }, 2)).toEqual({ width: 4, height: 3 });
  });
});

describe('list helpers', () => {
  it('moves items and ignores bad indexes', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
  it('describes the batch', () => {
    expect(describeBatch([])).toBe('nothing yet · 0 pages · 0 B');
    expect(describeBatch([{ kind: 'image', range: '', size: 2048 }, { kind: 'pdf', pageCount: 2, range: '', size: 1024 }])).toBe('1 image and 1 PDF · 3 pages · 3.0 KB');
  });
});
