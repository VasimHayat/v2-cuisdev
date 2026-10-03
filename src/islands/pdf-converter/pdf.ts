/**
 * PDF Converter: the DOM side. Reads PDF page counts, turns images into embeddable
 * JPEG or PNG bytes (rotating on a canvas when asked) and builds the output document
 * with pdf-lib, which is loaded on first use.
 */
import { PdfError, parsePageRange, placeImage, rotatedDims, type BuildOptions, type Dimensions, type Item } from './logic';

type PdfLib = typeof import('pdf-lib');
let libPromise: Promise<PdfLib> | undefined;

export function loadPdfLib(): Promise<PdfLib> {
  libPromise ??= import('pdf-lib');
  return libPromise;
}

export function isPdfLibReady(): boolean {
  return libPromise !== undefined;
}

export interface PdfInfo {
  pageCount: number;
  encrypted: boolean;
}

/** Page count of a PDF. Encrypted files are opened read-only when the browser can. */
export async function readPdfInfo(file: File): Promise<PdfInfo> {
  const { PDFDocument } = await loadPdfLib();
  const bytes = await file.arrayBuffer();
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return { pageCount: doc.getPageCount(), encrypted: doc.isEncrypted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/password|encrypt/i.test(msg)) throw new PdfError('This PDF is password protected. Remove the password first.');
    throw new PdfError('This file is not a readable PDF. It may be corrupt.');
  }
}

export interface ImageInfo {
  dims: Dimensions;
  thumb: string;
}

/** Decode an image enough to know its size and produce a thumbnail URL. */
export async function readImageInfo(file: File): Promise<ImageInfo> {
  const bitmap = await decode(file);
  try {
    const dims = { width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, 160 / Math.max(dims.width, dims.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(dims.width * scale));
    canvas.height = Math.max(1, Math.round(dims.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PdfError('Canvas is not available.');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumb = await new Promise<string>((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.8));
    return { dims, thumb };
  } finally {
    if ('close' in bitmap) bitmap.close();
  }
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new PdfError(`"${file.name}" could not be decoded as an image.`));
        img.src = url;
      });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }
}

interface Embeddable {
  bytes: ArrayBuffer;
  format: 'jpg' | 'png';
  dims: Dimensions;
}

/**
 * Bytes pdf-lib can embed. JPEG and PNG files are used as-is when allowed and not
 * rotated; everything else (and rotated images) is drawn to a canvas and encoded as
 * PNG when it has transparency or JPEG otherwise.
 */
async function toEmbeddable(item: Item, options: BuildOptions): Promise<Embeddable> {
  const type = item.file.type;
  const dims = item.dims ?? (await readImageInfo(item.file)).dims;
  if (options.keepOriginal && item.rotation === 0 && (type === 'image/jpeg' || type === 'image/png')) {
    return { bytes: await item.file.arrayBuffer(), format: type === 'image/png' ? 'png' : 'jpg', dims };
  }
  const bitmap = await decode(item.file);
  try {
    const out = rotatedDims(dims, item.rotation);
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new PdfError('Canvas is not available.');
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((item.rotation * Math.PI) / 2);
    ctx.drawImage(bitmap, -dims.width / 2, -dims.height / 2, dims.width, dims.height);
    const alpha = type === 'image/png' || type === 'image/webp' || type === 'image/gif' || type === 'image/avif' || type === 'image/svg+xml';
    const format: 'jpg' | 'png' = alpha && hasTransparency(ctx, out) ? 'png' : 'jpg';
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, format === 'png' ? 'image/png' : 'image/jpeg', options.quality / 100));
    if (!blob) throw new PdfError(`"${item.name}" could not be encoded.`);
    return { bytes: await blob.arrayBuffer(), format, dims: out };
  } finally {
    if ('close' in bitmap) bitmap.close();
  }
}

