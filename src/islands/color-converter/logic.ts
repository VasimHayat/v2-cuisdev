/**
 * Color Converter: pure colour maths, no DOM.
 *
 * Colours are held as gamma-encoded sRGB floats (0 to 1, possibly outside that range
 * when a Lab or OKLCH input lies outside the sRGB gamut) plus alpha. Conversions follow
 * CSS Color 4: sRGB transfer function, D65 for sRGB and OKLab, D50 with Bradford
 * adaptation for CIE Lab and LCH, and Björn Ottosson's OKLab matrices.
 */
import { NAMED_COLORS, contrastRatio, grade, nearestNamed, toCmyk, toHsv, type ContrastGrade, type Rgb } from '../color-picker-from-image/logic';

export class ColorParseError extends Error {
  override name = 'ColorParseError';
}

/** Gamma-encoded sRGB, 0..1 nominal, may exceed the range when out of gamut. */
export interface Color {
  r: number;
  g: number;
  b: number;
  alpha: number;
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}
export interface Lch {
  l: number;
  c: number;
  h: number;
}

// --- transfer functions and matrices ----------------------------------------------

const toLinear = (c: number): number => {
  const abs = Math.abs(c);
  return abs <= 0.04045 ? c / 12.92 : Math.sign(c) * ((abs + 0.055) / 1.055) ** 2.4;
};
const toGamma = (c: number): number => {
  const abs = Math.abs(c);
  return abs <= 0.0031308 ? c * 12.92 : Math.sign(c) * (1.055 * abs ** (1 / 2.4) - 0.055);
};

type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];
const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

