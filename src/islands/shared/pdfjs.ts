/**
 * Lazy pdf.js loader shared by the PDF islands. pdf.js and its worker are only
 * downloaded the first time a PDF has to be rendered; the worker runs off the main
 * thread. Use `loadPdf` to open a document and `renderPage` to draw a page.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfJs> | undefined;

export function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= (async () => {
    const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return pdfjsPromise;
}

export class PdfOpenError extends Error {
  override name = 'PdfOpenError';
}

/** Open a PDF from bytes. Throws PdfOpenError with a readable reason. */
export async function loadPdf(data: ArrayBuffer | Uint8Array, password?: string): Promise<PDFDocumentProxy> {
  const lib = await loadPdfJs();
  // pdf.js transfers the buffer to its worker, so hand it a copy the caller can keep using.
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  try {
    return await lib.getDocument({ data: bytes, password }).promise;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? '';
    if (name === 'PasswordException') throw new PdfOpenError(password ? 'The password is not correct.' : 'This PDF is password protected.');
    if (name === 'InvalidPDFException') throw new PdfOpenError('This file is not a valid PDF.');
    throw new PdfOpenError(err instanceof Error ? err.message : 'The PDF could not be opened.');
  }
}

export interface RenderOptions {
  /** Pixels per PDF point. 1 = 72 dpi, 2 = 144 dpi. */
  scale: number;
  /** Paint this colour first (PDF pages are transparent). Default white. */
  background?: string;
  /** Extra rotation in degrees on top of the page's own rotation. */
  rotation?: number;
}

/** Render one page (1-based) to a new canvas. */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, options: RenderOptions): Promise<HTMLCanvasElement> {
  const page: PDFPageProxy = await doc.getPage(pageNumber);
  const viewport = page.getViewport({ scale: options.scale, rotation: (page.rotate + (options.rotation ?? 0)) % 360 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PdfOpenError('Canvas is not available in this browser.');
  ctx.fillStyle = options.background ?? '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  page.cleanup();
  return canvas;
}

/** Small thumbnail as an object URL, about `width` pixels wide. Revoke it when done. */
export async function renderThumbnail(doc: PDFDocumentProxy, pageNumber: number, width = 160, rotation = 0): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
  const canvas = await renderPage(doc, pageNumber, { scale: width / base.width, rotation });
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
  return blob ? URL.createObjectURL(blob) : '';
}

/** Page size in PDF points (after the page's own rotation). */
export async function pageSize(doc: PDFDocumentProxy, pageNumber: number): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}
