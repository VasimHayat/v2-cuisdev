/**
 * Color Picker from Image: pure colour maths, no DOM. Conversions (HEX, RGB, HSL, HSV,
 * CMYK), WCAG contrast, nearest CSS named colour, a dominant-palette extractor (k-means
 * with k-means++ seeding on a pixel sample) and palette exports.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface PickedColor extends Rgb {
  /** Stable id for list keys. */
  id: string;
  /** Where it was picked, in image pixels, when known. */
  x?: number;
  y?: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

// --- conversions ---------------------------------------------------------------

export function toHex({ r, g, b }: Rgb): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');
}

export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h = (h * 60 + 360) % 360;
  return { h: round(h), s: round(s * 100), l: round(l * 100) };
}

export function toHsv({ r, g, b }: Rgb): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h: round(h), s: round(max === 0 ? 0 : (d / max) * 100), v: round(max * 100) };
}

export function toCmyk({ r, g, b }: Rgb): { c: number; m: number; y: number; k: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return { c: round(((1 - rn - k) / (1 - k)) * 100), m: round(((1 - gn - k) / (1 - k)) * 100), y: round(((1 - bn - k) / (1 - k)) * 100), k: round(k * 100) };
}

export interface ColorFormat {
  id: 'hex' | 'rgb' | 'hsl' | 'hsv' | 'cmyk' | 'name';
  label: string;
  value: string;
}

/** Every representation of a colour, ready to display and copy. */
export function formats(c: Rgb): ColorFormat[] {
  const hsl = toHsl(c);
  const hsv = toHsv(c);
  const cmyk = toCmyk(c);
  const near = nearestNamed(c);
  return [
    { id: 'hex', label: 'HEX', value: toHex(c) },
    { id: 'rgb', label: 'RGB', value: `rgb(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)})` },
    { id: 'hsl', label: 'HSL', value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
    { id: 'hsv', label: 'HSV', value: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)` },
    { id: 'cmyk', label: 'CMYK', value: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)` },
    { id: 'name', label: 'Nearest name', value: near.exact ? near.name : `${near.name} (closest)` },
  ];
}

// --- contrast ------------------------------------------------------------------

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastGrade {
  ratio: number;
  aa: boolean;
  aaLarge: boolean;
  aaa: boolean;
}

export function grade(ratio: number): ContrastGrade {
  return { ratio: round(ratio, 2), aa: ratio >= 4.5, aaLarge: ratio >= 3, aaa: ratio >= 7 };
}

/** Black or white, whichever reads better on this colour. */
export function bestTextColor(c: Rgb): '#000000' | '#ffffff' {
  return contrastRatio(c, { r: 0, g: 0, b: 0 }) >= contrastRatio(c, { r: 255, g: 255, b: 255 }) ? '#000000' : '#ffffff';
}

// --- named colours -------------------------------------------------------------

const NAMED =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,darkblue:00008b,darkcyan:008b8b,darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkkhaki:bdb76b,darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,dimgray:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,gray:808080,green:008000,greenyellow:adff2f,honeydew:f0fff0,hotpink:ff69b4,indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightpink:ffb6c1,lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,linen:faf0e6,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,slategray:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

export const NAMED_COLORS: readonly { name: string; rgb: Rgb }[] = NAMED.split(',').map((pair) => {
  const [name, hex] = pair.split(':') as [string, string];
  return { name, rgb: parseHex(hex)! };
});

