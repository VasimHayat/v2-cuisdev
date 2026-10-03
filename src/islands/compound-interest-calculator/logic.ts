/**
 * Compound Interest Calculator: pure logic, no DOM.
 *
 * How contributions and compounding interact: the nominal annual rate is converted to
 * an equivalent growth factor per month, g = (1 + r/n)^(n/12), or e^(r/12) for
 * continuous compounding, and the balance is grown month by month. Contributions land
 * on month boundaries (at the start or end of their own period). Over any whole
 * compounding period this reproduces A = P(1 + r/n)^(nt) exactly, and for regular
 * contributions it matches the closed-form future value of an annuity that uses the
 * effective rate per contribution period. A deposit made partway through a compounding
 * period earns compound interest pro rata, which is how most online calculators and
 * savings illustrations treat it; a bank that pays nothing until the period ends would
 * credit slightly less.
 */
import { parseNumber } from '../calc-kit/numbers';

export const CURRENCIES = [
  { code: 'USD', label: 'US dollar' },
  { code: 'EUR', label: 'Euro' },
  { code: 'GBP', label: 'Pound sterling' },
  { code: 'INR', label: 'Indian rupee' },
  { code: 'JPY', label: 'Japanese yen' },
] as const;
export type Currency = (typeof CURRENCIES)[number]['code'];

export type ContributionFrequency = 'monthly' | 'quarterly' | 'yearly';
export type Timing = 'start' | 'end';
export type Compounding = 'daily' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'continuous';

export const CONTRIBUTION_FREQUENCIES: { id: ContributionFrequency; label: string; months: number }[] = [
  { id: 'monthly', label: 'Monthly', months: 1 },
  { id: 'quarterly', label: 'Quarterly', months: 3 },
  { id: 'yearly', label: 'Yearly', months: 12 },
];

export const COMPOUNDING: { id: Compounding; label: string; perYear: number | null }[] = [
  { id: 'daily', label: 'Daily (365)', perYear: 365 },
  { id: 'monthly', label: 'Monthly', perYear: 12 },
  { id: 'quarterly', label: 'Quarterly', perYear: 4 },
  { id: 'semiannual', label: 'Semi-annually', perYear: 2 },
  { id: 'annual', label: 'Annually', perYear: 1 },
  { id: 'continuous', label: 'Continuously', perYear: null },
];

export const MAX_YEARS = 60;

/** Raw form state as strings (calc-kit stores and shares strings). */
export interface FormState extends Record<string, string> {
  principal: string;
  contribution: string;
  freq: string;
  timing: string;
  rate: string;
  compound: string;
  years: string;
  increase: string;
  inflation: string;
  currency: string;
}

export const DEFAULTS: FormState = {
  principal: '10000',
  contribution: '200',
  freq: 'monthly',
  timing: 'end',
  rate: '7',
  compound: 'monthly',
  years: '20',
  increase: '0',
  inflation: '2.5',
  currency: 'USD',
};

export interface Inputs {
  principal: number;
  contribution: number;
  frequency: ContributionFrequency;
  timing: Timing;
  /** Annual nominal rate as a fraction, 0.07 for 7%. */
  rate: number;
  compounding: Compounding;
  years: number;
  /** Yearly increase of the contribution as a fraction. */
  increase: number;
  /** Annual inflation as a fraction; 0 when not used. */
  inflation: number;
  currency: Currency;
}

export type FieldErrors = Partial<Record<keyof FormState, string>>;

/** Turn form strings into numbers, collecting a readable message per bad field. */
export function parseInputs(s: FormState): { inputs: Inputs; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const num = (key: keyof FormState, label: string, opts: { min: number; max: number; empty?: number }) => {
    const raw = (s[key] ?? '').trim();
    if (raw === '' && opts.empty !== undefined) return opts.empty;
    const n = parseNumber(raw);
    if (Number.isNaN(n)) {
      errors[key] = `${label} must be a number.`;
      return opts.empty ?? 0;
    }
    if (n < opts.min || n > opts.max) {
      errors[key] = `${label} must be between ${opts.min} and ${opts.max}.`;
      return Math.min(opts.max, Math.max(opts.min, n));
    }
    return n;
  };
  const principal = num('principal', 'Initial deposit', { min: 0, max: 1e12, empty: 0 });
  const contribution = num('contribution', 'Contribution', { min: 0, max: 1e10, empty: 0 });
  const ratePct = num('rate', 'Interest rate', { min: 0, max: 100 });
  const yearsRaw = num('years', 'Years', { min: 1, max: MAX_YEARS });
  const years = Math.round(yearsRaw);
  if (!errors.years && !Number.isInteger(yearsRaw)) errors.years = 'Years must be a whole number.';
  const increase = num('increase', 'Yearly increase', { min: 0, max: 100, empty: 0 });
  const inflation = num('inflation', 'Inflation', { min: 0, max: 50, empty: 0 });
  const frequency = (CONTRIBUTION_FREQUENCIES.some((f) => f.id === s.freq) ? s.freq : 'monthly') as ContributionFrequency;
  const compounding = (COMPOUNDING.some((c) => c.id === s.compound) ? s.compound : 'monthly') as Compounding;
  const timing: Timing = s.timing === 'start' ? 'start' : 'end';
  const currency = (CURRENCIES.some((c) => c.code === s.currency) ? s.currency : 'USD') as Currency;
  return {
    inputs: { principal, contribution, frequency, timing, rate: ratePct / 100, compounding, years: Math.max(1, Math.min(MAX_YEARS, years)), increase: increase / 100, inflation: inflation / 100, currency },
    errors,
  };
}

