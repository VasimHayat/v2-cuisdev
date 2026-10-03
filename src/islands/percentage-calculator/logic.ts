/**
 * Percentage calculations: pure functions returning a value and a one-line working,
 * or an error message (divide by zero, missing input). No DOM.
 */
import { formatNumber, parseNumber } from '../calc-kit/numbers';

export type Outcome = { ok: true; value: number; display: string; working: string } | { ok: false; error: string } | { ok: false; error: null };

const EMPTY: Outcome = { ok: false, error: null };
const f = (n: number) => formatNumber(n, 6);
const fp = (n: number) => `${formatNumber(n, 4)}%`;

function read(...raw: string[]): number[] | null {
  if (raw.some((r) => r.trim() === '')) return null;
  const nums = raw.map(parseNumber);
  return nums.some((n) => Number.isNaN(n)) ? [] : nums;
}

function guard(nums: number[] | null): Outcome | null {
  if (nums === null) return EMPTY;
  if (nums.length === 0) return { ok: false, error: 'Enter numbers only, for example 12.5 or 1,250.' };
  return null;
}

/** What is X% of Y */
export function percentOf(xRaw: string, yRaw: string): Outcome {
  const nums = read(xRaw, yRaw);
  const g = guard(nums);
  if (g) return g;
  const [x, y] = nums as [number, number];
  const value = (x / 100) * y;
  return { ok: true, value, display: f(value), working: `${f(x)} ÷ 100 × ${f(y)} = ${f(value)}` };
}

/** X is what % of Y */
export function whatPercent(xRaw: string, yRaw: string): Outcome {
  const nums = read(xRaw, yRaw);
  const g = guard(nums);
  if (g) return g;
  const [x, y] = nums as [number, number];
  if (y === 0) return { ok: false, error: 'The whole cannot be 0: nothing is a percentage of zero.' };
  const value = (x / y) * 100;
  return { ok: true, value, display: fp(value), working: `${f(x)} ÷ ${f(y)} × 100 = ${fp(value)}` };
}

/** X is Y% of what */
export function wholeFromPart(xRaw: string, pRaw: string): Outcome {
  const nums = read(xRaw, pRaw);
  const g = guard(nums);
  if (g) return g;
  const [x, p] = nums as [number, number];
  if (p === 0) return { ok: false, error: 'The percentage cannot be 0: 0% of any number is 0.' };
  const value = x / (p / 100);
  return { ok: true, value, display: f(value), working: `${f(x)} ÷ (${f(p)} ÷ 100) = ${f(value)}` };
}

export interface ChangeOutcome {
  outcome: Outcome;
  direction: 'increase' | 'decrease' | 'none' | null;
}

/** Percentage change from X to Y, with increase or decrease wording. */
export function percentChange(fromRaw: string, toRaw: string): ChangeOutcome {
  const nums = read(fromRaw, toRaw);
  const g = guard(nums);
  if (g) return { outcome: g, direction: null };
  const [a, b] = nums as [number, number];
  if (a === 0) return { outcome: { ok: false, error: 'The starting value cannot be 0: a change from zero has no percentage.' }, direction: null };
  const value = ((b - a) / Math.abs(a)) * 100;
  const direction = value > 0 ? 'increase' : value < 0 ? 'decrease' : 'none';
  const word = direction === 'increase' ? 'increase' : direction === 'decrease' ? 'decrease' : 'no change';
  return {
    outcome: { ok: true, value, display: direction === 'none' ? '0%' : `${fp(Math.abs(value))} ${word}`, working: `(${f(b)} − ${f(a)}) ÷ |${f(a)}| × 100 = ${fp(value)}` },
    direction,
  };
}

/** Increase Y by X% */
export function increaseBy(yRaw: string, pRaw: string): Outcome {
  const nums = read(yRaw, pRaw);
  const g = guard(nums);
  if (g) return g;
  const [y, p] = nums as [number, number];
  const value = y * (1 + p / 100);
  return { ok: true, value, display: f(value), working: `${f(y)} × (1 + ${f(p)} ÷ 100) = ${f(value)}` };
}

/** Decrease Y by X% */
export function decreaseBy(yRaw: string, pRaw: string): Outcome {
  const nums = read(yRaw, pRaw);
  const g = guard(nums);
  if (g) return g;
  const [y, p] = nums as [number, number];
  const value = y * (1 - p / 100);
  return { ok: true, value, display: f(value), working: `${f(y)} × (1 − ${f(p)} ÷ 100) = ${f(value)}` };
}

/** Symmetric percentage difference: |a − b| ÷ ((a + b) ÷ 2) × 100 */
export function percentDifference(aRaw: string, bRaw: string): Outcome {
  const nums = read(aRaw, bRaw);
  const g = guard(nums);
  if (g) return g;
  const [a, b] = nums as [number, number];
  const mean = (Math.abs(a) + Math.abs(b)) / 2;
  if (mean === 0) return { ok: false, error: 'Both values are 0, so there is no difference to compare.' };
  const value = (Math.abs(a - b) / mean) * 100;
  return { ok: true, value, display: fp(value), working: `|${f(a)} − ${f(b)}| ÷ ((|${f(a)}| + |${f(b)}|) ÷ 2) × 100 = ${fp(value)}` };
}

/** Difference between two percentages, in percentage points and in relative percent. */
export function pointsVsPercent(aRaw: string, bRaw: string): { points: Outcome; relative: Outcome } {
  const nums = read(aRaw, bRaw);
  const g = guard(nums);
  if (g) return { points: g, relative: g };
  const [a, b] = nums as [number, number];
  const pts = b - a;
  const points: Outcome = { ok: true, value: pts, display: `${pts > 0 ? '+' : ''}${formatNumber(pts, 4)} percentage points`, working: `${fp(b)} − ${fp(a)} = ${formatNumber(pts, 4)} points` };
  const relative = a === 0 ? ({ ok: false, error: 'A relative change from 0% is undefined.' } as Outcome) : (() => {
    const r = ((b - a) / Math.abs(a)) * 100;
    return { ok: true, value: r, display: `${r > 0 ? '+' : ''}${fp(r)}`, working: `(${f(b)} − ${f(a)}) ÷ ${f(Math.abs(a))} × 100 = ${fp(r)}` } as Outcome;
  })();
  return { points, relative };
}

export const DEFAULTS = {
  a1: '15', a2: '240',
  b1: '36', b2: '480',
  c1: '45', c2: '15',
  d1: '80', d2: '100',
  e1: '1200', e2: '8',
  f1: '1200', f2: '8',
  g1: '120', g2: '150',
  h1: '4', h2: '5',
};
export type PercentState = typeof DEFAULTS;
