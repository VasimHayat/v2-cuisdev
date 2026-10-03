/**
 * The DOM side of the batch pipeline: decode a file, draw it at the planned size with
 * progressive downscaling, and encode it, searching quality when a target size is set.
 */
import { decodeFile, releaseSource, type Source } from '../image-editor/canvas';
import { ImageError, type Dimensions } from '../image-editor/logic';
import { hasAlpha, isLossy, planResize, resolveFormat, resolveQuality, searchQuality, wantsTargetSize, type DrawPlan, type Mime, type Settings } from './logic';

export interface Processed {
  blob: Blob;
  type: Mime;
  width: number;
  height: number;
  /** Quality actually used for lossy formats. */
  quality: number | null;
  /** Target size mode only: false when the target could not be reached. */
  targetMet: boolean | null;
}

const writable = new Map<Mime, boolean>();

/** Whether this browser's canvas can write a format (AVIF is missing in some). */
export function canWrite(mime: Mime): boolean {
  const known = writable.get(mime);
  if (known !== undefined) return known;
  let ok = false;
  try {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    ok = c.toDataURL(mime).startsWith(`data:${mime}`);
  } catch {
    ok = false;
  }
  writable.set(mime, ok);
  return ok;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new ImageError('Canvas 2D is not available in this browser.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return ctx;
}

/** Draw the planned crop at the planned size, halving first for big reductions. */
export function draw(source: Source, plan: DrawPlan, background: string | null): HTMLCanvasElement {
  let src: CanvasImageSource = source;
  let { sx, sy, sw, sh } = plan;
  while (sw / 2 > plan.width && sh / 2 > plan.height) {
    const step = makeCanvas(sw / 2, sh / 2);
    ctx2d(step).drawImage(src, sx, sy, sw, sh, 0, 0, step.width, step.height);
    src = step;
    sx = 0;
    sy = 0;
    sw = step.width;
    sh = step.height;
  }
  const out = makeCanvas(plan.width, plan.height);
  const ctx = ctx2d(out);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}

function toBlob(canvas: HTMLCanvasElement, type: Mime, quality: number | null): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ImageError('The browser could not encode this image. Try a smaller size or another format.'))),
      type,
      quality === null ? undefined : quality / 100,
    ),
  );
}

export async function processFile(file: File, s: Settings): Promise<Processed & { source: Dimensions }> {
  const decoded = await decodeFile(file);
  try {
    const type = resolveFormat(file.type, s, canWrite);
    const plan = planResize(decoded.size, s);
    const canvas = draw(decoded.source, plan, hasAlpha(type) ? null : s.background);
    let blob: Blob;
    let quality: number | null = null;
    let targetMet: boolean | null = null;
    if (wantsTargetSize(s, type)) {
      const r = await searchQuality(s.targetKB * 1024, async (q) => {
        const b = await toBlob(canvas, type, q);
        return { size: b.size, value: b };
      });
      blob = r.value;
      quality = r.quality;
      targetMet = r.met;
    } else {
      quality = isLossy(type) ? resolveQuality(s) : null;
      blob = await toBlob(canvas, type, quality);
    }
    // toBlob silently falls back to PNG for unsupported types
    const actual = (blob.type || type) as Mime;
    return { blob, type: actual, width: canvas.width, height: canvas.height, quality: isLossy(actual) ? quality : null, targetMet, source: decoded.size };
  } finally {
    releaseSource(decoded.source);
  }
}
