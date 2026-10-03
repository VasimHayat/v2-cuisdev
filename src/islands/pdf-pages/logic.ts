/**
 * PDF pages: pure page-model operations and split plans, no DOM.
 *
 * A document is edited as a list of PageItems. Each item points at a page of the
 * source PDF (0-based `source`) and carries its own extra rotation, so moving,
 * rotating, deleting and duplicating never touch the original bytes. The output is
 * written from this list with pdf-lib's copyPages, which keeps text and vector
 * content intact.
 */
import { PdfError, baseName, parsePageRange } from '../pdf-converter/logic';

export { PdfError };

export type Rotation = 0 | 90 | 180 | 270;

export interface PageItem {
  /** Stable id for keys and selection. */
  id: string;
  /** 0-based page index in the source PDF. */
  source: number;
  /** Extra clockwise rotation applied on top of the page's own rotation. */
  rotation: Rotation;
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `p${Date.now().toString(36)}${counter.toString(36)}`;
}

/** One item per source page, in order. */
export function initialPages(count: number, makeId: () => string = newId): PageItem[] {
  return Array.from({ length: count }, (_, i) => ({ id: makeId(), source: i, rotation: 0 as Rotation }));
}

export function normalizeRotation(deg: number): Rotation {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation;
}

/** Rotate the given pages by `delta` degrees (multiples of 90). */
export function rotatePages(pages: readonly PageItem[], ids: ReadonlySet<string>, delta: number): PageItem[] {
  return pages.map((p) => (ids.has(p.id) ? { ...p, rotation: normalizeRotation(p.rotation + delta) } : p));
}

export function deletePages(pages: readonly PageItem[], ids: ReadonlySet<string>): PageItem[] {
  return pages.filter((p) => !ids.has(p.id));
}

/** Insert a copy of each selected page right after it. */
export function duplicatePages(pages: readonly PageItem[], ids: ReadonlySet<string>, makeId: () => string = newId): PageItem[] {
  const out: PageItem[] = [];
  for (const p of pages) {
    out.push(p);
    if (ids.has(p.id)) out.push({ ...p, id: makeId() });
  }
  return out;
}

/**
 * Move the selected pages as a block so the first of them lands at `target`, an index
 * into the list as it would be after removing the moved pages. Order among the moved
 * pages is preserved.
 */
