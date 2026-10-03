/**
 * Batch image processing: pure settings, geometry, naming and search helpers, no DOM.
 * One pipeline per file: decode, optional resize, encode. The three pages (compress,
 * convert, resize) share the pipeline and differ only in which section is enabled first.
 */
import { SIZE_PRESETS, baseName, formatBytes, normalizeHex, type Dimensions } from '../image-editor/logic';

export type Kind = 'compress' | 'convert' | 'resize';
export type Mime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif';
export type ResizeMode = 'width' | 'height' | 'both' | 'percent' | 'longest' | 'preset';
export type Fit = 'contain' | 'cover' | 'stretch';

export interface Settings {
  compress: boolean;
  convert: boolean;
  resize: boolean;
  /** Compress section */
  sizeMode: 'quality' | 'target';
  quality: number;
  targetKB: number;
  compressFormat: 'keep' | 'image/jpeg' | 'image/webp';
  /** Convert section */
  convertTo: Mime;
  convertQuality: number;
  background: string;
  /** Resize section */
  resizeMode: ResizeMode;
  width: number;
  height: number;
  fit: Fit;
  percent: number;
  longest: number;
  preset: string;
  noUpscale: boolean;
}

export const MAX_FILES = 100;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const BASE: Settings = {
  compress: false,
  convert: false,
  resize: false,
  sizeMode: 'quality',
  quality: 75,
  targetKB: 200,
  compressFormat: 'keep',
  convertTo: 'image/webp',
  convertQuality: 90,
  background: '#ffffff',
  resizeMode: 'width',
  width: 1200,
  height: 800,
  fit: 'contain',
  percent: 50,
  longest: 1600,
  preset: SIZE_PRESETS[0]?.id ?? '1920x1080',
  noUpscale: true,
};

export function defaultSettings(kind: Kind): Settings {
  return { ...BASE, compress: kind === 'compress', convert: kind === 'convert', resize: kind === 'resize' };
}

const MIMES: readonly Mime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

/** Validate stored settings, falling back to the kind's defaults field by field. */
export function sanitizeSettings(raw: unknown, kind: Kind): Settings {
  const d = defaultSettings(kind);
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Record<keyof Settings, unknown>>;
  const num = (v: unknown, min: number, max: number, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fb);
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb);
  return {
    compress: bool(r.compress, d.compress),
    convert: bool(r.convert, d.convert),
    resize: bool(r.resize, d.resize),
    sizeMode: pick(r.sizeMode, ['quality', 'target'] as const, d.sizeMode),
    quality: num(r.quality, 1, 100, d.quality),
    targetKB: num(r.targetKB, 1, 100_000, d.targetKB),
    compressFormat: pick(r.compressFormat, ['keep', 'image/jpeg', 'image/webp'] as const, d.compressFormat),
    convertTo: pick(r.convertTo, MIMES, d.convertTo),
    convertQuality: num(r.convertQuality, 1, 100, d.convertQuality),
    background: typeof r.background === 'string' ? normalizeHex(r.background, d.background) : d.background,
    resizeMode: pick(r.resizeMode, ['width', 'height', 'both', 'percent', 'longest', 'preset'] as const, d.resizeMode),
    width: num(r.width, 1, 16384, d.width),
    height: num(r.height, 1, 16384, d.height),
    fit: pick(r.fit, ['contain', 'cover', 'stretch'] as const, d.fit),
    percent: num(r.percent, 1, 500, d.percent),
    longest: num(r.longest, 1, 16384, d.longest),
    preset: typeof r.preset === 'string' && SIZE_PRESETS.some((p) => p.id === r.preset) ? r.preset : d.preset,
    noUpscale: bool(r.noUpscale, d.noUpscale),
  };
}

// --- formats -----------------------------------------------------------------

export function isLossy(mime: string): boolean {
  return mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/avif';
}

export function hasAlpha(mime: string): boolean {
  return mime !== 'image/jpeg';
}

export const FORMAT_LABELS: Record<Mime, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP', 'image/avif': 'AVIF' };

const EXT: Record<Mime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' };

/**
 * Output type for a source type. Convert wins over compress; compress may force JPEG
 * or WebP; otherwise the source format is kept when the browser can write it, and
 * anything else (GIF, BMP, AVIF without encoder, SVG) becomes PNG.
 */
export function resolveFormat(sourceType: string, s: Settings, canWrite: (m: Mime) => boolean = () => true): Mime {
  if (s.convert && canWrite(s.convertTo)) return s.convertTo;
  if (s.compress && s.compressFormat !== 'keep') return s.compressFormat;
  const src = sourceType === 'image/jpg' ? 'image/jpeg' : sourceType;
  if (MIMES.includes(src as Mime) && canWrite(src as Mime)) return src as Mime;
  return 'image/png';
}

/** Quality used for a lossy encode when no target size is set. */
export function resolveQuality(s: Settings): number {
  if (s.compress) return s.quality;
  if (s.convert) return s.convertQuality;
  return 90;
}

export function wantsTargetSize(s: Settings, mime: Mime): boolean {
  return s.compress && s.sizeMode === 'target' && isLossy(mime);
}

// --- geometry ----------------------------------------------------------------

