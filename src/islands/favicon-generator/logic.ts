/**
 * Favicon Generator: pure helpers, no DOM. The output set, the ICO container writer,
 * the web manifest, the HTML snippet and the geometry for padding and rounded corners.
 * Drawing and PNG encoding live in the island.
 */

export type SourceKind = 'image' | 'text';

export interface FaviconOptions {
  source: SourceKind;
  /** Text mode: letters or an emoji. */
  text: string;
  font: string;
  textColor: string;
  /** Background colour for text mode and for opaque outputs. */
  background: string;
  /** Transparent background where the format allows it (image mode and the PNG/ICO sizes). */
  transparent: boolean;
  /** Padding as a percentage of the icon size, 0 to 30. */
  padding: number;
  /** Corner radius as a percentage of the icon size, 0 (square) to 50 (circle). */
  radius: number;
  themeColor: string;
  appName: string;
  shortName: string;
  /** Path the files will be served from, e.g. "/" or "/assets/". */
  basePath: string;
}

export const DEFAULT_OPTIONS: FaviconOptions = {
  source: 'text',
  text: 'C',
  font: 'system-ui',
  textColor: '#ffffff',
  background: '#4f46e5',
  transparent: false,
  padding: 8,
  radius: 22,
  themeColor: '#4f46e5',
  appName: 'My Website',
  shortName: 'Website',
  basePath: '/',
};