export function movePagesTo(pages: readonly PageItem[], ids: ReadonlySet<string>, target: number): PageItem[] {
  const moving = pages.filter((p) => ids.has(p.id));
  if (moving.length === 0) return [...pages];
  const rest = pages.filter((p) => !ids.has(p.id));
  const at = Math.max(0, Math.min(rest.length, target));
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/**
 * Translate a drop position, given as an insertion index in the full list (0 = before
 * the first page, length = after the last), into a `movePagesTo` target.
 */
export function dropIndexToTarget(pages: readonly PageItem[], ids: ReadonlySet<string>, insertBefore: number): number {
  let target = 0;
  for (let i = 0; i < Math.min(insertBefore, pages.length); i++) if (!ids.has(pages[i]!.id)) target++;
  return target;
}

/** Shift the selected pages one step left (-1) or right (+1), as a keyboard move does. */
export function nudgePages(pages: readonly PageItem[], ids: ReadonlySet<string>, step: -1 | 1): PageItem[] {
  const indexes = pages.map((p, i) => (ids.has(p.id) ? i : -1)).filter((i) => i >= 0);
  if (indexes.length === 0) return [...pages];
  const first = indexes[0]!;
  const rest = pages.filter((p) => !ids.has(p.id));
  const before = pages.slice(0, first).filter((p) => !ids.has(p.id)).length;
  return movePagesTo(pages, ids, Math.max(0, Math.min(rest.length, before + step)));
}

// --- selection -----------------------------------------------------------------

export type SelectPreset = 'all' | 'none' | 'odd' | 'even' | 'invert';

/** Odd and even refer to positions in the current order (1-based). */
export function selectPreset(pages: readonly PageItem[], current: ReadonlySet<string>, preset: SelectPreset): Set<string> {
  switch (preset) {
    case 'all':
      return new Set(pages.map((p) => p.id));
    case 'none':
      return new Set();
    case 'odd':
      return new Set(pages.filter((_, i) => i % 2 === 0).map((p) => p.id));
    case 'even':
      return new Set(pages.filter((_, i) => i % 2 === 1).map((p) => p.id));
    case 'invert':
      return new Set(pages.filter((p) => !current.has(p.id)).map((p) => p.id));
  }
}

/** Ids of the pages between two positions, inclusive, in either direction. */
export function rangeIds(pages: readonly PageItem[], fromIndex: number, toIndex: number): string[] {
  const a = Math.max(0, Math.min(fromIndex, toIndex));
  const b = Math.min(pages.length - 1, Math.max(fromIndex, toIndex));
  return pages.slice(a, b + 1).map((p) => p.id);
}

// --- split plans -----------------------------------------------------------------

export type SplitMode = 'selection' | 'every' | 'ranges' | 'each' | 'odd-even';

export interface SplitOptions {
  mode: SplitMode;
  /** For 'every': pages per file. */
  every: number;
  /** For 'ranges': e.g. "1-3, 4-6, 7-"; each comma-separated part becomes one file. */
  ranges: string;
}

export interface OutputPart {
  /** File name without extension. */
  name: string;
  /** Pages in output order. */
  pages: PageItem[];
}

/**
 * Turn the current page list into output files. Page numbers in `ranges` refer to the
 * current order (what the user sees), not the source document.
 */
export function planSplit(pages: readonly PageItem[], selected: ReadonlySet<string>, options: SplitOptions, sourceName: string): OutputPart[] {
  const stem = baseName(sourceName || 'document.pdf');
  const total = pages.length;
  if (total === 0) throw new PdfError('There are no pages to split.');
  const pad = (n: number) => String(n).padStart(String(total).length, '0');
  const label = (from: number, to: number) => (from === to ? `page-${pad(from)}` : `pages-${pad(from)}-${pad(to)}`);

  switch (options.mode) {
    case 'selection': {
      const chosen = pages.filter((p) => selected.has(p.id));
      if (chosen.length === 0) throw new PdfError('Select at least one page to extract.');
      return [{ name: `${stem}-extract`, pages: chosen }];
    }
    case 'every': {
      const n = Math.floor(options.every);
      if (!Number.isFinite(n) || n < 1) throw new PdfError('Pages per file must be a whole number of at least 1.');
      const parts: OutputPart[] = [];
      for (let i = 0; i < total; i += n) {
        const chunk = pages.slice(i, i + n);
        parts.push({ name: `${stem}-${label(i + 1, i + chunk.length)}`, pages: chunk });
      }
      return parts;
    }
    case 'each':
      return pages.map((p, i) => ({ name: `${stem}-${label(i + 1, i + 1)}`, pages: [p] }));
    case 'odd-even': {
      const odd = pages.filter((_, i) => i % 2 === 0);
      const even = pages.filter((_, i) => i % 2 === 1);
      const parts: OutputPart[] = [{ name: `${stem}-odd-pages`, pages: odd }];
      if (even.length) parts.push({ name: `${stem}-even-pages`, pages: even });
      return parts;
    }
    case 'ranges': {
      const groups = options.ranges
        .split(/[,;]/)
        .map((g) => g.trim())
        .filter(Boolean);
      if (groups.length === 0) throw new PdfError('Enter at least one range, for example 1-3, 4-6, 7-.');
      return groups.map((g) => {
        let indexes: number[];
        try {
          indexes = parsePageRange(g, total);
        } catch (err) {
          throw new PdfError(`"${g}": ${err instanceof Error ? err.message : 'invalid range'}`);
        }
        const first = indexes[0]! + 1;
        const last = indexes[indexes.length - 1]! + 1;
        return { name: `${stem}-${label(Math.min(first, last), Math.max(first, last))}`, pages: indexes.map((i) => pages[i]!) };
      });
    }
  }
}

/** Short description of the pages in a part, e.g. "3 pages" or "1 page, rotated". */
export function describePart(part: OutputPart): string {
  const n = part.pages.length;
  const rotated = part.pages.some((p) => p.rotation !== 0);
  return `${n} page${n === 1 ? '' : 's'}${rotated ? ', rotated' : ''}`;
}

/** True when the list differs from the untouched source (order, rotation, count). */
export function isModified(pages: readonly PageItem[], sourceCount: number): boolean {
  if (pages.length !== sourceCount) return true;
  return pages.some((p, i) => p.source !== i || p.rotation !== 0);
}

/** Name for the reordered document. */
export function reorderedName(sourceName: string): string {
  return `${baseName(sourceName || 'document.pdf')}-reordered.pdf`;
}

// --- history -----------------------------------------------------------------------

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function historyPush<T>(h: History<T>, next: T, limit = 50): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}

export function historyUndo<T>(h: History<T>): History<T> {
  const prev = h.past[h.past.length - 1];
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function historyRedo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return h;
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}