/** Approximate perceptual distance ("redmean" weighted RGB). */
export function colorDistance(a: Rgb, b: Rgb): number {
  const rm = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

export function nearestNamed(c: Rgb): { name: string; exact: boolean; distance: number } {
  let best = NAMED_COLORS[0]!;
  let bestD = Infinity;
  for (const n of NAMED_COLORS) {
    const d = colorDistance(c, n.rgb);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return { name: best.name, exact: bestD === 0, distance: round(bestD, 1) };
}

// --- dominant palette ----------------------------------------------------------

export interface PaletteColor extends Rgb {
  /** Share of sampled pixels in this cluster, 0 to 1. */
  share: number;
}

/** Small deterministic PRNG so the palette is stable for the same image. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Extract `k` dominant colours from RGBA pixel data (as from getImageData) with
 * k-means on a sample of up to `maxSamples` opaque pixels, seeded with k-means++.
 * Fully transparent pixels are skipped. Clusters are returned largest first, and
 * near-duplicate clusters are merged.
 */
export function extractPalette(data: Uint8ClampedArray | Uint8Array, k = 8, options: { maxSamples?: number; iterations?: number; seed?: number } = {}): PaletteColor[] {
  const maxSamples = options.maxSamples ?? 20_000;
  const iterations = options.iterations ?? 12;
  const rand = mulberry32(options.seed ?? 42);
  const total = Math.floor(data.length / 4);
  const step = Math.max(1, Math.floor(total / maxSamples));
  const pts: number[] = [];
  for (let i = 0; i < total; i += step) {
    const o = i * 4;
    if ((data[o + 3] ?? 255) < 128) continue;
    pts.push(data[o]!, data[o + 1]!, data[o + 2]!);
  }
  const n = pts.length / 3;
  if (n === 0) return [];
  const kk = Math.max(1, Math.min(k, n));

  // k-means++ seeding
  const centers: number[] = [];
  const first = Math.floor(rand() * n) * 3;
  centers.push(pts[first]!, pts[first + 1]!, pts[first + 2]!);
  const dist = new Float64Array(n).fill(Infinity);
  while (centers.length / 3 < kk) {
    const c = centers.length - 3;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const dr = pts[i * 3]! - centers[c]!;
      const dg = pts[i * 3 + 1]! - centers[c + 1]!;
      const db = pts[i * 3 + 2]! - centers[c + 2]!;
      const d = dr * dr + dg * dg + db * db;
      if (d < dist[i]!) dist[i] = d;
      sum += dist[i]!;
    }
    if (sum === 0) break;
    let target = rand() * sum;
    let pick = 0;
    for (let i = 0; i < n; i++) {
      target -= dist[i]!;
      if (target <= 0) {
        pick = i;
        break;
      }
    }
    centers.push(pts[pick * 3]!, pts[pick * 3 + 1]!, pts[pick * 3 + 2]!);
  }
  const kc = centers.length / 3;

  // Lloyd iterations
  const assign = new Int32Array(n);
  for (let it = 0; it < iterations; it++) {
    const sums = new Float64Array(kc * 3);
    const counts = new Int32Array(kc);
    let moved = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < kc; c++) {
        const dr = pts[i * 3]! - centers[c * 3]!;
        const dg = pts[i * 3 + 1]! - centers[c * 3 + 1]!;
        const db = pts[i * 3 + 2]! - centers[c * 3 + 2]!;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assign[i] !== best) moved = true;
      assign[i] = best;
      counts[best]!++;
      sums[best * 3]! += pts[i * 3]!;
      sums[best * 3 + 1]! += pts[i * 3 + 1]!;
      sums[best * 3 + 2]! += pts[i * 3 + 2]!;
    }
    for (let c = 0; c < kc; c++) {
      if (counts[c]! > 0) {
        centers[c * 3] = sums[c * 3]! / counts[c]!;
        centers[c * 3 + 1] = sums[c * 3 + 1]! / counts[c]!;
        centers[c * 3 + 2] = sums[c * 3 + 2]! / counts[c]!;
      }
    }
    if (!moved && it > 0) break;
  }

  const counts = new Int32Array(kc);
  for (let i = 0; i < n; i++) counts[assign[i]!]!++;
  let clusters: PaletteColor[] = [];
  for (let c = 0; c < kc; c++) {
    if (counts[c] === 0) continue;
    clusters.push({ r: clamp255(centers[c * 3]!), g: clamp255(centers[c * 3 + 1]!), b: clamp255(centers[c * 3 + 2]!), share: counts[c]! / n });
  }
  clusters.sort((a, b) => b.share - a.share);
  // Merge near-duplicates (distance below ~12 in redmean space)
  const merged: PaletteColor[] = [];
  for (const c of clusters) {
    const twin = merged.find((m) => colorDistance(m, c) < 24);
    if (twin) twin.share += c.share;
    else merged.push({ ...c });
  }
  clusters = merged.sort((a, b) => b.share - a.share);
  return clusters;
}

// --- exports -------------------------------------------------------------------

export type ExportFormat = 'css' | 'json' | 'tailwind' | 'hex';

export function exportPalette(colors: readonly Rgb[], format: ExportFormat, prefix = 'color'): string {
  const hexes = colors.map(toHex);
  switch (format) {
    case 'css':
      return `:root {\n${hexes.map((h, i) => `  --${prefix}-${i + 1}: ${h};`).join('\n')}\n}\n`;
    case 'json':
      return JSON.stringify(hexes, null, 2) + '\n';
    case 'tailwind': {
      const entries = hexes.map((h, i) => `          '${(i + 1) * 100}': '${h}',`).join('\n');
      return `// tailwind.config.js\nexport default {\n  theme: {\n    extend: {\n      colors: {\n        ${prefix}: {\n${entries}\n        },\n      },\n    },\n  },\n};\n`;
    }
    default:
      return hexes.join('\n') + '\n';
  }
}

export function sanitizePalette(raw: unknown, max = 24): PickedColor[] {
  if (!Array.isArray(raw)) return [];
  const out: PickedColor[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { r, g, b, id, x, y } = item as Record<string, unknown>;
    if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') continue;
    const c: PickedColor = { r: clamp255(r), g: clamp255(g), b: clamp255(b), id: typeof id === 'string' ? id : `${out.length}-${toHex({ r, g, b })}` };
    if (typeof x === 'number' && typeof y === 'number') {
      c.x = x;
      c.y = y;
    }
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/** Add a colour to the front of the palette, dropping an identical one and capping the length. */
export function addToPalette(palette: readonly PickedColor[], color: PickedColor, max = 24): PickedColor[] {
  const hex = toHex(color);
  return [color, ...palette.filter((p) => toHex(p) !== hex)].slice(0, max);
}