export interface DrawPlan {
  width: number;
  height: number;
  /** Source rectangle to draw (cover crops it). */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Output size and source crop for one image under the resize settings. */
export function planResize(src: Dimensions, s: Settings): DrawPlan {
  const full = { sx: 0, sy: 0, sw: src.width, sh: src.height };
  if (!s.resize) return { width: src.width, height: src.height, ...full };
  const ratio = src.width / src.height;
  let w = src.width;
  let h = src.height;
  let box: Dimensions | null = null;
  switch (s.resizeMode) {
    case 'width':
      w = s.width;
      h = w / ratio;
      break;
    case 'height':
      h = s.height;
      w = h * ratio;
      break;
    case 'percent':
      w = (src.width * s.percent) / 100;
      h = (src.height * s.percent) / 100;
      break;
    case 'longest': {
      const scale = s.longest / Math.max(src.width, src.height);
      w = src.width * scale;
      h = src.height * scale;
      break;
    }
    case 'preset': {
      const p = SIZE_PRESETS.find((x) => x.id === s.preset) ?? SIZE_PRESETS[0]!;
      box = { width: p.width, height: p.height };
      break;
    }
    default:
      box = { width: s.width, height: s.height };
  }
  if (box) {
    if (s.fit === 'stretch') {
      w = box.width;
      h = box.height;
    } else if (s.fit === 'contain') {
      const scale = Math.min(box.width / src.width, box.height / src.height);
      w = src.width * scale;
      h = src.height * scale;
    } else {
      // cover: output is exactly the box, crop the source centred to the box ratio
      const target = box.width / box.height;
      let sw = src.width;
      let sh = src.height;
      if (ratio > target) sw = src.height * target;
      else sh = src.width / target;
      const plan = { width: box.width, height: box.height, sx: (src.width - sw) / 2, sy: (src.height - sh) / 2, sw, sh };
      if (s.noUpscale && (box.width > sw || box.height > sh)) {
        const k = Math.min(sw / box.width, sh / box.height);
        return { ...plan, width: Math.max(1, Math.round(box.width * k)), height: Math.max(1, Math.round(box.height * k)) };
      }
      return { ...plan, width: Math.round(plan.width), height: Math.round(plan.height) };
    }
  }
  if (s.noUpscale && (w > src.width || h > src.height)) {
    const k = Math.min(src.width / w, src.height / h);
    w *= k;
    h *= k;
  }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)), ...full };
}

// --- target-size search ------------------------------------------------------

export interface SearchResult<T> {
  quality: number;
  size: number;
  value: T;
  /** False when even the lowest quality was larger than the target. */
  met: boolean;
}

/**
 * Binary-search the highest quality whose encoded size fits `targetBytes`. `encodeAt`
 * returns the encoded size and a payload (the blob). Uses at most `steps` encodes.
 */
export async function searchQuality<T>(targetBytes: number, encodeAt: (q: number) => Promise<{ size: number; value: T }>, opts: { min?: number; max?: number; steps?: number } = {}): Promise<SearchResult<T>> {
  let lo = opts.min ?? 5;
  let hi = opts.max ?? 95;
  const steps = opts.steps ?? 7;
  let best: SearchResult<T> | null = null;
  let smallest: SearchResult<T> | null = null;
  for (let i = 0; i < steps && lo <= hi; i++) {
    const q = Math.round((lo + hi) / 2);
    const r = await encodeAt(q);
    const cand = { quality: q, size: r.size, value: r.value, met: r.size <= targetBytes };
    if (!smallest || r.size < smallest.size) smallest = cand;
    if (cand.met) {
      if (!best || q > best.quality) best = cand;
      lo = q + 1;
    } else hi = q - 1;
  }
  if (best) return best;
  const floor = await encodeAt(opts.min ?? 5);
  const atMin = { quality: opts.min ?? 5, size: floor.size, value: floor.value, met: floor.size <= targetBytes };
  return smallest && smallest.size < atMin.size ? smallest : atMin;
}

// --- naming and stats --------------------------------------------------------

/** photo.png converted to WebP and resized to 800 x 600 -> photo-800x600.webp */
export function outputName(original: string, mime: Mime, size: Dimensions | null): string {
  const stem = baseName(original);
  return size ? `${stem}-${size.width}x${size.height}.${EXT[mime]}` : `${stem}.${EXT[mime]}`;
}

/** Positive when the output is smaller, rounded to one decimal. */
export function savingsPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 1000) / 10;
}

export interface Totals {
  files: number;
  done: number;
  before: number;
  after: number;
  saved: number;
}

export function totals(items: readonly { size: number; resultSize?: number }[]): Totals {
  const done = items.filter((i) => i.resultSize !== undefined);
  const before = done.reduce((n, i) => n + i.size, 0);
  const after = done.reduce((n, i) => n + (i.resultSize ?? 0), 0);
  return { files: items.length, done: done.length, before, after, saved: savingsPercent(before, after) };
}

export function describeTotals(t: Totals): string {
  if (t.files === 0) return 'No files yet';
  if (t.done === 0) return `${t.files} file${t.files === 1 ? '' : 's'} queued`;
  const change = t.saved >= 0 ? `saved ${t.saved}%` : `grew ${Math.abs(t.saved)}%`;
  return `${t.done} of ${t.files} done · ${formatBytes(t.before)} → ${formatBytes(t.after)} · ${change}`;
}

/** Stable key of everything that affects the output, to skip files already processed. */
export function settingsKey(s: Settings): string {
  return JSON.stringify(s);
}
