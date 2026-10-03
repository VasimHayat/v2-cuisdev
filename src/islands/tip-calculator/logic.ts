/**
 * Tip calculations: pure, no DOM. Money is computed in the currency's minor units so
 * rounding and splitting never drift by a cent.
 */
import { parseNumber } from '../calc-kit/numbers';

export type Rounding = 'none' | 'total' | 'person';
export type TaxMode = 'none' | 'amount' | 'percent';
export type TipBase = 'pre' | 'post';

export const CURRENCIES = [
  { code: 'USD', label: 'US dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'Pound sterling' },
  { code: 'INR', label: 'Indian rupee' },
  { code: 'JPY', label: 'Japanese yen' },
] as const;
export type Currency = (typeof CURRENCIES)[number]['code'];

export const TIP_PRESETS = [10, 12.5, 15, 18, 20, 25];

/** Fraction digits a currency uses (JPY 0, others 2), from Intl. */
export function currencyDigits(code: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function formatMoney(amount: number, code: string, locale?: string): string {
  if (!Number.isFinite(amount)) return '–';
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

export interface TipInput {
  bill: string;
  tipPercent: string;
  people: string;
  taxMode: TaxMode;
  tax: string;
  tipBase: TipBase;
  rounding: Rounding;
  currency: string;
}

export interface TipResult {
  /** Bill as entered (assumed to include tax when a tax is given). */
  bill: number;
  tax: number;
  preTax: number;
  tipBaseAmount: number;
  tip: number;
  total: number;
  people: number;
  perPersonTip: number;
  perPersonTotal: number;
  /** Effective tip as a percent of the tip base after rounding. */
  effectivePercent: number;
  /** Extra added by rounding up, total across the table. */
  roundingExtra: number;
  /** When the total does not split evenly: `highCount` people pay `shareHigh`, the rest `shareLow`. */
  shareLow: number;
  shareHigh: number;
  highCount: number;
}

export type TipOutcome = { ok: true; result: TipResult } | { ok: false; error: string | null };

/**
 * The bill is what the receipt says to pay. When a tax is given it is part of the bill:
 * tipping "pre-tax" uses bill minus tax as the base, "post-tax" uses the full bill.
 */
export function calculateTip(input: TipInput): TipOutcome {
  if (input.bill.trim() === '') return { ok: false, error: null };
  const bill = parseNumber(input.bill);
  const pct = input.tipPercent.trim() === '' ? 0 : parseNumber(input.tipPercent);
  const people = input.people.trim() === '' ? 1 : parseNumber(input.people);
  if ([bill, pct, people].some(Number.isNaN)) return { ok: false, error: 'Enter numbers only, for example 84.50.' };
  if (bill < 0) return { ok: false, error: 'The bill cannot be negative.' };
  if (pct < 0 || pct > 100) return { ok: false, error: 'Use a tip between 0% and 100%.' };
  if (!Number.isInteger(people) || people < 1 || people > 100) return { ok: false, error: 'Split between 1 and 100 people (whole numbers).' };

  let tax = 0;
  if (input.taxMode !== 'none' && input.tax.trim() !== '') {
    const t = parseNumber(input.tax);
    if (Number.isNaN(t) || t < 0) return { ok: false, error: 'Tax must be a positive number.' };
    // A tax percent applies to the pre-tax amount: bill = pre * (1 + t/100).
    tax = input.taxMode === 'amount' ? t : bill - bill / (1 + t / 100);
    if (tax > bill) return { ok: false, error: 'The tax cannot be larger than the bill.' };
  }

  const digits = currencyDigits(input.currency);
  const unit = 10 ** digits;
  const toMinor = (n: number) => Math.round(n * unit);
  const billM = toMinor(bill);
  const taxM = toMinor(tax);
  const preTaxM = billM - taxM;
  const baseM = input.tipBase === 'pre' ? preTaxM : billM;
  let tipM = Math.round((baseM * pct) / 100);
  let totalM = billM + tipM;
  const rawTotalM = totalM;

  if (input.rounding === 'total') {
    totalM = Math.ceil(totalM / unit) * unit;
    tipM = totalM - billM;
  } else if (input.rounding === 'person') {
    const per = Math.ceil(totalM / people / unit) * unit;
    totalM = per * people;
    tipM = totalM - billM;
  }

  const result: TipResult = {
    bill,
    tax: taxM / unit,
    preTax: preTaxM / unit,
    tipBaseAmount: baseM / unit,
    tip: tipM / unit,
    total: totalM / unit,
    people,
    perPersonTip: tipM / people / unit,
    perPersonTotal: totalM / people / unit,
    effectivePercent: baseM === 0 ? 0 : (tipM / baseM) * 100,
    roundingExtra: (totalM - rawTotalM) / unit,
    shareLow: Math.floor(totalM / people) / unit,
    shareHigh: (Math.floor(totalM / people) + 1) / unit,
    highCount: totalM % people,
  };
  return { ok: true, result };
}

/** Comparison rows for 10 to 25 percent at the current bill, tax base and split. */
export function comparisonTable(input: TipInput, percents = [10, 12.5, 15, 18, 20, 22, 25]): { percent: number; tip: number; total: number; perPerson: number }[] {
  const rows: { percent: number; tip: number; total: number; perPerson: number }[] = [];
  for (const p of percents) {
    const r = calculateTip({ ...input, tipPercent: String(p), rounding: 'none' });
    if (r.ok) rows.push({ percent: p, tip: r.result.tip, total: r.result.total, perPerson: r.result.perPersonTotal });
  }
  return rows;
}

export const DEFAULTS = {
  bill: '84.50',
  tip: '18',
  people: '2',
  taxMode: 'none',
  tax: '',
  base: 'post',
  rounding: 'none',
  currency: 'USD',
};
export type TipState = typeof DEFAULTS;

export function toInput(s: TipState): TipInput {
  return {
    bill: s.bill,
    tipPercent: s.tip,
    people: s.people,
    taxMode: (['none', 'amount', 'percent'].includes(s.taxMode) ? s.taxMode : 'none') as TaxMode,
    tax: s.tax,
    tipBase: s.base === 'pre' ? 'pre' : 'post',
    rounding: (['none', 'total', 'person'].includes(s.rounding) ? s.rounding : 'none') as Rounding,
    currency: CURRENCIES.some((c) => c.code === s.currency) ? s.currency : 'USD',
  };
}