/** Sample the alpha channel on a coarse grid; good enough to pick JPEG vs PNG. */
function hasTransparency(ctx: CanvasRenderingContext2D, size: Dimensions): boolean {
  const step = Math.max(1, Math.floor(Math.max(size.width, size.height) / 64));
  const w = Math.max(1, Math.floor(size.width / step));
  const h = Math.max(1, Math.floor(size.height / step));
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d');
  if (!tctx) return false;
  tctx.drawImage(ctx.canvas, 0, 0, w, h);
  const data = tctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return true;
  return false;
}

export interface Progress {
  done: number;
  total: number;
  label: string;
}

/** Build the output PDF from the item list in order. */
export async function buildPdf(items: readonly Item[], options: BuildOptions, onProgress?: (p: Progress) => void): Promise<Uint8Array> {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.setProducer('Cuisdev PDF Converter');
  doc.setCreator('cuisdev.com');
  if (options.title.trim()) doc.setTitle(options.title.trim());
  if (options.author.trim()) doc.setAuthor(options.author.trim());
  doc.setCreationDate(new Date());
  doc.setModificationDate(new Date());

  const total = items.length;
  let done = 0;
  for (const item of items) {
    onProgress?.({ done, total, label: item.name });
    if (item.error) throw new PdfError(`${item.name}: ${item.error}`);
    if (item.kind === 'image') {
      const emb = await toEmbeddable(item, options);
      const image = emb.format === 'png' ? await doc.embedPng(emb.bytes) : await doc.embedJpg(emb.bytes);
      const p = placeImage(emb.dims, options);
      const page = doc.addPage([p.page.width, p.page.height]);
      page.drawImage(image, { x: p.x, y: p.y, width: p.width, height: p.height });
    } else {
      const bytes = await item.file.arrayBuffer();
      let src;
      try {
        src = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      } catch {
        throw new PdfError(`"${item.name}" could not be read.`);
      }
      const indexes = parsePageRange(item.range, src.getPageCount());
      let pages;
      try {
        pages = await doc.copyPages(src, indexes);
      } catch {
        throw new PdfError(`"${item.name}" is encrypted or damaged, so its pages could not be copied.`);
      }
      for (const page of pages) doc.addPage(page);
    }
    done++;
    onProgress?.({ done, total, label: item.name });
  }
  if (doc.getPageCount() === 0) throw new PdfError('Nothing to write: the list produced no pages.');
  return doc.save({ useObjectStreams: true });
}

export function downloadBytes(bytes: Uint8Array, filename: string): string {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  return url;
}

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A small sample set so the tool can be tried without files: two images and a two-page PDF. */
export async function makeSamples(): Promise<File[]> {
  const image = (label: string, w: number, h: number, hue: number): Promise<File> =>
    new Promise((resolve, reject) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return reject(new PdfError('Canvas is not available.'));
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, `hsl(${hue} 70% 55%)`);
      g.addColorStop(1, `hsl(${hue + 40} 70% 35%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = `bold ${Math.round(w / 12)}px system-ui, sans-serif`;
      ctx.fillText(label, w * 0.06, h * 0.2);
      c.toBlob((b) => (b ? resolve(new File([b], `${label.toLowerCase().replace(/\s+/g, '-')}.jpg`, { type: 'image/jpeg' })) : reject(new PdfError('Could not create sample.'))), 'image/jpeg', 0.9);
    });
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Sample report, page ${i}`, { x: 60, y: 760, size: 24, font, color: rgb(0.15, 0.15, 0.2) });
    page.drawText('This PDF was generated in your browser to demonstrate merging.', { x: 60, y: 725, size: 12, font, color: rgb(0.35, 0.35, 0.4) });
    page.drawRectangle({ x: 60, y: 400, width: 475, height: 280, borderColor: rgb(0.6, 0.6, 0.7), borderWidth: 1 });
  }
  const pdfBytes = await doc.save();
  return [
    await image('Photo one', 1200, 800, 210),
    await image('Photo two', 800, 1200, 20),
    new File([pdfBytes as BlobPart], 'sample-report.pdf', { type: 'application/pdf' }),
  ];
}
