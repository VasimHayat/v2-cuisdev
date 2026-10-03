/**
 * PDF Compress: what can honestly be done in a browser, as pure functions.
 *
 * - Optimise (lossless): copy every page into a fresh pdf-lib document, which drops
 *   objects nothing references, optionally drop the document metadata, and save with
 *   object streams. Text stays selectable. Often saves little on already-clean files.
 * - Compress images (strong): the island rasterises each page with pdf.js to a JPEG;
 *   `buildRasterPdf` here rebuilds a PDF with one JPEG per page at the original page
 *   size. Large savings on scanned or image-heavy files, but text is no longer text.
 *
 * pdf-lib runs in Node, so everything here is unit-testable; rendering is not here.
 */

export type CompressMode = 'optimize' | 'raster';
export type QualityPreset = 'low' | 'medium' | 'high';

export const QUALITY_PRESETS: Record<QualityPreset, { label: string; quality: number; dpi: number }> = {
  low: { label: 'Smallest', quality: 50, dpi: 72 },
  medium: { label: 'Balanced', quality: 70, dpi: 96 },
  high: { label: 'Best quality', quality: 85, dpi: 150 },
};

export const RASTER_DPIS = [72, 96, 120, 150] as const;

export interface Prefs {
  mode: CompressMode;
  /** Keep title, author, subject and keywords in Optimise mode. */
  keepMetadata: boolean;
  dpi: number;
  /** JPEG quality 1 to 100. */
  quality: number;
  /** Convert pages to grayscale before encoding (strong mode). */
  grayscale: boolean;
}

export const DEFAULT_PREFS: Prefs = { mode: 'optimize', keepMetadata: true, dpi: 96, quality: 70, grayscale: false };

export class CompressError extends Error {
  override name = 'CompressError';
}

type PdfLib = typeof import('pdf-lib');
let lib: Promise<PdfLib> | undefined;
function pdfLib(): Promise<PdfLib> {
  lib ??= import('pdf-lib');
  return lib;
}

/** Lossless re-save. Returns the new bytes; never changes page content. */
export async function optimizePdf(input: Uint8Array, options: { keepMetadata: boolean }): Promise<Uint8Array> {
  const { PDFDocument } = await pdfLib();
  let src;
  try {
    src = await PDFDocument.load(input, { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/encrypt/i.test(msg)) throw new CompressError('This PDF is encrypted. Remove the password first, then optimise it.');
    throw new CompressError('This file could not be read as a PDF.');
  }
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = await out.copyPages(src, src.getPageIndices());
  for (const p of pages) out.addPage(p);
  if (options.keepMetadata) {
    const title = src.getTitle();
    const author = src.getAuthor();
    const subject = src.getSubject();
    const keywords = src.getKeywords();
    if (title) out.setTitle(title);
    if (author) out.setAuthor(author);
    if (subject) out.setSubject(subject);
    if (keywords) out.setKeywords(keywords.split(/[,;]\s*/).filter(Boolean));
  }
  out.setProducer('Cuisdev PDF Compress');
  out.setCreator('cuisdev.com');
  return out.save({ useObjectStreams: true, addDefaultPage: false });
}

export interface RasterPage {
  /** JPEG bytes of the rendered page. */
  jpeg: Uint8Array;
  /** Page size in PDF points (after rotation). */
  width: number;
  height: number;
}

/** Rebuild a PDF with one full-page JPEG per page. */
export async function buildRasterPdf(pages: readonly RasterPage[], meta: { title?: string } = {}): Promise<Uint8Array> {
  if (pages.length === 0) throw new CompressError('There are no pages to write.');
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const p of pages) {
    const img = await doc.embedJpg(p.jpeg);
    const page = doc.addPage([p.width, p.height]);
    page.drawImage(img, { x: 0, y: 0, width: p.width, height: p.height });
  }
  if (meta.title) doc.setTitle(meta.title);
  doc.setProducer('Cuisdev PDF Compress');
  doc.setCreator('cuisdev.com');
  return doc.save({ useObjectStreams: true });
}

/** Page count of a PDF, for tests and the summary line. */
export async function countPages(input: Uint8Array): Promise<number> {
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

export interface Outcome {
  before: number;
  after: number;
  /** Bytes saved; negative when the result is larger. */
  saved: number;
  /** Percent saved, one decimal; negative when larger. */
  percent: number;
  /** True when the result is not meaningfully smaller (under 1 percent). */
  noGain: boolean;
  larger: boolean;
  message: string;
}

export function describeOutcome(before: number, after: number): Outcome {
  const saved = before - after;
  const percent = before > 0 ? Math.round((saved / before) * 1000) / 10 : 0;
  const larger = after > before;
  const noGain = percent < 1;
  let message: string;
  if (larger) message = `The result is ${formatSize(after - before)} larger than the original, so keep the original. This file is already well compressed.`;
  else if (noGain) message = 'Almost no saving: this PDF is already compact. Try Compress images for scanned or image-heavy files.';
  else message = `Saved ${formatSize(saved)} (${percent}% smaller).`;
  return { before, after, saved, percent, noGain, larger, message };
}

export function formatSize(bytes: number): string {
  const b = Math.abs(bytes);
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

/** "report.pdf" -> "report-compressed.pdf" */
export function compressedName(name: string): string {
  const stem = name.replace(/\.pdf$/i, '').trim() || 'document';
  return `${stem}-compressed.pdf`;
}

/** Rough per-page pixel count for a DPI, to warn before huge strong-mode jobs. */
export function rasterPixels(points: { width: number; height: number }, dpi: number): number {
  const s = dpi / 72;
  return Math.floor(points.width * s) * Math.floor(points.height * s);
}

/** Which preset (if any) the current dpi and quality match. */
export function presetFor(dpi: number, quality: number): QualityPreset | null {
  for (const [id, p] of Object.entries(QUALITY_PRESETS) as [QualityPreset, (typeof QUALITY_PRESETS)[QualityPreset]][]) {
    if (p.dpi === dpi && p.quality === quality) return id;
  }
  return null;
}

export function normalizePrefs(raw: unknown): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return p;
  const r = raw as Partial<Prefs>;
  if (r.mode === 'optimize' || r.mode === 'raster') p.mode = r.mode;
  if (typeof r.keepMetadata === 'boolean') p.keepMetadata = r.keepMetadata;
  if (typeof r.dpi === 'number' && (RASTER_DPIS as readonly number[]).includes(r.dpi)) p.dpi = r.dpi;
  if (typeof r.quality === 'number' && r.quality >= 1 && r.quality <= 100) p.quality = Math.round(r.quality);
  if (typeof r.grayscale === 'boolean') p.grayscale = r.grayscale;
  return p;
}
