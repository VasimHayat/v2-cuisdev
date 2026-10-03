/**
 * PDF Converter: pure helpers, no DOM. Page geometry, page-range parsing, file
 * classification and naming. The pdf-lib work lives in pdf.ts.
 */

export class PdfError extends Error {
  override name = 'PdfError';
}

/** Ceiling for one input file and for the whole batch. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 300 * 1024 * 1024;
export const MAX_ITEMS = 200;

/** PDF points: 72 per inch. */
export type PageSizeId = 'fit' | 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
export type MarginId = 'none' | 'small' | 'medium' | 'large';
export type FitId = 'contain' | 'cover';
export type Orientation = 'auto' | 'portrait' | 'landscape';

export interface Dimensions {
  width: number;
  height: number;
}

export const PAGE_SIZES: Record<Exclude<PageSizeId, 'fit'>, { label: string; width: number; height: number }> = {
  a4: { label: 'A4', width: 595.28, height: 841.89 },
  letter: { label: 'US Letter', width: 612, height: 792 },
  legal: { label: 'US Legal', width: 612, height: 1008 },
  a3: { label: 'A3', width: 841.89, height: 1190.55 },
  a5: { label: 'A5', width: 419.53, height: 595.28 },
};

export const MARGINS: Record<MarginId, { label: string; points: number }> = {
  none: { label: 'None', points: 0 },
  small: { label: 'Small (10 mm)', points: 28.35 },
  medium: { label: 'Medium (20 mm)', points: 56.69 },
  large: { label: 'Large (30 mm)', points: 85.04 },
};

export interface BuildOptions {
  pageSize: PageSizeId;
  orientation: Orientation;
  margin: MarginId;
  fit: FitId;
  /** JPEG quality for re-encoded images, 1 to 100. */
  quality: number;
  /** Keep original JPEG and PNG bytes instead of re-encoding (no rotation). */
  keepOriginal: boolean;
  title: string;
  author: string;
}

export const DEFAULT_OPTIONS: BuildOptions = {
  pageSize: 'fit',
  orientation: 'auto',
  margin: 'none',
  fit: 'contain',
  quality: 85,
  keepOriginal: true,
  title: '',
  author: '',
};

export type ItemKind = 'image' | 'pdf';

export interface Item {
  id: string;
  kind: ItemKind;
  file: File;
  name: string;
  size: number;
  /** Object URL thumbnail for images; undefined for PDFs. */
  thumb?: string;
  /** Image pixel size, once decoded. */
  dims?: Dimensions;
  /** Quarter turns clockwise for images. */
  rotation: 0 | 1 | 2 | 3;
  /** PDF page count, once read. */
  pageCount?: number;
  /** PDF page range text, e.g. "1-3, 7". Empty means all. */
  range: string;
  /** Problem reading the file, shown inline. */
  error?: string;
  /** True while the file is being inspected. */
  loading: boolean;
  encrypted?: boolean;
}

// --- files -------------------------------------------------------------------

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'avif', 'svg', 'tif', 'tiff', 'heic', 'heif']);

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function baseName(name: string): string {
  const withoutPath = name.split(/[/\\]/).pop() ?? '';
  const dot = withoutPath.lastIndexOf('.');
  const stem = dot < 1 ? withoutPath : withoutPath.slice(0, dot);
  return stem.trim() === '' ? 'document' : stem.trim();
}

export function classify(file: Pick<File, 'name' | 'type'>): ItemKind | null {
  if (file.type === 'application/pdf' || fileExtension(file.name) === 'pdf') return 'pdf';
  if (file.type.startsWith('image/') || IMAGE_EXT.has(fileExtension(file.name))) return 'image';
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Output name: the first file's stem, or "combined" when sources are mixed. */
export function outputFileName(items: readonly Pick<Item, 'name' | 'kind'>[], title: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-').trim();
  if (title.trim()) return `${clean(title)}.pdf`;
  if (items.length === 0) return 'document.pdf';
  if (items.length === 1) return `${baseName(items[0]!.name)}.pdf`;
  const kinds = new Set(items.map((i) => i.kind));
  if (kinds.size === 1 && kinds.has('pdf')) return `${baseName(items[0]!.name)}-merged.pdf`;
  if (kinds.size === 1) return `${baseName(items[0]!.name)}-and-${items.length - 1}-more.pdf`;
  return 'combined.pdf';
}

// --- page ranges -------------------------------------------------------------

/**
 * Parse "1-3, 5, 8-" into 0-based page indexes for a document with `total` pages.
 * Empty input means every page. Throws PdfError with a readable reason.
 */
export function parsePageRange(text: string, total: number): number[] {
  const t = text.trim();
  if (!t) return Array.from({ length: total }, (_, i) => i);
  const out: number[] = [];
  for (const partRaw of t.split(/[,;\s]+/)) {
    const part = partRaw.trim();
    if (!part) continue;
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) {
      if (m[1] === '' && m[2] === '') throw new PdfError(`"${part}" is not a page range. Use forms like 1-3, 5 or 8-.`);
      const a = m[1] === '' ? 1 : Number(m[1]);
      const b = m[2] === '' ? total : Number(m[2]);
      if (a < 1 || b < 1) throw new PdfError('Page numbers start at 1.');
      if (a > total || b > total) throw new PdfError(`Page ${Math.max(a, b)} does not exist. The document has ${total} page${total === 1 ? '' : 's'}.`);
      const [from, to] = a <= b ? [a, b] : [b, a];
      for (let p = from; p <= to; p++) out.push(p - 1);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const n = Number(part);
      if (n < 1) throw new PdfError('Page numbers start at 1.');
      if (n > total) throw new PdfError(`Page ${n} does not exist. The document has ${total} page${total === 1 ? '' : 's'}.`);
      out.push(n - 1);
      continue;
    }
    throw new PdfError(`"${part}" is not a page number or range. Use forms like 1-3, 5 or 8-.`);
  }
  if (out.length === 0) throw new PdfError('The page range selects no pages.');
  return out;
}

