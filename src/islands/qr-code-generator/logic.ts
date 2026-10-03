/**
 * QR Code Generator: pure helpers. Payload builders for each content type, capacity and
 * contrast checks, and an SVG renderer that draws from the module matrix produced by
 * the `qrcode` package (QRCode.create), so styles and a centre logo are under our control.
 */

export type ContentType = 'url' | 'text' | 'wifi' | 'email' | 'phone' | 'sms' | 'vcard' | 'geo';
export type Ecl = 'L' | 'M' | 'Q' | 'H';
export type ModuleStyle = 'square' | 'rounded' | 'dots';

export interface WifiData {
  ssid: string;
  password: string;
  security: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
}
export interface EmailData {
  to: string;
  subject: string;
  body: string;
}
export interface SmsData {
  phone: string;
  message: string;
}
export interface VcardData {
  firstName: string;
  lastName: string;
  org: string;
  phone: string;
  email: string;
  url: string;
}
export interface GeoData {
  lat: string;
  lon: string;
}

export interface Content {
  type: ContentType;
  url: string;
  text: string;
  wifi: WifiData;
  email: EmailData;
  phone: string;
  sms: SmsData;
  vcard: VcardData;
  geo: GeoData;
}

export const EMPTY_CONTENT: Content = {
  type: 'url',
  url: 'https://cuisdev.com',
  text: '',
  wifi: { ssid: '', password: '', security: 'WPA', hidden: false },
  email: { to: '', subject: '', body: '' },
  phone: '',
  sms: { phone: '', message: '' },
  vcard: { firstName: '', lastName: '', org: '', phone: '', email: '', url: '' },
  geo: { lat: '', lon: '' },
};

// --- payloads ----------------------------------------------------------------