/** Growth factor for one month at the given nominal rate and compounding. */
export function monthlyFactor(rate: number, compounding: Compounding): number {
  const c = COMPOUNDING.find((x) => x.id === compounding);
  if (!c || c.perYear === null) return Math.exp(rate / 12);
  return (1 + rate / c.perYear) ** (c.perYear / 12);
}

/** Effective annual rate (APY) as a fraction. */
export function effectiveAnnualRate(rate: number, compounding: Compounding): number {
  const c = COMPOUNDING.find((x) => x.id === compounding);
  if (!c || c.perYear === null) return Math.exp(rate) - 1;
  return (1 + rate / c.perYear) ** c.perYear - 1;
}

/** Years to double: the rule of 72 estimate and the exact figure, or null at 0%. */
export function doublingTime(rate: number, compounding: Compounding): { rule72: number; exact: number } | null {
  if (rate <= 0) return null;
  const apy = effectiveAnnualRate(rate, compounding);
  return { rule72: 72 / (rate * 100), exact: Math.log(2) / Math.log(1 + apy) };
}

export interface YearRow {
  year: number;
  /** Regular contributions paid during this year. */
  contributions: number;
  /** Interest earned during this year. */
  interest: number;
  /** Balance at the end of the year. */
  balance: number;
  /** Balance in today's money (deflated by inflation). */
  realBalance: number;
  /** Initial deposit plus all contributions so far. */
  totalDeposited: number;
  /** All interest earned so far. */
  totalInterest: number;
}

export interface Result {
  finalBalance: number;
  principal: number;
  totalContributions: number;
  totalInterest: number;
  realFinalBalance: number;
  apy: number;
  doubling: { rule72: number; exact: number } | null;
  rows: YearRow[];
}

/** Run the month-by-month simulation described at the top of this file. */
export function calculate(inp: Inputs): Result {
  const g = monthlyFactor(inp.rate, inp.compounding);
  const step = CONTRIBUTION_FREQUENCIES.find((f) => f.id === inp.frequency)?.months ?? 1;
  let balance = inp.principal;
  let deposited = inp.principal;
  let totalInterest = 0;
  const rows: YearRow[] = [];
  for (let year = 1; year <= inp.years; year++) {
    const amount = inp.contribution * (1 + inp.increase) ** (year - 1);
    let yearContrib = 0;
    let yearInterest = 0;
    for (let m = 1; m <= 12; m++) {
      if (inp.timing === 'start' && (m - 1) % step === 0) {
        balance += amount;
        yearContrib += amount;
      }
      const interest = balance * (g - 1);
      balance += interest;
      yearInterest += interest;
      if (inp.timing === 'end' && m % step === 0) {
        balance += amount;
        yearContrib += amount;
      }
    }
    deposited += yearContrib;
    totalInterest += yearInterest;
    rows.push({
      year,
      contributions: yearContrib,
      interest: yearInterest,
      balance,
      realBalance: balance / (1 + inp.inflation) ** year,
      totalDeposited: deposited,
      totalInterest,
    });
  }
  const last = rows[rows.length - 1]!;
  return {
    finalBalance: last.balance,
    principal: inp.principal,
    totalContributions: last.totalDeposited - inp.principal,
    totalInterest: last.totalInterest,
    realFinalBalance: last.realBalance,
    apy: effectiveAnnualRate(inp.rate, inp.compounding),
    doubling: doublingTime(inp.rate, inp.compounding),
    rows,
  };
}

/** Currency formatting; INR uses Indian lakh and crore grouping. */
export function formatMoney(amount: number, currency: Currency, opts: { decimals?: boolean } = {}): string {
  if (!Number.isFinite(amount)) return '–';
  const locale = currency === 'INR' ? 'en-IN' : undefined;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      ...(opts.decimals === false ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}),
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

/** Compact axis labels: 12.5k, 1.2M (INR: 1.2L, 3.4Cr). */
export function compactMoney(amount: number, currency: Currency): string {
  const abs = Math.abs(amount);
  const fmt = (n: number, suffix: string) => `${n >= 100 ? Math.round(n) : Number(n.toFixed(1))}${suffix}`;
  if (currency === 'INR') {
    if (abs >= 1e7) return fmt(amount / 1e7, 'Cr');
    if (abs >= 1e5) return fmt(amount / 1e5, 'L');
  }
  if (abs >= 1e9) return fmt(amount / 1e9, 'B');
  if (abs >= 1e6) return fmt(amount / 1e6, 'M');
  if (abs >= 1e3) return fmt(amount / 1e3, 'k');
  return String(Math.round(amount));
}

/** Round to a "nice" axis maximum: 1, 2, 2.5, 5 times a power of ten. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(value));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * exp >= value) return m * exp;
  return 10 * exp;
}

/** CSV of the yearly table, amounts to 2 decimals. */
export function rowsToCsv(rows: YearRow[]): string {
  const head = 'Year,Contributions,Interest,End balance,Real balance,Total deposited,Total interest';
  const f = (n: number) => n.toFixed(2);
  return [head, ...rows.map((r) => [r.year, f(r.contributions), f(r.interest), f(r.balance), f(r.realBalance), f(r.totalDeposited), f(r.totalInterest)].join(','))].join('\n') + '\n';
}
