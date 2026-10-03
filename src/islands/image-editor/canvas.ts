/**
 * Image Editor: the DOM side. Decoding files into bitmaps, drawing the edit pipeline
 * onto canvases and encoding the result. Everything here runs in the browser only.
 */
import {
  ImageError,
  MAX_DIMENSION,
  filterString,
  orientedSize,
  type Dimensions,
  type EditState,
  type ExportOptions,
  type OutputType,
} from './logic';

export type Source = ImageBitmap | HTMLImageElement;

export interface Decoded {
  source: Source;
  size: Dimensions;
  /** The browser's detected MIME type, or '' for unknown. */
  type: string;
}

/** Decode a file, honouring EXIF orientation where the browser supports it. */
export async function decodeFile(file: Blob): Promise<Decoded> {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      if (bitmap.width > MAX_DIMENSION || bitmap.height > MAX_DIMENSION) {
        bitmap.close();
        throw new ImageError(`The image is larger than ${MAX_DIMENSION} pixels on one side, which browsers cannot edit on a canvas.`);
      }
      return { source: bitmap, size: { width: bitmap.width, height: bitmap.height }, type: file.type };
    } catch (err) {
      if (err instanceof ImageError) throw err;
      // fall through to the <img> path (e.g. SVG in some browsers)
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new ImageError('The file could not be decoded as an image. It may be corrupt or in a format this browser does not support.'));
      el.src = url;
    });
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    if (size.width < 1 || size.height < 1) throw new ImageError('The image reported an unusable size.');
    return { source: img, size, type: file.type };
  } finally {
    // Keep the object URL alive for HTMLImageElement sources; it is tiny and freed on unload.
  }
}

export function releaseSource(source: Source | null): void {
  if (source && 'close' in source) source.close();
}

function makeCanvas(size: Dimensions): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(size.width));
  c.height = Math.max(1, Math.round(size.height));
  return c;
}

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('Canvas 2D is not available in this browser.');
  return ctx;
}

/** Draw the source with rotation and flips applied. Returns a canvas of the oriented size. */
export function renderOriented(source: Source, size: Dimensions, state: Pick<EditState, 'rotation' | 'flipH' | 'flipV'>): HTMLCanvasElement {
  const out = orientedSize(size, state.rotation);
  const canvas = makeCanvas(out);
  const ctx = context(canvas);
  ctx.save();
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((state.rotation * Math.PI) / 2);
  ctx.scale(state.flipH ? -1 : 1, state.flipV ? -1 : 1);
  ctx.drawImage(source, -size.width / 2, -size.height / 2, size.width, size.height);
  ctx.restore();
  return canvas;
}

/**
 * Render the full pipeline to a canvas at the output size: orient, crop, resize and
 * adjust. Downscaling by more than 2x goes through intermediate halvings for quality.
 */
export function renderOutput(oriented: HTMLCanvasElement, state: EditState, background: string | null): HTMLCanvasElement {
  const { crop, resize } = state;
  let src: HTMLCanvasElement | ImageBitmap = oriented;
  let sx = crop.x;
  let sy = crop.y;
  let sw = crop.width;
  let sh = crop.height;

  // Progressive downscale for crisp results on big reductions
  while (sw / 2 > resize.width && sh / 2 > resize.height) {
    const step = makeCanvas({ width: Math.round(sw / 2), height: Math.round(sh / 2) });
    const sctx = context(step);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, sx, sy, sw, sh, 0, 0, step.width, step.height);
    src = step;
    sx = 0;
    sy = 0;
    sw = step.width;
    sh = step.height;
  }

  const canvas = makeCanvas(resize);
  const ctx = context(canvas);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const filter = filterString(state.adjust);
  if (filter && 'filter' in ctx) ctx.filter = filter;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if ('filter' in ctx) ctx.filter = 'none';
  return canvas;
}

export function supportsCanvasFilter(): boolean {
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    return !!ctx && 'filter' in ctx;
  } catch {
    return false;
  }
}

/** Encode a canvas. Falls back to PNG when the browser cannot write the requested type. */
export function encode(canvas: HTMLCanvasElement, options: ExportOptions): Promise<{ blob: Blob; type: OutputType }> {
  return new Promise((resolve, reject) => {
    const lossy = options.type !== 'image/png';
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new ImageError('The browser could not encode the image. Try a smaller size or PNG.'));
          return;
        }
        resolve({ blob, type: blob.type === options.type ? options.type : 'image/png' });
      },
      options.type,
      lossy ? options.quality / 100 : undefined,
    );
  });
}

export function canEncode(type: OutputType): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    return c.toDataURL(type).startsWith(`data:${type}`);
  } catch {
    return false;
  }
}

/** A sample photo-like image generated on the fly so the tool can be tried without a file. */
export function makeSample(): Promise<File> {
  const w = 1600;
  const h = 1000;
  const canvas = makeCanvas({ width: w, height: h });
  const ctx = context(canvas);
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.65);
  sky.addColorStop(0, '#2b4a8f');
  sky.addColorStop(0.6, '#e98a6b');
  sky.addColorStop(1, '#f7c87b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  // sun
  const sun = ctx.createRadialGradient(w * 0.68, h * 0.55, 10, w * 0.68, h * 0.55, 160);
  sun.addColorStop(0, '#fff4d6');
  sun.addColorStop(0.4, '#ffd57a');
  sun.addColorStop(1, 'rgba(255,213,122,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, w, h);
  // hills
  const hills = ['#3c5a3f', '#2f4a33', '#223827'];
  hills.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    const base = h * (0.62 + i * 0.1);
    for (let x = 0; x <= w; x += 40) {
      const y = base + Math.sin(x / (180 + i * 60) + i) * 40 + Math.cos(x / 70) * 12;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  });
  // water
  const water = ctx.createLinearGradient(0, h * 0.78, 0, h);
  water.addColorStop(0, 'rgba(60,90,140,0.9)');
  water.addColorStop(1, 'rgba(20,30,60,1)');
  ctx.fillStyle = water;
  ctx.fillRect(0, h * 0.8, w, h * 0.2);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(255,220,150,${0.08 + Math.random() * 0.12})`;
    ctx.fillRect(w * 0.55 + Math.random() * 300, h * 0.81 + i * 4.5, 40 + Math.random() * 120, 2);
  }
  // birds
  ctx.strokeStyle = 'rgba(30,30,40,0.8)';
  ctx.lineWidth = 3;
  [[300, 220], [340, 200], [380, 240], [1200, 180], [1250, 160]].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x - 12, y, 12, Math.PI * 1.1, Math.PI * 1.9);
    ctx.arc(x + 12, y, 12, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
  });
  // caption
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 42px system-ui, sans-serif';
  ctx.fillText('Cuisdev sample', 48, 72);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new ImageError('Could not create the sample image.'));
      else resolve(new File([blob], 'sunset-sample.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  });
}

/** Copy a canvas to the clipboard as PNG. Returns false when the browser blocks it. */
export async function copyCanvas(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    if (!('ClipboardItem' in window) || !navigator.clipboard?.write) return false;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