/** Escape \ ; , : " for the WIFI: format (ZXing convention). */
export function escapeWifi(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

/** Escape \ , ; and newlines for vCard 3.0 text values. */
export function escapeVcard(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

export function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
  return `https://${t}`;
}

const cleanPhone = (p: string) => p.trim().replace(/[^\d+*#]/g, '');

export function buildPayload(c: Content): string {
  switch (c.type) {
    case 'url':
      return normalizeUrl(c.url);
    case 'text':
      return c.text;
    case 'wifi': {
      if (!c.wifi.ssid) return '';
      const parts = [`T:${c.wifi.security}`, `S:${escapeWifi(c.wifi.ssid)}`];
      if (c.wifi.security !== 'nopass') parts.push(`P:${escapeWifi(c.wifi.password)}`);
      if (c.wifi.hidden) parts.push('H:true');
      return `WIFI:${parts.join(';')};;`;
    }
    case 'email': {
      if (!c.email.to.trim()) return '';
      const q: string[] = [];
      if (c.email.subject) q.push(`subject=${encodeURIComponent(c.email.subject)}`);
      if (c.email.body) q.push(`body=${encodeURIComponent(c.email.body)}`);
      return `mailto:${c.email.to.trim()}${q.length ? `?${q.join('&')}` : ''}`;
    }
    case 'phone':
      return c.phone.trim() ? `tel:${cleanPhone(c.phone)}` : '';
    case 'sms':
      return c.sms.phone.trim() ? `SMSTO:${cleanPhone(c.sms.phone)}:${c.sms.message}` : '';
    case 'vcard': {
      const v = c.vcard;
      if (![v.firstName, v.lastName, v.org, v.phone, v.email, v.url].some((x) => x.trim())) return '';
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${escapeVcard(v.lastName.trim())};${escapeVcard(v.firstName.trim())};;;`, `FN:${escapeVcard([v.firstName, v.lastName].map((s) => s.trim()).filter(Boolean).join(' ') || v.org.trim())}`];
      if (v.org.trim()) lines.push(`ORG:${escapeVcard(v.org.trim())}`);
      if (v.phone.trim()) lines.push(`TEL;TYPE=CELL:${cleanPhone(v.phone)}`);
      if (v.email.trim()) lines.push(`EMAIL:${v.email.trim()}`);
      if (v.url.trim()) lines.push(`URL:${normalizeUrl(v.url)}`);
      lines.push('END:VCARD');
      return lines.join('\n');
    }
    case 'geo': {
      const lat = Number(c.geo.lat);
      const lon = Number(c.geo.lon);
      if (c.geo.lat.trim() === '' || c.geo.lon.trim() === '' || !Number.isFinite(lat) || !Number.isFinite(lon)) return '';
      return `geo:${lat},${lon}`;
    }
  }
}

/** Problems with the inputs that should be shown next to the form. */
export function contentWarning(c: Content): string | null {
  if (c.type === 'geo') {
    const lat = Number(c.geo.lat);
    const lon = Number(c.geo.lon);
    if (c.geo.lat.trim() && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return 'Latitude must be between -90 and 90.';
    if (c.geo.lon.trim() && (!Number.isFinite(lon) || lon < -180 || lon > 180)) return 'Longitude must be between -180 and 180.';
  }
  if (c.type === 'email' && c.email.to.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.to.trim())) return 'That email address does not look complete.';
  if (c.type === 'wifi' && c.wifi.security === 'WPA' && c.wifi.password && c.wifi.password.length < 8) return 'WPA passwords are at least 8 characters.';
  return null;
}

// --- capacity ----------------------------------------------------------------

/** Byte-mode capacity of version 40 per error correction level. */
export const MAX_BYTES: Record<Ecl, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 };

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function capacity(payload: string, ecl: Ecl): { bytes: number; max: number; ratio: number; level: 'ok' | 'near' | 'over' } {
  const bytes = byteLength(payload);
  const max = MAX_BYTES[ecl];
  const ratio = bytes / max;
  return { bytes, max, ratio, level: ratio > 1 ? 'over' : ratio > 0.85 ? 'near' : 'ok' };
}

// --- colour ------------------------------------------------------------------

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fg: string, bg: string): number {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return 1;
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Warn when a code may not scan: low contrast, or light modules on a dark background. */
export function scanWarning(fg: string, bg: string): string | null {
  const a = parseHex(fg);
  const b = parseHex(bg);
  if (!a || !b) return 'Enter colours as hex values such as #111827.';
  const ratio = contrastRatio(fg, bg);
  if (ratio < 3) return `Low contrast (${ratio.toFixed(1)}:1). Many scanners need a clearly darker foreground; aim for 4:1 or more.`;
  if (luminance(a) > luminance(b)) return 'Light modules on a dark background are inverted. Some phone cameras cannot read inverted codes.';
  return null;
}

// --- rendering ---------------------------------------------------------------

export interface Matrix {
  size: number;
  get(row: number, col: number): boolean | number;
}

export interface SvgOptions {
  margin: number;
  fg: string;
  bg: string;
  style: ModuleStyle;
  /** Data URL of a centre logo, or null. */
  logo: string | null;
  /** Logo width as a fraction of the code width (without margin), capped at 0.22. */
  logoScale: number;
}

export const MAX_LOGO_SCALE = 0.22;

/** Is (row, col) inside one of the three 7x7 finder patterns? */
export function inFinder(row: number, col: number, size: number): boolean {
  const inBox = (r0: number, c0: number) => row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7;
  return inBox(0, 0) || inBox(0, size - 7) || inBox(size - 7, 0);
}

/** Module rectangle covered by a centred logo, in module units (inclusive start, exclusive end). */
export function logoArea(size: number, scale: number): { start: number; end: number } | null {
  if (scale <= 0) return null;
  const s = Math.min(scale, MAX_LOGO_SCALE);
  let modules = Math.ceil(size * s);
  if ((size - modules) % 2 !== 0) modules += 1; // keep it centred on whole modules
  const start = (size - modules) / 2;
  return { start, end: start + modules };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function renderSvg(matrix: Matrix, o: SvgOptions): string {
  const n = matrix.size;
  const m = Math.max(0, Math.round(o.margin));
  const total = n + m * 2;
  const logo = o.logo ? logoArea(n, o.logoScale) : null;
  const covered = (r: number, c: number) => !!logo && r >= logo.start - 1 && r < logo.end + 1 && c >= logo.start - 1 && c < logo.end + 1;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="${o.style === 'square' ? 'crispEdges' : 'geometricPrecision'}">`);
  parts.push(`<rect width="${total}" height="${total}" fill="${esc(o.bg)}"/>`);

  // Data modules
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!matrix.get(r, c) || inFinder(r, c, n) || covered(r, c)) continue;
      const x = c + m;
      const y = r + m;
      if (o.style === 'square') path += `M${x} ${y}h1v1h-1z`;
      else if (o.style === 'dots') parts.push(`<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.42"/>`);
      else parts.push(`<rect x="${x + 0.05}" y="${y + 0.05}" width="0.9" height="0.9" rx="0.3"/>`);
    }
  }
  const fill = esc(o.fg);
  if (o.style === 'square') parts.push(`<path fill="${fill}" d="${path}"/>`);
  else {
    // wrap the dot/rounded elements in a group with the fill colour
    const startIdx = 2;
    const items = parts.splice(startIdx);
    parts.push(`<g fill="${fill}">${items.join('')}</g>`);
  }

  // Finder patterns: drawn as solid shapes so they stay readable in every style.
  const rx = o.style === 'square' ? 0 : o.style === 'rounded' ? 1.6 : 2.2;
  const rxInner = o.style === 'square' ? 0 : 0.9;
  for (const [r0, c0] of [
    [0, 0],
    [0, n - 7],
    [n - 7, 0],
  ] as const) {
    const x = c0 + m;
    const y = r0 + m;
    parts.push(`<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="${rx}" fill="none" stroke="${fill}" stroke-width="1"/>`);
    parts.push(`<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${rxInner}" fill="${fill}"/>`);
  }

  if (logo && o.logo) {
    const size = logo.end - logo.start;
    const x = logo.start + m;
    const pad = 0.3;
    parts.push(`<rect x="${x - pad}" y="${x - pad}" width="${size + pad * 2}" height="${size + pad * 2}" rx="0.8" fill="${esc(o.bg)}"/>`);
    parts.push(`<image href="${esc(o.logo)}" x="${x}" y="${x}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

// --- prefs -------------------------------------------------------------------

export interface Design {
  ecl: Ecl;
  margin: number;
  fg: string;
  bg: string;
  style: ModuleStyle;
  logoScale: number;
}

export const DEFAULT_DESIGN: Design = { ecl: 'M', margin: 4, fg: '#111827', bg: '#ffffff', style: 'square', logoScale: 0.2 };

const str = (v: unknown, d: string, max = 2000) => (typeof v === 'string' && v.length <= max ? v : d);

/** Restore a saved draft. Wi-Fi passwords are never stored, so they come back empty. */
export function parseDraft(raw: unknown): { content: Content; design: Design } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const c = (r.content ?? {}) as Record<string, any>;
  const d = (r.design ?? {}) as Record<string, any>;
  const types: ContentType[] = ['url', 'text', 'wifi', 'email', 'phone', 'sms', 'vcard', 'geo'];
  const content: Content = {
    type: types.includes(c.type) ? c.type : 'url',
    url: str(c.url, EMPTY_CONTENT.url),
    text: str(c.text, ''),
    wifi: { ssid: str(c.wifi?.ssid, '', 64), password: '', security: ['WPA', 'WEP', 'nopass'].includes(c.wifi?.security) ? c.wifi.security : 'WPA', hidden: c.wifi?.hidden === true },
    email: { to: str(c.email?.to, '', 320), subject: str(c.email?.subject, ''), body: str(c.email?.body, '') },
    phone: str(c.phone, '', 40),
    sms: { phone: str(c.sms?.phone, '', 40), message: str(c.sms?.message, '') },
    vcard: { firstName: str(c.vcard?.firstName, '', 100), lastName: str(c.vcard?.lastName, '', 100), org: str(c.vcard?.org, '', 100), phone: str(c.vcard?.phone, '', 40), email: str(c.vcard?.email, '', 320), url: str(c.vcard?.url, '', 500) },
    geo: { lat: str(c.geo?.lat, '', 20), lon: str(c.geo?.lon, '', 20) },
  };
  const design: Design = {
    ecl: ['L', 'M', 'Q', 'H'].includes(d.ecl) ? d.ecl : DEFAULT_DESIGN.ecl,
    margin: typeof d.margin === 'number' && d.margin >= 0 && d.margin <= 10 ? Math.round(d.margin) : DEFAULT_DESIGN.margin,
    fg: parseHex(str(d.fg, '', 9)) ? d.fg : DEFAULT_DESIGN.fg,
    bg: parseHex(str(d.bg, '', 9)) ? d.bg : DEFAULT_DESIGN.bg,
    style: ['square', 'rounded', 'dots'].includes(d.style) ? d.style : DEFAULT_DESIGN.style,
    logoScale: typeof d.logoScale === 'number' && d.logoScale > 0 && d.logoScale <= MAX_LOGO_SCALE ? d.logoScale : DEFAULT_DESIGN.logoScale,
  };
  return { content, design };
}

/** The draft to store: identical to the state except the Wi-Fi password. */
export function draftToStore(content: Content, design: Design): unknown {
  return { content: { ...content, wifi: { ...content.wifi, password: '' } }, design };
}