const LIN_SRGB_TO_XYZ_D65: Mat3 = [
  [0.41239079926595934, 0.357584339383878, 0.1804807884018343],
  [0.21263900587151027, 0.715168678767756, 0.07219231536073371],
  [0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
];
const XYZ_D65_TO_LIN_SRGB: Mat3 = [
  [3.2409699419045226, -1.537383177570094, -0.4986107602930034],
  [-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
  [0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
];
const D65_TO_D50: Mat3 = [
  [1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
  [0.029627815688159344, 0.990434484573249, -0.01707382502938514],
  [-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
];
const D50_TO_D65: Mat3 = [
  [0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
  [-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
  [0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
];
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

// --- space conversions ------------------------------------------------------------

export function colorToLab(c: Color): Lab {
  const xyz65 = mul(LIN_SRGB_TO_XYZ_D65, [toLinear(c.r), toLinear(c.g), toLinear(c.b)]);
  const xyz = mul(D65_TO_D50, xyz65);
  const f = xyz.map((v, i) => {
    const t = v / D50_WHITE[i]!;
    return t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
  }) as Vec3;
  return { l: 116 * f[1] - 16, a: 500 * (f[0] - f[1]), b: 200 * (f[1] - f[2]) };
}

export function labToColor(lab: Lab, alpha = 1): Color {
  const fy = (lab.l + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  const x = fx ** 3 > EPS ? fx ** 3 : (116 * fx - 16) / KAPPA;
  const y = lab.l > KAPPA * EPS ? fy ** 3 : lab.l / KAPPA;
  const z = fz ** 3 > EPS ? fz ** 3 : (116 * fz - 16) / KAPPA;
  const xyz65 = mul(D50_TO_D65, [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]]);
  const lin = mul(XYZ_D65_TO_LIN_SRGB, xyz65);
  return { r: toGamma(lin[0]), g: toGamma(lin[1]), b: toGamma(lin[2]), alpha };
}

export function colorToOklab(c: Color): Lab {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToColor(lab: Lab, alpha = 1): Color {
  const l = (lab.l + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.l - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.l - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  };
}

export function labToLch(lab: Lab): Lch {
  const c = Math.hypot(lab.a, lab.b);
  let h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: lab.l, c, h: c < 1e-4 ? 0 : h };
}

export function lchToLab(lch: Lch): Lab {
  const rad = (lch.h * Math.PI) / 180;
  return { l: lch.l, a: lch.c * Math.cos(rad), b: lch.c * Math.sin(rad) };
}

export const colorToOklch = (c: Color): Lch => labToLch(colorToOklab(c));
export const oklchToColor = (lch: Lch, alpha = 1): Color => oklabToColor(lchToLab(lch), alpha);

export function hslToColor(h: number, s: number, l: number, alpha = 1): Color {
  const sat = clamp(s, 0, 1);
  const light = clamp(l, 0, 1);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return { r: f(0), g: f(8), b: f(4), alpha };
}

export function colorToHsl(c: Color): { h: number; s: number; l: number } {
  const r = clamp(c.r, 0, 1);
  const g = clamp(c.g, 0, 1);
  const b = clamp(c.b, 0, 1);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hwbToColor(h: number, w: number, bl: number, alpha = 1): Color {
  let white = clamp(w, 0, 1);
  let black = clamp(bl, 0, 1);
  if (white + black >= 1) {
    const grey = white / (white + black);
    return { r: grey, g: grey, b: grey, alpha };
  }
  const base = hslToColor(h, 1, 0.5);
  const scale = 1 - white - black;
  return { r: base.r * scale + white, g: base.g * scale + white, b: base.b * scale + white, alpha };
}

export function colorToHwb(c: Color): { h: number; w: number; b: number } {
  const { h } = colorToHsl(c);
  const r = clamp(c.r, 0, 1);
  const g = clamp(c.g, 0, 1);
  const b = clamp(c.b, 0, 1);
  return { h, w: Math.min(r, g, b), b: 1 - Math.max(r, g, b) };
}

// --- gamut ------------------------------------------------------------------------

export function inGamut(c: Color, eps = 1e-4): boolean {
  return [c.r, c.g, c.b].every((v) => v >= -eps && v <= 1 + eps);
}

export function clip(c: Color): Color {
  return { r: clamp(c.r, 0, 1), g: clamp(c.g, 0, 1), b: clamp(c.b, 0, 1), alpha: c.alpha };
}

function deltaEOK(a: Color, b: Color): number {
  const x = colorToOklab(a);
  const y = colorToOklab(b);
  return Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b);
}

/**
 * CSS Color 4 gamut mapping: reduce OKLCH chroma until the clipped colour is within a
 * just-noticeable difference (0.02 deltaE OK) of the unclipped one, then clip.
 */
export function gamutMap(c: Color): Color {
  if (inGamut(c)) return clip(c);
  const lch = colorToOklch(c);
  if (lch.l >= 1) return { r: 1, g: 1, b: 1, alpha: c.alpha };
  if (lch.l <= 0) return { r: 0, g: 0, b: 0, alpha: c.alpha };
  let lo = 0;
  let hi = lch.c;
  let best = clip(oklchToColor({ ...lch, c: 0 }, c.alpha));
  for (let i = 0; i < 30 && hi - lo > 1e-4; i++) {
    const mid = (lo + hi) / 2;
    const candidate = oklchToColor({ ...lch, c: mid }, c.alpha);
    if (inGamut(candidate)) {
      lo = mid;
      best = clip(candidate);
      continue;
    }
    const clipped = clip(candidate);
    if (deltaEOK(clipped, candidate) < 0.02) {
      lo = mid;
      best = clipped;
    } else hi = mid;
  }
  return best;
}

// --- parsing ----------------------------------------------------------------------

const NAMED = new Map(NAMED_COLORS.map((n) => [n.name, n.rgb]));

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface Token {
  value: number;
  unit: '' | '%' | 'deg' | 'rad' | 'grad' | 'turn' | 'none';
}

function parseToken(raw: string): Token {
  const t = raw.trim().toLowerCase();
  if (t === 'none') return { value: 0, unit: 'none' };
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/.exec(t);
  if (!m) throw new ColorParseError(`"${raw.trim()}" is not a number, percentage or angle.`);
  return { value: Number(m[1]), unit: (m[2] ?? '') as Token['unit'] };
}

function angle(t: Token): number {
  const deg = t.unit === 'rad' ? (t.value * 180) / Math.PI : t.unit === 'grad' ? t.value * 0.9 : t.unit === 'turn' ? t.value * 360 : t.value;
  return ((deg % 360) + 360) % 360;
}

/** Percentage or plain number scaled by `ref` for percentages. */
function scaled(t: Token, ref: number): number {
  return t.unit === '%' ? (t.value / 100) * ref : t.value;
}

function alphaOf(t: Token | undefined): number {
  if (!t) return 1;
  return clamp(t.unit === '%' ? t.value / 100 : t.value, 0, 1);
}

function splitArgs(body: string): { parts: string[]; alpha?: string } {
  let main = body;
  let alpha: string | undefined;
  const slash = body.indexOf('/');
  if (slash !== -1) {
    main = body.slice(0, slash);
    alpha = body.slice(slash + 1).trim();
  }
  const parts = main.includes(',') ? main.split(',').map((s) => s.trim()).filter(Boolean) : main.trim().split(/\s+/).filter(Boolean);
  // Legacy comma syntax: rgba(r, g, b, a)
  if (alpha === undefined && parts.length === 4) alpha = parts.pop();
  return alpha === undefined ? { parts } : { parts, alpha };
}

function parseHexBody(hex: string): Color | null {
  if (!/^[0-9a-f]+$/i.test(hex) || ![3, 4, 6, 8].includes(hex.length)) return null;
  const full = hex.length <= 4 ? [...hex].map((ch) => ch + ch).join('') : hex;
  const n = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), alpha: full.length === 8 ? n(6) : 1 };
}

/** Parse any CSS colour syntax, plus bare hex and bare "r, g, b" triples. */
export function parseColor(input: string): Color {
  const text = input.trim().toLowerCase().replace(/;$/, '');
  if (!text) throw new ColorParseError('Enter a colour, for example #3b82f6, rgb(59 130 246) or oklch(62% 0.19 260).');
  if (text === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  const named = NAMED.get(text);
  if (named) return { r: named.r / 255, g: named.g / 255, b: named.b / 255, alpha: 1 };
  if (text.startsWith('#')) {
    const c = parseHexBody(text.slice(1));
    if (!c) throw new ColorParseError(`"${input.trim()}" is not a valid hex colour. Use 3, 4, 6 or 8 hex digits.`);
    return c;
  }
  // Bare hex without '#', e.g. "3b82f6" or "fff"
  const bareHex = parseHexBody(text);
  if (bareHex) return bareHex;

  const fn = /^([a-z]+)\((.*)\)$/.exec(text);
  if (!fn) {
    // Bare triple such as "255, 0, 0" or "255 0 0"
    if (/^[\d.\s,%/]+$/.test(text)) return parseColor(`rgb(${text})`);
    throw new ColorParseError(`"${input.trim()}" is not a colour this tool understands. Try a hex code, a CSS function such as rgb() or oklch(), or a named colour.`);
  }
  const name = fn[1]!;
  const { parts, alpha: alphaRaw } = splitArgs(fn[2]!);
  if (parts.length !== 3) throw new ColorParseError(`${name}() needs three values${alphaRaw ? '' : ' (and an optional / alpha)'}, but got ${parts.length}.`);
  const t = parts.map(parseToken) as [Token, Token, Token];
  const alpha = alphaOf(alphaRaw ? parseToken(alphaRaw) : undefined);

  switch (name) {
    case 'rgb':
    case 'rgba':
      return { r: scaled(t[0], 255) / 255, g: scaled(t[1], 255) / 255, b: scaled(t[2], 255) / 255, alpha };
    case 'hsl':
    case 'hsla':
      return hslToColor(angle(t[0]), (t[1].unit === '%' ? t[1].value : t[1].value) / 100, (t[2].unit === '%' ? t[2].value : t[2].value) / 100, alpha);
    case 'hwb':
      return hwbToColor(angle(t[0]), t[1].value / 100, t[2].value / 100, alpha);
    case 'lab':
      return labToColor({ l: scaled(t[0], 100), a: scaled(t[1], 125), b: scaled(t[2], 125) }, alpha);
    case 'lch':
      return labToColor(lchToLab({ l: scaled(t[0], 100), c: scaled(t[1], 150), h: angle(t[2]) }), alpha);
    case 'oklab':
      return oklabToColor({ l: scaled(t[0], 1), a: scaled(t[1], 0.4), b: scaled(t[2], 0.4) }, alpha);
    case 'oklch':
      return oklchToColor({ l: scaled(t[0], 1), c: scaled(t[1], 0.4), h: angle(t[2]) }, alpha);
    default:
      throw new ColorParseError(`${name}() is not a supported colour function. Use rgb, hsl, hwb, lab, lch, oklab or oklch.`);
  }
}

// --- formatting -------------------------------------------------------------------

/** Round to `digits` decimals and drop trailing zeros. */
export function num(v: number, digits: number): string {
  const r = Number(v.toFixed(digits));
  return String(Object.is(r, -0) ? 0 : r);
}

export function toRgb255(c: Color): Rgb {
  const m = gamutMap(c);
  return { r: Math.round(m.r * 255), g: Math.round(m.g * 255), b: Math.round(m.b * 255) };
}

const hex2 = (v: number) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');

export function toHex(c: Color): string {
  const m = gamutMap(c);
  return `#${hex2(m.r)}${hex2(m.g)}${hex2(m.b)}`;
}

export function toHex8(c: Color): string {
  return `${toHex(c)}${hex2(c.alpha)}`;
}

function alphaSuffix(c: Color): string {
  return c.alpha < 1 ? ` / ${num(c.alpha * 100, 1)}%` : '';
}

export interface FormatRow {
  id: string;
  label: string;
  value: string;
  note?: string;
}

/** Every representation shown in the output table. */
export function formatAll(c: Color): FormatRow[] {
  const mapped = gamutMap(c);
  const rgb = toRgb255(c);
  const hsl = colorToHsl(mapped);
  const hwb = colorToHwb(mapped);
  const hsv = toHsv(rgb);
  const cmyk = toCmyk(rgb);
  const lab = colorToLab(c);
  const lch = labToLch(lab);
  const oklab = colorToOklab(c);
  const oklch = labToLch(oklab);
  const near = nearestNamed(rgb);
  const a = alphaSuffix(c);
  return [
    { id: 'hex', label: 'HEX', value: toHex(c) },
    { id: 'hex8', label: 'HEX8', value: toHex8(c) },
    { id: 'rgb', label: 'RGB', value: `rgb(${rgb.r} ${rgb.g} ${rgb.b}${a})` },
    { id: 'hsl', label: 'HSL', value: `hsl(${num(hsl.h, 1)} ${num(hsl.s * 100, 1)}% ${num(hsl.l * 100, 1)}%${a})` },
    { id: 'hwb', label: 'HWB', value: `hwb(${num(hwb.h, 1)} ${num(hwb.w * 100, 1)}% ${num(hwb.b * 100, 1)}%${a})` },
    { id: 'hsv', label: 'HSV', value: `hsv(${num(hsv.h, 0)}, ${num(hsv.s, 0)}%, ${num(hsv.v, 0)}%)`, note: 'Not a CSS syntax' },
    { id: 'cmyk', label: 'CMYK', value: `cmyk(${num(cmyk.c, 0)}%, ${num(cmyk.m, 0)}%, ${num(cmyk.y, 0)}%, ${num(cmyk.k, 0)}%)`, note: 'Naive conversion, not a print profile' },
    { id: 'lab', label: 'Lab', value: `lab(${num(lab.l, 2)}% ${num(lab.a, 2)} ${num(lab.b, 2)}${a})` },
    { id: 'lch', label: 'LCH', value: `lch(${num(lch.l, 2)}% ${num(lch.c, 2)} ${num(lch.h, 2)}${a})` },
    { id: 'oklab', label: 'OKLab', value: `oklab(${num(oklab.l * 100, 1)}% ${num(oklab.a, 4)} ${num(oklab.b, 4)}${a})` },
    { id: 'oklch', label: 'OKLCH', value: `oklch(${num(oklch.l * 100, 1)}% ${num(oklch.c, 4)} ${num(oklch.h, 2)}${a})` },
    { id: 'name', label: 'Nearest name', value: near.name, note: near.exact ? 'Exact match' : 'Closest named colour' },
    { id: 'tailwind', label: 'Tailwind', value: `bg-[${c.alpha < 1 ? toHex8(c) : toHex(c)}]` },
  ];
}

// --- palettes ---------------------------------------------------------------------

/** Ten steps of OKLCH lightness from light to dark, keeping hue and chroma (gamut mapped). */
export function tintsAndShades(c: Color, steps = 10): Color[] {
  const lch = colorToOklch(c);
  return Array.from({ length: steps }, (_, i) => {
    const l = 0.96 - (i * (0.96 - 0.2)) / (steps - 1);
    return gamutMap(oklchToColor({ l, c: lch.c * (1 - Math.abs(l - lch.l) * 0.6), h: lch.h }, 1));
  });
}

export interface Harmony {
  name: string;
  colors: Color[];
}

export function harmonies(c: Color): Harmony[] {
  const lch = colorToOklch(c);
  const at = (dh: number) => gamutMap(oklchToColor({ ...lch, h: (lch.h + dh + 360) % 360 }, 1));
  const base = gamutMap({ ...c, alpha: 1 });
  return [
    { name: 'Complementary', colors: [base, at(180)] },
    { name: 'Analogous', colors: [at(-30), base, at(30)] },
    { name: 'Triadic', colors: [base, at(120), at(240)] },
    { name: 'Split complementary', colors: [base, at(150), at(210)] },
  ];
}

// --- contrast ---------------------------------------------------------------------

export interface ContrastResult {
  ratio: number;
  grade: ContrastGrade;
}

/** WCAG 2 contrast of the opaque colours (alpha ignored). */
export function contrast(fg: Color, bg: Color): ContrastResult {
  const ratio = contrastRatio(toRgb255(fg), toRgb255(bg));
  return { ratio, grade: grade(ratio) };
}

export function cssColor(c: Color): string {
  return c.alpha < 1 ? toHex8(c) : toHex(c);
}

export const SAMPLE = 'oklch(62% 0.19 260)';
