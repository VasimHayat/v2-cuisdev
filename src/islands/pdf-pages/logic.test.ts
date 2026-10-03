import { describe, expect, it } from 'vitest';
import {
  PdfError,
  deletePages,
  describePart,
  dropIndexToTarget,
  duplicatePages,
  historyPush,
  historyRedo,
  historyUndo,
  initialPages,
  isModified,
  movePagesTo,
  normalizeRotation,
  nudgePages,
  planSplit,
  rangeIds,
  reorderedName,
  rotatePages,
  selectPreset,
  type PageItem,
} from './logic';

let n = 0;
const id = () => `id${++n}`;
const fresh = (count: number) => {
  n = 0;
  return initialPages(count, id);
};
const sources = (pages: PageItem[]) => pages.map((p) => p.source);

describe('page model', () => {
  it('starts with one item per source page', () => {
    const pages = fresh(3);
    expect(pages).toEqual([
      { id: 'id1', source: 0, rotation: 0 },
      { id: 'id2', source: 1, rotation: 0 },
      { id: 'id3', source: 2, rotation: 0 },
    ]);
    expect(isModified(pages, 3)).toBe(false);
  });

  it('rotates selected pages and wraps around', () => {
    const pages = fresh(2);
    const once = rotatePages(pages, new Set(['id1']), 90);
    expect(once[0]!.rotation).toBe(90);
    expect(once[1]!.rotation).toBe(0);
    expect(rotatePages(once, new Set(['id1']), -180)[0]!.rotation).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(isModified(once, 2)).toBe(true);
  });

  it('deletes and duplicates', () => {
    const pages = fresh(3);
    expect(sources(deletePages(pages, new Set(['id2'])))).toEqual([0, 2]);
    const dup = duplicatePages(pages, new Set(['id1', 'id3']), () => 'copy');
    expect(sources(dup)).toEqual([0, 0, 1, 2, 2]);
    expect(dup[1]!.id).toBe('copy');
  });

  it('moves a block of pages to a target position', () => {
    const pages = fresh(5);
    expect(sources(movePagesTo(pages, new Set(['id4', 'id5']), 0))).toEqual([3, 4, 0, 1, 2]);
    expect(sources(movePagesTo(pages, new Set(['id1']), 99))).toEqual([1, 2, 3, 4, 0]);
    expect(sources(movePagesTo(pages, new Set(), 0))).toEqual([0, 1, 2, 3, 4]);
  });

  it('translates drop positions that account for the moved pages', () => {
    const pages = fresh(5);
    const ids = new Set(['id1', 'id2']);
    // Dropping before page 5 (index 4): pages 3 and 4 remain before it.
    const target = dropIndexToTarget(pages, ids, 4);
    expect(target).toBe(2);
    expect(sources(movePagesTo(pages, ids, target))).toEqual([2, 3, 0, 1, 4]);
  });

  it('nudges selected pages with the keyboard and stops at the edges', () => {
    const pages = fresh(4);
    expect(sources(nudgePages(pages, new Set(['id2']), 1))).toEqual([0, 2, 1, 3]);
    expect(sources(nudgePages(pages, new Set(['id2', 'id3']), -1))).toEqual([1, 2, 0, 3]);
    expect(sources(nudgePages(pages, new Set(['id1']), -1))).toEqual([0, 1, 2, 3]);
  });
});

describe('selection', () => {
  it('applies presets by current position', () => {
    const pages = fresh(5);
    expect([...selectPreset(pages, new Set(), 'odd')]).toEqual(['id1', 'id3', 'id5']);
    expect([...selectPreset(pages, new Set(), 'even')]).toEqual(['id2', 'id4']);
    expect([...selectPreset(pages, new Set(['id1']), 'invert')]).toEqual(['id2', 'id3', 'id4', 'id5']);
    expect(selectPreset(pages, new Set(['id1']), 'none').size).toBe(0);
    expect(selectPreset(pages, new Set(), 'all').size).toBe(5);
  });

  it('builds shift-click ranges in either direction', () => {
    const pages = fresh(5);
    expect(rangeIds(pages, 3, 1)).toEqual(['id2', 'id3', 'id4']);
    expect(rangeIds(pages, 4, 9)).toEqual(['id5']);
  });
});