/** Pages an item contributes, or 0 while unknown or invalid. */
export function pagesFor(item: Pick<Item, 'kind' | 'pageCount' | 'range' | 'error'>): number {
  if (item.error) return 0;
  if (item.kind === 'image') return 1;
  if (!item.pageCount) return 0;
  try {
    return parsePageRange(item.range, item.pageCount).length;
  } catch {
    return 0;
  }
}

export function totalPages(items: readonly Pick<Item, 'kind' | 'pageCount' | 'range' | 'error'>[]): number {
  return items.reduce((n, i) => n + pagesFor(i), 0);
}

// --- geometry ----------------------------------------------------------------

export interface Placement {
  page: Dimensions;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Image pixels at 96 dpi expressed in PDF points (72 per inch). */
export function pixelsToPoints(px: number): number {
  return (px * 72) / 96;
}

/**
 * Where an image of `image` pixels goes on a page. "fit" pages are sized to the image;
 * named sizes are oriented per `orientation` and the image is contained or covered
 * inside the margins.
 */
export function placeImage(image: Dimensions, options: Pick<BuildOptions, 'pageSize' | 'orientation' | 'margin' | 'fit'>): Placement {
  const margin = MARGINS[options.margin].points;
  if (options.pageSize === 'fit') {
    const w = Math.max(1, pixelsToPoints(image.width));
    const h = Math.max(1, pixelsToPoints(image.height));
    return { page: { width: w + margin * 2, height: h + margin * 2 }, x: margin, y: margin, width: w, height: h };
  }
  const base = PAGE_SIZES[options.pageSize];
  const landscape = options.orientation === 'landscape' || (options.orientation === 'auto' && image.width > image.height);
  const page = landscape ? { width: base.height, height: base.width } : { width: base.width, height: base.height };
  const boxW = Math.max(1, page.width - margin * 2);
  const boxH = Math.max(1, page.height - margin * 2);
  const scale = options.fit === 'cover' ? Math.max(boxW / image.width, boxH / image.height) : Math.min(boxW / image.width, boxH / image.height);
  let width = image.width * scale;
  let height = image.height * scale;
  if (options.fit === 'cover') {
    width = Math.min(width, boxW);
    height = Math.min(height, boxH);
  }
  return { page, x: (page.width - width) / 2, y: (page.height - height) / 2, width, height };
}

/** Rotated pixel size of an image after quarter turns. */
export function rotatedDims(dims: Dimensions, rotation: number): Dimensions {
  return rotation % 2 === 0 ? { ...dims } : { width: dims.height, height: dims.width };
}

// --- list helpers ------------------------------------------------------------

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function describeBatch(items: readonly Pick<Item, 'kind' | 'pageCount' | 'range' | 'error' | 'size'>[]): string {
  const images = items.filter((i) => i.kind === 'image').length;
  const pdfs = items.filter((i) => i.kind === 'pdf').length;
  const parts: string[] = [];
  if (images) parts.push(`${images} image${images === 1 ? '' : 's'}`);
  if (pdfs) parts.push(`${pdfs} PDF${pdfs === 1 ? '' : 's'}`);
  const pages = totalPages(items);
  const bytes = items.reduce((n, i) => n + i.size, 0);
  return `${parts.join(' and ') || 'nothing yet'} · ${pages} page${pages === 1 ? '' : 's'} · ${formatBytes(bytes)}`;
}
