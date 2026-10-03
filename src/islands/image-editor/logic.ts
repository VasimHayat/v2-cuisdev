/**
 * Image Editor: pure geometry, naming and state helpers. No DOM. Decoding, drawing
 * and encoding live in canvas.ts so this module can be unit-tested.
 *
 * The editor is non-destructive: an EditState describes every operation applied to the
 * original bitmap (orientation, crop, resize, adjustments) and the output is rendered
 * from the original each time. Undo and redo are a stack of EditStates.
 */

export class ImageError extends Error {
  override name = 'ImageError';
}

/** Hard ceiling for a single input file. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** Largest edge a canvas is asked to allocate. */
export const MAX_DIMENSION = 16384;

export interface Dimensions {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Quarter turns clockwise, 0 to 3. */
export type Rotation = 0 | 1 | 2 | 3;

export interface Adjustments {
  /** Percent, 100 = unchanged. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** 0 to 100 */
  grayscale: number;
  sepia: number;
  /** Pixels, 0 to 20 */
  blur: number;
  /** Degrees, -180 to 180 */
  hue: number;
}

export interface EditState {
  rotation: Rotation;
  flipH: boolean;
  flipV: boolean;
  /** In oriented-image pixels (after rotation and flips). */
  crop: Rect;
  /** Output size; defaults to the crop size. */
  resize: Dimensions;
  adjust: Adjustments;
}

export type OutputType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ExportOptions {
  type: OutputType;
  /** 1 to 100, lossy formats only. */
  quality: number;
  /** Hex colour painted under transparent pixels for JPEG. */
  background: string;
}

export const DEFAULT_ADJUST: Adjustments = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0, sepia: 0, blur: 0, hue: 0 };

export const ADJUSTMENT_RANGES: Record<keyof Adjustments, { min: number; max: number; step: number; label: string; unit: string }> = {
  brightness: { min: 0, max: 200, step: 1, label: 'Brightness', unit: '%' },
  contrast: { min: 0, max: 200, step: 1, label: 'Contrast', unit: '%' },
  saturation: { min: 0, max: 200, step: 1, label: 'Saturation', unit: '%' },
  hue: { min: -180, max: 180, step: 1, label: 'Hue', unit: '°' },
  grayscale: { min: 0, max: 100, step: 1, label: 'Grayscale', unit: '%' },
  sepia: { min: 0, max: 100, step: 1, label: 'Sepia', unit: '%' },
  blur: { min: 0, max: 20, step: 0.5, label: 'Blur', unit: 'px' },
};

export interface AspectPreset {
  id: string;
  label: string;
  /** width / height, or null for free. */
  ratio: number | null;
}

export const ASPECTS: readonly AspectPreset[] = [
  { id: 'free', label: 'Free', ratio: null },
  { id: 'original', label: 'Original', ratio: -1 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
];

export interface SizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const SIZE_PRESETS: readonly SizePreset[] = [
  { id: '1920x1080', label: 'Full HD 1920 × 1080', width: 1920, height: 1080 },
  { id: '1280x720', label: 'HD 1280 × 720', width: 1280, height: 720 },
  { id: '1080x1080', label: 'Square post 1080 × 1080', width: 1080, height: 1080 },
  { id: '1080x1350', label: 'Portrait post 1080 × 1350', width: 1080, height: 1350 },
  { id: '1200x630', label: 'Open Graph 1200 × 630', width: 1200, height: 630 },
  { id: '1500x500', label: 'X header 1500 × 500', width: 1500, height: 500 },
  { id: '512x512', label: 'App icon 512 × 512', width: 512, height: 512 },
  { id: '256x256', label: 'Icon 256 × 256', width: 256, height: 256 },
];

export const OUTPUT_TYPES: { type: OutputType; label: string; lossy: boolean }[] = [
  { type: 'image/png', label: 'PNG', lossy: false },
  { type: 'image/jpeg', label: 'JPG', lossy: true },
  { type: 'image/webp', label: 'WebP', lossy: true },
];

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'webp', 'gif', 'bmp', 'ico', 'avif', 'svg', 'heic', 'heif', 'tif', 'tiff']);