export const FONTS: { id: string; label: string; css: string }[] = [
  { id: 'system-ui', label: 'System sans', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'serif', label: 'Serif', css: 'Georgia, "Times New Roman", serif' },
  { id: 'mono', label: 'Monospace', css: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  { id: 'rounded', label: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif' },
  { id: 'emoji', label: 'Emoji', css: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif' },
];

export function fontCss(id: string): string {
  return FONTS.find((f) => f.id === id)?.css ?? FONTS[0]!.css;
}

export interface OutputSpec {
  name: string;
  size: number;
  /** Opaque outputs always get the background colour (iOS ignores transparency). */
  opaque: boolean;
  purpose: string;
}

/** Every PNG produced, in display order. The ICO is built from the 16, 32 and 48 px renders. */
export const PNG_OUTPUTS: readonly OutputSpec[] = [
  { name: 'favicon-16x16.png', size: 16, opaque: false, purpose: 'Browser tab' },
  { name: 'favicon-32x32.png', size: 32, opaque: false, purpose: 'Browser tab on high-DPI screens' },
  { name: 'apple-touch-icon.png', size: 180, opaque: true, purpose: 'iPhone and iPad home screen' },
  { name: 'android-chrome-192x192.png', size: 192, opaque: false, purpose: 'Android home screen' },
  { name: 'android-chrome-512x512.png', size: 512, opaque: false, purpose: 'Android splash screen and PWA' },
];

export const ICO_SIZES = [16, 32, 48] as const;

// --- colours -------------------------------------------------------------------

export function normalizeHex(value: string, fallback = '#000000'): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
  return fallback;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// --- geometry ------------------------------------------------------------------

export interface IconLayout {
  /** Rounded-rectangle radius in pixels for the background shape. */
  radius: number;
  /** Where the artwork goes, in pixels. */
  inner: { x: number; y: number; size: number };
}

/** Padding and corner radius for an icon of `size` pixels. */
export function layout(size: number, options: Pick<FaviconOptions, 'padding' | 'radius'>): IconLayout {
  const pad = Math.round((size * clamp(options.padding, 0, 30)) / 100);
  const inner = Math.max(1, size - pad * 2);
  return { radius: (size * clamp(options.radius, 0, 50)) / 100, inner: { x: pad, y: pad, size: inner } };
}

/** Fit an image of w x h into a square box, preserving aspect ratio and centring it. */
export function containIn(w: number, h: number, box: { x: number; y: number; size: number }): { x: number; y: number; w: number; h: number } {
  if (w <= 0 || h <= 0) return { x: box.x, y: box.y, w: box.size, h: box.size };
  const scale = Math.min(box.size / w, box.size / h);
  const dw = w * scale;
  const dh = h * scale;
  return { x: box.x + (box.size - dw) / 2, y: box.y + (box.size - dh) / 2, w: dw, h: dh };
}

/** Font size in pixels so text of `chars` graphemes fills the inner box. */
export function fontSizeFor(innerSize: number, chars: number): number {
  if (chars <= 1) return innerSize * 0.78;
  if (chars === 2) return innerSize * 0.56;
  return innerSize * Math.max(0.28, 0.9 / chars);
}

export function graphemeCount(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  try {
    const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
    if (Seg) return [...new Seg(undefined, { granularity: 'grapheme' }).segment(t)].length;
  } catch {}
  return [...t].length;
}

// --- ICO container -------------------------------------------------------------

export interface IcoImage {
  /** Width and height in pixels (1 to 256). */
  size: number;
  /** PNG-encoded image bytes. */
  png: Uint8Array;
}

/**
 * Build a .ico file whose entries are PNG images (supported by every browser and by
 * Windows Vista onwards). Layout: ICONDIR (6 bytes), one ICONDIRENTRY (16 bytes) per
 * image, then the PNG payloads. All integers are little-endian; a size of 256 is
 * stored as 0.
 */
export function buildIco(images: readonly IcoImage[]): Uint8Array {
  if (images.length === 0) throw new Error('An ICO file needs at least one image.');
  const headerSize = 6 + 16 * images.length;
  const total = headerSize + images.reduce((n, i) => n + i.png.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type 1 = icon
  view.setUint16(4, images.length, true);
  let offset = headerSize;
  images.forEach((img, i) => {
    if (img.size < 1 || img.size > 256) throw new Error(`ICO images must be 1 to 256 pixels, got ${img.size}.`);
    const e = 6 + i * 16;
    out[e] = img.size === 256 ? 0 : img.size; // width
    out[e + 1] = img.size === 256 ? 0 : img.size; // height
    out[e + 2] = 0; // palette colours
    out[e + 3] = 0; // reserved
    view.setUint16(e + 4, 1, true); // colour planes
    view.setUint16(e + 6, 32, true); // bits per pixel
    view.setUint32(e + 8, img.png.length, true);
    view.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

/** Read back the directory of an ICO file (used by the tests and for sanity checks). */
export function readIcoDirectory(bytes: Uint8Array): { count: number; entries: { width: number; height: number; bpp: number; size: number; offset: number }[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) throw new Error('Not an ICO file.');
  const count = view.getUint16(4, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    entries.push({ width: bytes[e] || 256, height: bytes[e + 1] || 256, bpp: view.getUint16(e + 6, true), size: view.getUint32(e + 8, true), offset: view.getUint32(e + 12, true) });
  }
  return { count, entries };
}

// --- manifest and HTML ---------------------------------------------------------

export function normalizeBasePath(path: string): string {
  let p = path.trim() || '/';
  if (/^https?:\/\//i.test(p)) return p.endsWith('/') ? p : `${p}/`;
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/')) p = `${p}/`;
  return p.replace(/\/{2,}/g, '/');
}

export function buildManifest(options: Pick<FaviconOptions, 'appName' | 'shortName' | 'themeColor' | 'background' | 'basePath'>): string {
  const base = normalizeBasePath(options.basePath);
  const manifest = {
    name: options.appName.trim() || 'My Website',
    short_name: (options.shortName.trim() || options.appName.trim() || 'Website').slice(0, 12),
    icons: [
      { src: `${base}android-chrome-192x192.png`, sizes: '192x192', type: 'image/png' },
      { src: `${base}android-chrome-512x512.png`, sizes: '512x512', type: 'image/png' },
    ],
    theme_color: normalizeHex(options.themeColor, '#ffffff'),
    background_color: normalizeHex(options.background, '#ffffff'),
    display: 'standalone',
  };
  return JSON.stringify(manifest, null, 2) + '\n';
}

export function buildHtml(options: Pick<FaviconOptions, 'themeColor' | 'basePath'>, hasSvg: boolean): string {
  const base = normalizeBasePath(options.basePath);
  const lines = [
    `<link rel="icon" href="${base}favicon.ico" sizes="48x48">`,
    hasSvg ? `<link rel="icon" href="${base}icon.svg" type="image/svg+xml">` : null,
    `<link rel="icon" type="image/png" sizes="32x32" href="${base}favicon-32x32.png">`,
    `<link rel="icon" type="image/png" sizes="16x16" href="${base}favicon-16x16.png">`,
    `<link rel="apple-touch-icon" sizes="180x180" href="${base}apple-touch-icon.png">`,
    `<link rel="manifest" href="${base}site.webmanifest">`,
    `<meta name="theme-color" content="${normalizeHex(options.themeColor, '#ffffff')}">`,
  ];
  return lines.filter((l): l is string => l !== null).join('\n') + '\n';
}

/** Names of every file in the download, in order. */
export function fileList(hasSvg: boolean): string[] {
  return ['favicon.ico', ...(hasSvg ? ['icon.svg'] : []), ...PNG_OUTPUTS.map((o) => o.name), 'site.webmanifest', 'favicon-html.txt'];
}

export function sanitizePrefs(raw: unknown): FaviconOptions {
  const o: FaviconOptions = { ...DEFAULT_OPTIONS };
  if (!raw || typeof raw !== 'object') return o;
  const r = raw as Partial<Record<keyof FaviconOptions, unknown>>;
  if (r.source === 'image' || r.source === 'text') o.source = r.source;
  if (typeof r.text === 'string') o.text = r.text.slice(0, 4);
  if (typeof r.font === 'string' && FONTS.some((f) => f.id === r.font)) o.font = r.font;
  if (typeof r.textColor === 'string') o.textColor = normalizeHex(r.textColor, o.textColor);
  if (typeof r.background === 'string') o.background = normalizeHex(r.background, o.background);
  if (typeof r.transparent === 'boolean') o.transparent = r.transparent;
  if (typeof r.padding === 'number') o.padding = clamp(Math.round(r.padding), 0, 30);
  if (typeof r.radius === 'number') o.radius = clamp(Math.round(r.radius), 0, 50);
  if (typeof r.themeColor === 'string') o.themeColor = normalizeHex(r.themeColor, o.themeColor);
  if (typeof r.appName === 'string') o.appName = r.appName.slice(0, 60);
  if (typeof r.shortName === 'string') o.shortName = r.shortName.slice(0, 24);
  if (typeof r.basePath === 'string') o.basePath = r.basePath.slice(0, 120);
  return o;
}