describe('split plans', () => {
  it('splits every N pages with padded names', () => {
    const pages = fresh(10);
    const parts = planSplit(pages, new Set(), { mode: 'every', every: 4, ranges: '' }, 'Report Q3.pdf');
    expect(parts.map((p) => p.name)).toEqual(['Report Q3-pages-01-04', 'Report Q3-pages-05-08', 'Report Q3-pages-09-10']);
    expect(parts.map((p) => p.pages.length)).toEqual([4, 4, 2]);
    expect(() => planSplit(pages, new Set(), { mode: 'every', every: 0, ranges: '' }, 'a.pdf')).toThrow(PdfError);
  });

  it('splits by ranges using the current order', () => {
    const pages = movePagesTo(fresh(6), new Set(['id6']), 0); // order: 5,0,1,2,3,4
    const parts = planSplit(pages, new Set(), { mode: 'ranges', every: 1, ranges: '1-2, 3-4; 5-' }, 'doc.pdf');
    expect(parts.map((p) => sources(p.pages))).toEqual([[5, 0], [1, 2], [3, 4]]);
    expect(parts[2]!.name).toBe('doc-pages-5-6');
    expect(() => planSplit(pages, new Set(), { mode: 'ranges', every: 1, ranges: '1-9' }, 'doc.pdf')).toThrow(/does not exist/);
    expect(() => planSplit(pages, new Set(), { mode: 'ranges', every: 1, ranges: ' ' }, 'doc.pdf')).toThrow(/at least one range/);
  });

  it('extracts the selection, each page, and odd and even pages', () => {
    const pages = fresh(3);
    expect(sources(planSplit(pages, new Set(['id3', 'id1']), { mode: 'selection', every: 1, ranges: '' }, 'a.pdf')[0]!.pages)).toEqual([0, 2]);
    expect(() => planSplit(pages, new Set(), { mode: 'selection', every: 1, ranges: '' }, 'a.pdf')).toThrow(/Select at least one/);
    expect(planSplit(pages, new Set(), { mode: 'each', every: 1, ranges: '' }, 'a.pdf').map((p) => p.name)).toEqual(['a-page-1', 'a-page-2', 'a-page-3']);
    const oe = planSplit(pages, new Set(), { mode: 'odd-even', every: 1, ranges: '' }, 'a.pdf');
    expect(oe.map((p) => [p.name, sources(p.pages)])).toEqual([
      ['a-odd-pages', [0, 2]],
      ['a-even-pages', [1]],
    ]);
    expect(() => planSplit([], new Set(), { mode: 'each', every: 1, ranges: '' }, 'a.pdf')).toThrow(/no pages/);
  });

  it('describes parts and names the reordered file', () => {
    const pages = rotatePages(fresh(2), new Set(['id2']), 90);
    expect(describePart({ name: 'x', pages })).toBe('2 pages, rotated');
    expect(describePart({ name: 'x', pages: [pages[0]!] })).toBe('1 page');
    expect(reorderedName('C:\\scans\\contract.final.pdf')).toBe('contract.final-reordered.pdf');
  });
});

describe('history', () => {
  it('undoes and redoes, and a new edit clears redo', () => {
    let h = { past: [] as number[], present: 1, future: [] as number[] };
    h = historyPush(h, 2);
    h = historyPush(h, 3);
    h = historyUndo(h);
    expect(h.present).toBe(2);
    h = historyRedo(h);
    expect(h.present).toBe(3);
    h = historyUndo(historyUndo(h));
    expect(h.present).toBe(1);
    expect(historyUndo(h)).toBe(h);
    h = historyPush(h, 9);
    expect(h.future).toEqual([]);
    expect(historyRedo(h)).toBe(h);
  });
});
