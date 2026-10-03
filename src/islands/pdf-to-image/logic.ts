/**
 * PDF to Image: pure helpers, no DOM. Resolution maths, the size guard, page
 * selection and range text, output naming and the layout for combining pages into
 * one tall image. Rendering with pdf.js lives in the island.
 */
import { parsePageRange, baseName } from '../pdf-converter/logic';

export type ImageFormat = 'png' | 'jpeg' | 'webp';

export const FORMATS: { id: ImageFormat; label: string; mime: string; ext: string; lossy: boolean }[] = [
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', lossy: false },
  { id: 'jpeg', label: 'JPG', mime: 'image/jpeg', ext: 'jpg', lossy: true },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', lossy: true },
];

export const DPI_PRESETS = [72, 96, 150, 200, 300] as const;
export type Dpi = (typeof DPI_PRESETS)[number];

/** Pages larger than this are refused: a canvas that big exhausts memory on most devices. */
export const MAX_MEGAPIXELS = 50;
/** Browsers cap a canvas edge at about 16384 pixels; the combined image respects it. */
export const MAX_EDGE = 16384;
/** Gap in pixels between pages in the combined image. */
export const COMBINE_GAP = 16;

export interface Size {
  width: number;
  height: number;
}

export interface Prefs {
  format: ImageFormat;
  dpi: Dpi;
  /** 1 to 100, JPEG and WebP only. */
  quality: number;
  /** Hex colour painted under each page. */
  background: string;
  /** PNG only: keep the page transparent instead of painting the background. */
  transparent: boolean;
  combine: boolean;
}

export const DEFAULT_PREFS: Prefs = { format: 'png', dpi: 150, quality: 90, background: '#ffffff', transparent: false, combine: false };

export function formatInfo(id: ImageFormat) {
  return FORMATS.find((f) => f.id === id) ?? FORMATS[0]!;
}

/** Pixels per PDF point for a DPI (PDF points are 1/72 inch). */
export function scaleForDpi(dpi: number): number {
  return dpi / 72;
}

/** Output pixel size of a page given its size in points. */
export function pixelSize(points: Size, dpi: number): Size {
  const s = scaleForDpi(dpi);
  return { width: Math.max(1, Math.floor(points.width * s)), height: Math.max(1, Math.floor(points.height * s)) };
}

export function megapixels(size: Size): number {
  return (size.width * size.height) / 1_000_000;
}

/** Whether a page at this DPI is too large to render safely. */
export function exceedsLimit(points: Size, dpi: number): boolean {
  const px = pixelSize(points, dpi);
  return megapixels(px) > MAX_MEGAPIXELS || px.width > MAX_EDGE || px.height > MAX_EDGE;
}

/** The highest preset DPI that keeps the page within the limits, or 72 as a floor. */
export function maxSafeDpi(points: Size): Dpi {
  let best: Dpi = 72;
  for (const d of DPI_PRESETS) if (!exceedsLimit(points, d)) best = d;
  return best;
}

/** "<pdf>-page-<n>.<ext>" */
export function outputName(pdfName: string, page: number, format: ImageFormat): string {
  return `${baseName(pdfName)}-page-${page}.${formatInfo(format).ext}`;
}

export function combinedName(pdfName: string, format: ImageFormat): string {
  return `${baseName(pdfName)}-pages.${formatInfo(format).ext}`;
}

/** Selected page numbers (1-based) from range text; empty text selects every page. */
export function selectionFromRange(text: string, total: number): Set<number> {
  return new Set(parsePageRange(text, total).map((i) => i + 1));
}

/** Compact range text for a selection: [1,2,3,5,7,8] -> "1-3, 5, 7-8". Every page -> "". */
export function rangeFromSelection(selected: Iterable<number>, total: number): string {
  const pages = [...new Set(selected)].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  if (pages.length === total) return '';
  const parts: string[] = [];
  let start = pages[0];
  let prev = pages[0];
  for (let i = 1; i <= pages.length; i++) {
    const n = pages[i];
    if (n !== undefined && prev !== undefined && n === prev + 1) {
      prev = n;
      continue;
    }
    if (start !== undefined && prev !== undefined) parts.push(start === prev ? String(start) : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(', ');
}

export interface CombineLayout {
  width: number;
  height: number;
  /** Uniform downscale applied so the result fits MAX_EDGE (1 when it already fits). */
  scale: number;
  /** Top offset and size of each page inside the combined image, in output pixels. */
  placements: { y: number; x: number; width: number; height: number }[];
}

/** Stack pages vertically, centred, scaled down uniformly to fit the canvas edge limit. */
export function combineLayout(sizes: readonly Size[], gap = COMBINE_GAP, maxEdge = MAX_EDGE): CombineLayout {
  if (sizes.length === 0) return { width: 0, height: 0, scale: 1, placements: [] };
  const rawWidth = Math.max(...sizes.map((s) => s.width));
  const rawHeight = sizes.reduce((h, s) => h + s.height, 0) + gap * (sizes.length - 1);
  const scale = Math.min(1, maxEdge / rawHeight, maxEdge / rawWidth);
  const width = Math.max(1, Math.floor(rawWidth * scale));
  const placements: CombineLayout['placements'] = [];
  let y = 0;
  for (const s of sizes) {
    const w = Math.max(1, Math.floor(s.width * scale));
    const h = Math.max(1, Math.floor(s.height * scale));
    placements.push({ x: Math.floor((width - w) / 2), y, width: w, height: h });
    y += h + Math.floor(gap * scale);
  }
  const height = Math.max(1, y - Math.floor(gap * scale));
  return { width, height, scale, placements };
}

export function normalizeHex(value: string, fallback = '#ffffff'): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
  return fallback;
}

/** Validate prefs read from storage. */
export function normalizePrefs(raw: unknown): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Partial<Prefs>;
  if (r.format === 'png' || r.format === 'jpeg' || r.format === 'webp') p.format = r.format;
  if (typeof r.dpi === 'number' && (DPI_PRESETS as readonly number[]).includes(r.dpi)) p.dpi = r.dpi as Dpi;
  if (typeof r.quality === 'number' && r.quality >= 1 && r.quality <= 100) p.quality = Math.round(r.quality);
  if (typeof r.background === 'string') p.background = normalizeHex(r.background);
  if (typeof r.transparent === 'boolean') p.transparent = r.transparent;
  if (typeof r.combine === 'boolean') p.combine = r.combine;
  return p;
}