export interface FileLike {
  name: string;
  type: string;
  size: number;
}

// --- files -------------------------------------------------------------------

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 1 ? '' : name.slice(dot + 1).toLowerCase();
}

export function baseName(name: string): string {
  const withoutPath = name.split(/[/\\]/).pop() ?? '';
  const dot = withoutPath.lastIndexOf('.');
  const stem = dot < 1 ? withoutPath : withoutPath.slice(0, dot);
  return stem.trim() === '' ? 'image' : stem.trim();
}

export function extensionFor(mime: string): string {
  return EXTENSIONS[mime] ?? 'png';
}

export function isImageFile(file: Pick<FileLike, 'name' | 'type'>): boolean {
  if (file.type.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(fileExtension(file.name));
}

export function assertUsableFile(file: FileLike): void {
  if (!isImageFile(file)) throw new ImageError(`"${file.name}" is not an image. Open a PNG, JPEG, WebP, GIF, BMP or AVIF file.`);
  if (file.size === 0) throw new ImageError(`"${file.name}" is empty.`);
  if (file.size > MAX_FILE_BYTES) throw new ImageError(`"${file.name}" is ${formatBytes(file.size)}, larger than the ${formatBytes(MAX_FILE_BYTES)} limit.`);
}

/** `photo.jpg` edited to 800 × 450 and exported as WebP → `photo-800x450.webp`. */
export function outputFileName(originalName: string, size: Dimensions, type: OutputType): string {
  return `${baseName(originalName)}-${size.width}x${size.height}.${extensionFor(type)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDimensions(size: Dimensions): string {
  return `${size.width} × ${size.height}`;
}

// --- numbers -----------------------------------------------------------------

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function parseDimension(raw: string | number, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 1) return fallback;
  return clampInt(n, 1, MAX_DIMENSION);
}

export function normalizeHex(value: string, fallback = '#ffffff'): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
  return fallback;
}

// --- geometry ----------------------------------------------------------------

export function aspectOf(size: Dimensions): number {
  return size.width / size.height;
}

/** Size of the image after `rotation` quarter turns. */
export function orientedSize(source: Dimensions, rotation: Rotation): Dimensions {
  return rotation % 2 === 0 ? { ...source } : { width: source.height, height: source.width };
}

export function fullRect(size: Dimensions): Rect {
  return { x: 0, y: 0, width: size.width, height: size.height };
}

export function isFullRect(rect: Rect, size: Dimensions): boolean {
  return rect.x === 0 && rect.y === 0 && rect.width === size.width && rect.height === size.height;
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** The largest rectangle of `ratio` (w/h) that fits, centred on the image. */
export function centeredCrop(size: Dimensions, ratio: number | null): Rect {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return fullRect(size);
  let width = size.width;
  let height = size.height;
  if (aspectOf(size) > ratio) width = Math.round(size.height * ratio);
  else height = Math.round(size.width / ratio);
  width = Math.min(size.width, Math.max(1, width));
  height = Math.min(size.height, Math.max(1, height));
  return { x: Math.round((size.width - width) / 2), y: Math.round((size.height - height) / 2), width, height };
}

/** Keep a rect inside the image with at least 1 × 1 pixel, rounding to whole pixels. */
export function clampRect(rect: Rect, size: Dimensions): Rect {
  const width = clampInt(rect.width, 1, size.width);
  const height = clampInt(rect.height, 1, size.height);
  const x = clampInt(rect.x, 0, size.width - width);
  const y = clampInt(rect.y, 0, size.height - height);
  return { x, y, width, height };
}

/** Where a crop rectangle ends up after the image turns a quarter clockwise. */
export function rotateRectCw(rect: Rect, size: Dimensions): Rect {
  // size is the image size before rotation
  return { x: size.height - rect.y - rect.height, y: rect.x, width: rect.height, height: rect.width };
}

export function rotateRectCcw(rect: Rect, size: Dimensions): Rect {
  return { x: rect.y, y: size.width - rect.x - rect.width, width: rect.height, height: rect.width };
}

export function flipRectH(rect: Rect, size: Dimensions): Rect {
  return { ...rect, x: size.width - rect.x - rect.width };
}

export function flipRectV(rect: Rect, size: Dimensions): Rect {
  return { ...rect, y: size.height - rect.y - rect.height };
}

/** Change one edge of a size and derive the other from `ratio` (w/h). */
export function matchAspect(size: Dimensions, ratio: number, changed: 'width' | 'height'): Dimensions {
  if (!Number.isFinite(ratio) || ratio <= 0) return size;
  if (changed === 'width') return { width: size.width, height: Math.max(1, Math.round(size.width / ratio)) };
  return { width: Math.max(1, Math.round(size.height * ratio)), height: size.height };
}

export function scaleByPercent(size: Dimensions, percent: number): Dimensions {
  return {
    width: clampInt((size.width * percent) / 100, 1, MAX_DIMENSION),
    height: clampInt((size.height * percent) / 100, 1, MAX_DIMENSION),
  };
}

/** Fit `size` inside `box` without upscaling beyond `maxScale`. */
export function fitScale(size: Dimensions, box: Dimensions, maxScale = 1): number {
  if (size.width < 1 || size.height < 1 || box.width < 1 || box.height < 1) return 1;
  return Math.min(maxScale, box.width / size.width, box.height / size.height);
}

export type HandleId = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

/**
 * Apply a pointer drag (dx, dy in image pixels) from `start` for a given handle, keeping
 * the result inside the image and optionally locked to `ratio` (w/h).
 */
export function dragRect(start: Rect, handle: HandleId, dx: number, dy: number, size: Dimensions, ratio: number | null, minSize = 8): Rect {
  if (handle === 'move') {
    return clampRect({ ...start, x: start.x + dx, y: start.y + dy }, size);
  }
  let x1 = start.x;
  let y1 = start.y;
  let x2 = start.x + start.width;
  let y2 = start.y + start.height;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if (west) x1 = Math.min(x2 - minSize, Math.max(0, x1 + dx));
  if (east) x2 = Math.max(x1 + minSize, Math.min(size.width, x2 + dx));
  if (north) y1 = Math.min(y2 - minSize, Math.max(0, y1 + dy));
  if (south) y2 = Math.max(y1 + minSize, Math.min(size.height, y2 + dy));

  if (ratio && ratio > 0) {
    let w = x2 - x1;
    let h = y2 - y1;
    const horizontalOnly = (west || east) && !(north || south);
    const verticalOnly = (north || south) && !(west || east);
    if (horizontalOnly) h = w / ratio;
    else if (verticalOnly) w = h * ratio;
    else if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    // Anchor the opposite corner/edge.
    if (west) x1 = x2 - w;
    else x2 = x1 + w;
    if (north) y1 = y2 - h;
    else y2 = y1 + h;
    if (horizontalOnly || verticalOnly) {
      // Centre the derived edge on the original centre line.
      if (horizontalOnly) {
        const cy = start.y + start.height / 2;
        y1 = cy - h / 2;
        y2 = cy + h / 2;
      } else {
        const cx = start.x + start.width / 2;
        x1 = cx - w / 2;
        x2 = cx + w / 2;
      }
    }
    // If the locked rect spills outside, shrink it back toward the anchor.
    const overflowX = Math.max(0, -x1) + Math.max(0, x2 - size.width);
    const overflowY = Math.max(0, -y1) + Math.max(0, y2 - size.height);
    if (overflowX > 0 || overflowY > 0) {
      const scale = Math.min((w - overflowX) / w, (h - overflowY) / h);
      const nw = Math.max(minSize, w * scale);
      const nh = nw / ratio;
      if (west) x1 = x2 - nw;
      else x2 = x1 + nw;
      if (north) y1 = y2 - nh;
      else y2 = y1 + nh;
      if (horizontalOnly || verticalOnly) {
        const cx = (x1 + x2) / 2;
        const cy = (y1 + y2) / 2;
        x1 = cx - nw / 2;
        x2 = cx + nw / 2;
        y1 = cy - nh / 2;
        y2 = cy + nh / 2;
      }
    }
  }
  return clampRect({ x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, size);
}

// --- state -------------------------------------------------------------------

export function initialState(source: Dimensions): EditState {
  return { rotation: 0, flipH: false, flipV: false, crop: fullRect(source), resize: { ...source }, adjust: { ...DEFAULT_ADJUST } };
}

export function isDefaultAdjust(a: Adjustments): boolean {
  return (Object.keys(DEFAULT_ADJUST) as (keyof Adjustments)[]).every((k) => a[k] === DEFAULT_ADJUST[k]);
}

export function isIdentity(state: EditState, source: Dimensions): boolean {
  return (
    state.rotation === 0 &&
    !state.flipH &&
    !state.flipV &&
    isFullRect(state.crop, source) &&
    state.resize.width === source.width &&
    state.resize.height === source.height &&
    isDefaultAdjust(state.adjust)
  );
}

/** Whether the resize still simply follows the crop size. */
export function resizeFollowsCrop(state: EditState): boolean {
  return state.resize.width === state.crop.width && state.resize.height === state.crop.height;
}

/** Rotate the whole state a quarter turn clockwise (crop follows the image). */
export function rotateState(state: EditState, source: Dimensions, direction: 'cw' | 'ccw'): EditState {
  const before = orientedSize(source, state.rotation);
  const rotation = (((state.rotation + (direction === 'cw' ? 1 : 3)) % 4) + 4) % 4 as Rotation;
  const crop = direction === 'cw' ? rotateRectCw(state.crop, before) : rotateRectCcw(state.crop, before);
  const follows = resizeFollowsCrop(state);
  const resize = follows ? { width: crop.width, height: crop.height } : { width: state.resize.height, height: state.resize.width };
  return { ...state, rotation, crop, resize };
}

export function flipState(state: EditState, source: Dimensions, axis: 'h' | 'v'): EditState {
  const size = orientedSize(source, state.rotation);
  if (axis === 'h') return { ...state, flipH: !state.flipH, crop: flipRectH(state.crop, size) };
  return { ...state, flipV: !state.flipV, crop: flipRectV(state.crop, size) };
}

export function withCrop(state: EditState, crop: Rect): EditState {
  const follows = resizeFollowsCrop(state);
  return { ...state, crop, resize: follows ? { width: crop.width, height: crop.height } : state.resize };
}

/** CSS filter string for the adjustments, or '' when everything is default. */
export function filterString(a: Adjustments): string {
  const parts: string[] = [];
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
  if (a.saturation !== 100) parts.push(`saturate(${a.saturation}%)`);
  if (a.hue !== 0) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.grayscale !== 0) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.sepia !== 0) parts.push(`sepia(${a.sepia}%)`);
  if (a.blur !== 0) parts.push(`blur(${a.blur}px)`);
  return parts.join(' ');
}

/** Summary for the status bar, e.g. "rotated 90°, cropped, 800 × 600, 3 adjustments". */
export function describeState(state: EditState, source: Dimensions): string {
  const parts: string[] = [];
  if (state.rotation) parts.push(`rotated ${state.rotation * 90}°`);
  if (state.flipH) parts.push('flipped horizontally');
  if (state.flipV) parts.push('flipped vertically');
  if (!isFullRect(state.crop, orientedSize(source, state.rotation))) parts.push(`cropped to ${formatDimensions(state.crop)}`);
  if (!resizeFollowsCrop(state)) parts.push(`resized to ${formatDimensions(state.resize)}`);
  const n = (Object.keys(DEFAULT_ADJUST) as (keyof Adjustments)[]).filter((k) => state.adjust[k] !== DEFAULT_ADJUST[k]).length;
  if (n) parts.push(`${n} adjustment${n === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'no edits yet';
}
