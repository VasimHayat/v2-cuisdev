/**
 * Number parsing and formatting shared by the calculators. Pure, no DOM.
 */

/**
 * Parse user input that may use either a dot or a comma as the decimal separator and
 * either as a thousands separator: "1,234.5", "1.234,5", "1234,5", " 12 ", "-3".
 * Returns NaN for empty or unreadable input.
 */
export function parseNumber(raw: string): number {
  let s = String(raw ?? '').trim().replace(/[\s  ']/g, '');
  if (s === '' || s === '-' || s === '.' || s === ',') return NaN;
  s = s.replace(/^\+/, '');
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    // Whichever comes last is the decimal separator.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const parts = s.split(',');
    // "1,234" or "1,234,567" with groups of three reads as thousands; otherwise decimal.
    const thousands = parts.length > 2 || (parts.length === 2 && parts[1]!.length === 3 && parts[0]!.replace('-', '').length <= 3 && parts[0] !== '0' && parts[0] !== '-0');
    s = thousands ? parts.join('') : parts.join('.');
  } else if (lastDot !== -1 && s.split('.').length > 2) {
    s = s.replace(/\./g, '');
  }
  if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Format with up to `max` fraction digits, trimming trailing zeros. */
export function formatNumber(n: number, max = 4, locale?: string): string {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  const digits = abs !== 0 && abs < 1e-4 ? 8 : max;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, useGrouping: true }).format(n === 0 ? 0 : n);
}

export function formatPercent(n: number, max = 2, locale?: string): string {
  if (!Number.isFinite(n)) return '–';
  return `${formatNumber(n, max, locale)}%`;
}

/** Round half away from zero to `digits` decimals, avoiding binary float surprises. */
export function round(n: number, digits = 2): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.sign(n) * Math.round(Math.abs(n) * f + Number.EPSILON * f) / f;
}

/** Encode a flat record of strings into a query string, dropping empty values. */
export function toQuery(state: Record<string, string>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(state)) if (v !== '' && v != null) params.set(k, v);
  return params.toString();
}

/** Read the keys of `defaults` from a query string; unknown keys are ignored. */
export function fromQuery<T extends Record<string, string>>(query: string, defaults: T): Partial<T> {
  const params = new URLSearchParams(query);
  const out: Partial<T> = {};
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const v = params.get(key as string);
    if (v !== null) out[key] = v as T[keyof T];
  }
  return out;
}
