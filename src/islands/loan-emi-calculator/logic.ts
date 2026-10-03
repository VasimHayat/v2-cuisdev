/**
 * Loan and EMI maths: pure functions, no DOM.
 *
 * Everything is computed in full floating-point precision and rounded only for display.
 * The schedule's last payment is adjusted so the balance ends at exactly zero.
 */

export type Frequency = 'monthly' | 'fortnightly' | 'weekly';
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'INR' | 'JPY';

export const PERIODS_PER_YEAR: Record<Frequency, number> = { monthly: 12, fortnightly: 26, weekly: 52 };

export const FREQUENCY_LABELS: Record<Frequency, string> = { monthly: 'Monthly', fortnightly: 'Fortnightly', weekly: 'Weekly' };

export const CURRENCIES: { code: CurrencyCode; label: string; locale: string }[] = [
  { code: 'USD', label: 'US dollar ($)', locale: 'en-US' },
  { code: 'EUR', label: 'Euro (€)', locale: 'de-DE' },
  { code: 'GBP', label: 'Pound sterling (£)', locale: 'en-GB' },
  { code: 'INR', label: 'Indian rupee (₹)', locale: 'en-IN' },
  { code: 'JPY', label: 'Japanese yen (¥)', locale: 'ja-JP' },
];

export interface LoanInput {
  /** Principal borrowed. */
  amount: number;
  /** Nominal annual interest rate in percent, e.g. 8.5. */
  rate: number;
  years: number;
  months: number;
  /** First payment month as YYYY-MM. */
  start: string;
  frequency: Frequency;
  /** Extra amount paid every month on top of the instalment (spread across periods for other frequencies). */
  extraMonthly: number;
  /** One-off prepayment. */
  lumpSum: number;
  /** Loan month (1-based, counted from the start month) in which the lump sum is paid. */
  lumpMonth: number;
  currency: CurrencyCode;
}

export const DEFAULT_INPUT: LoanInput = {
  amount: 250_000,
  rate: 7.5,
  years: 20,
  months: 0,
  start: currentMonth(),
  frequency: 'monthly',
  extraMonthly: 0,
  lumpSum: 0,
  lumpMonth: 12,
  currency: 'USD',
};

export const LIMITS = {
  amount: { min: 0, max: 1_000_000_000 },
  rate: { min: 0, max: 50 },
  years: { min: 0, max: 50 },
  months: { min: 0, max: 11 },
  extraMonthly: { min: 0, max: 1_000_000_000 },
  lumpSum: { min: 0, max: 1_000_000_000 },
  lumpMonth: { min: 1, max: 600 },
};

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Number of payments for the tenure at the chosen frequency (at least 1 when the tenure is not zero). */
export function periodCount(years: number, months: number, frequency: Frequency): number {
  const totalMonths = Math.max(0, Math.round(years) * 12 + Math.round(months));
  if (totalMonths === 0) return 0;
  return Math.max(1, Math.round((totalMonths / 12) * PERIODS_PER_YEAR[frequency]));
}

/** Interest rate per period as a fraction. */
export function periodRate(annualPercent: number, frequency: Frequency): number {
  return annualPercent / 100 / PERIODS_PER_YEAR[frequency];
}

/**
 * Equated instalment: P·r·(1+r)^n / ((1+r)^n − 1), or P/n when the rate is zero.
 * Returns 0 for an empty loan.
 */
export function emi(principal: number, ratePerPeriod: number, periods: number): number {
  if (principal <= 0 || periods <= 0) return 0;
  if (ratePerPeriod === 0) return principal / periods;
  const g = Math.pow(1 + ratePerPeriod, periods);
  return (principal * ratePerPeriod * g) / (g - 1);
}

export interface ScheduleRow {
  /** 1-based payment number. */
  period: number;
  /** ISO date (YYYY-MM-DD) of the payment. */
  date: string;
  /** Regular instalment actually paid this period (the last one may be smaller). */
  payment: number;
  principal: number;
  interest: number;
  /** Prepayment on top of the instalment. */
  extra: number;
  /** Balance after this payment. */
  balance: number;
}

export interface YearRow {
  /** 1-based loan year. */
  year: number;
  /** Date of the first and last payment in that loan year. */
  from: string;
  to: string;
  /** Regular instalments paid in the year. */
  payment: number;
  /** Principal repaid by the regular instalments (excluding prepayments). */
  principal: number;
  interest: number;
  /** Prepayments made in the year. */
  extra: number;
  balance: number;
}

export interface LoanResult {
  /** Scheduled instalment per period. */
  instalment: number;
  periods: number;
  rows: ScheduleRow[];
  totalInterest: number;
  /** Sum of every payment including prepayments. */
  totalPaid: number;
  payoffDate: string | null;
  /** Interest and number of payments for the same loan without any prepayment. */
  baseline: { totalInterest: number; periods: number; payoffDate: string | null };
  interestSaved: number;
  /** Payments saved by prepaying, and the same in months. */
  periodsSaved: number;
  monthsSaved: number;
}

function parseStart(start: string): { y: number; m: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(start);
  if (!m) {
    const now = new Date();
    return { y: now.getFullYear(), m: now.getMonth() };
  }
  return { y: Number(m[1]), m: Math.min(11, Math.max(0, Number(m[2]) - 1)) };
}

/** Date of payment `index` (0-based) for a schedule starting on the 1st of the start month. */
export function paymentDate(start: string, index: number, frequency: Frequency): string {
  const { y, m } = parseStart(start);
  let d: Date;
  if (frequency === 'monthly') d = new Date(Date.UTC(y, m + index, 1));
  else d = new Date(Date.UTC(y, m, 1) + index * (frequency === 'weekly' ? 7 : 14) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Period (1-based) in which a prepayment made in loan month `month` lands. */
export function periodForMonth(month: number, frequency: Frequency): number {
  if (frequency === 'monthly') return Math.max(1, Math.round(month));
  return Math.max(1, Math.ceil((Math.round(month) * PERIODS_PER_YEAR[frequency]) / 12));
}

/** Months covered by `periods` payments at a frequency (for the "months saved" figure). */
export function periodsToMonths(periods: number, frequency: Frequency): number {
  return (periods * 12) / PERIODS_PER_YEAR[frequency];
}

const EPS = 1e-7;

function simulate(input: LoanInput, withPrepayment: boolean): { rows: ScheduleRow[]; instalment: number; periods: number } {
  const n = periodCount(input.years, input.months, input.frequency);
  const r = periodRate(input.rate, input.frequency);
  const P = Math.max(0, input.amount);
  const instalment = emi(P, r, n);
  const rows: ScheduleRow[] = [];
  if (P <= 0 || n === 0) return { rows, instalment, periods: n };

  const ppy = PERIODS_PER_YEAR[input.frequency];
  const extraPerPeriod = withPrepayment ? (Math.max(0, input.extraMonthly) * 12) / ppy : 0;
  const lumpPeriod = periodForMonth(input.lumpMonth, input.frequency);
  const lump = withPrepayment ? Math.max(0, input.lumpSum) : 0;

  let balance = P;
  // Hard cap guards against a rate so high that the instalment never covers interest (cannot
  // happen with the annuity formula, but keeps the loop finite on bad input).
  for (let i = 1; i <= n && balance > EPS; i++) {
    const interest = balance * r;
    let payment = instalment;
    let principal = payment - interest;
    if (principal >= balance - EPS || i === n) {
      // Final payment: settle the exact remaining balance.
      principal = balance;
      payment = principal + interest;
    }
    balance -= principal;
    let extra = extraPerPeriod + (i === lumpPeriod ? lump : 0);
    if (extra > balance) extra = balance;
    balance -= extra;
    if (balance < EPS) balance = 0;
    rows.push({ period: i, date: paymentDate(input.start, i - 1, input.frequency), payment, principal, interest, extra, balance });
  }
  return { rows, instalment, periods: n };
}

export function calculate(input: LoanInput): LoanResult {
  const withPre = simulate(input, true);
  const base = simulate(input, false);
  const sum = (rows: ScheduleRow[], k: 'payment' | 'interest' | 'extra') => rows.reduce((t, row) => t + row[k], 0);
  const totalInterest = sum(withPre.rows, 'interest');
  const baseInterest = sum(base.rows, 'interest');
  const periodsSaved = Math.max(0, base.rows.length - withPre.rows.length);
  return {
    instalment: withPre.instalment,
    periods: withPre.periods,
    rows: withPre.rows,
    totalInterest,
    totalPaid: sum(withPre.rows, 'payment') + sum(withPre.rows, 'extra'),
    payoffDate: withPre.rows.at(-1)?.date ?? null,
    baseline: { totalInterest: baseInterest, periods: base.rows.length, payoffDate: base.rows.at(-1)?.date ?? null },
    interestSaved: Math.max(0, baseInterest - totalInterest),
    periodsSaved,
    monthsSaved: periodsToMonths(periodsSaved, input.frequency),
  };
}

/** Group a schedule by loan year (every `periodsPerYear` payments). */
export function yearly(rows: readonly ScheduleRow[], frequency: Frequency): YearRow[] {
  const ppy = PERIODS_PER_YEAR[frequency];
  const out: YearRow[] = [];
  for (let i = 0; i < rows.length; i += ppy) {
    const chunk = rows.slice(i, i + ppy);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    out.push({
      year: out.length + 1,
      from: first.date,
      to: last.date,
      payment: chunk.reduce((t, r) => t + r.payment, 0),
      principal: chunk.reduce((t, r) => t + r.principal, 0),
      interest: chunk.reduce((t, r) => t + r.interest, 0),
      extra: chunk.reduce((t, r) => t + r.extra, 0),
      balance: last.balance,
    });
  }
  return out;
}

// --- formatting --------------------------------------------------------------

export function currencyLocale(code: CurrencyCode): string {
  return CURRENCIES.find((c) => c.code === code)?.locale ?? 'en-US';
}

export function formatMoney(value: number, code: CurrencyCode, fractionDigits?: number): string {
  const digits = fractionDigits ?? (code === 'JPY' ? 0 : 2);
  return new Intl.NumberFormat(currencyLocale(code), { style: 'currency', currency: code, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

/** Compact money for chart labels, e.g. $1.2M or ₹12L style grouping is left to Intl. */
export function formatMoneyCompact(value: number, code: CurrencyCode): string {
  return new Intl.NumberFormat(currencyLocale(code), { style: 'currency', currency: code, notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export function formatDuration(months: number): string {
  const total = Math.round(months);
  const y = Math.floor(total / 12);
  const m = total % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} ${y === 1 ? 'year' : 'years'}`);
  if (m || !y) parts.push(`${m} ${m === 1 ? 'month' : 'months'}`);
  return parts.join(' ');
}

export function formatMonthYear(iso: string | null, locale = 'en-GB'): string {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', day: undefined, timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** CSV of the schedule with plain two-decimal numbers (no currency symbols, for spreadsheets). */
export function scheduleCsv(rows: readonly ScheduleRow[]): string {
  const f = (n: number) => n.toFixed(2);
  const lines = ['Period,Date,Payment,Principal,Interest,Extra,Balance'];
  for (const r of rows) lines.push([r.period, r.date, f(r.payment), f(r.principal), f(r.interest), f(r.extra), f(r.balance)].join(','));
  return lines.join('\n') + '\n';
}

// --- persistence -------------------------------------------------------------

const KEYS: Record<keyof LoanInput, string> = {
  amount: 'a',
  rate: 'r',
  years: 'y',
  months: 'm',
  start: 'start',
  frequency: 'f',
  extraMonthly: 'x',
  lumpSum: 'l',
  lumpMonth: 'lm',
  currency: 'c',
};

const NUMERIC: (keyof LoanInput)[] = ['amount', 'rate', 'years', 'months', 'extraMonthly', 'lumpSum', 'lumpMonth'];

/** Validate and clamp any partial input, falling back to defaults field by field. */
export function sanitize(raw: Partial<Record<keyof LoanInput, unknown>>, base: LoanInput = DEFAULT_INPUT): LoanInput {
  const out: LoanInput = { ...base };
  for (const k of NUMERIC) {
    const v = typeof raw[k] === 'string' ? Number(raw[k]) : raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      const lim = LIMITS[k as keyof typeof LIMITS];
      (out as unknown as Record<string, number>)[k] = clamp(v, lim.min, lim.max);
    }
  }
  if (typeof raw.start === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw.start)) out.start = raw.start;
  if (raw.frequency === 'monthly' || raw.frequency === 'fortnightly' || raw.frequency === 'weekly') out.frequency = raw.frequency;
  if (typeof raw.currency === 'string' && CURRENCIES.some((c) => c.code === raw.currency)) out.currency = raw.currency as CurrencyCode;
  out.years = Math.round(out.years);
  out.months = Math.round(out.months);
  out.lumpMonth = Math.round(out.lumpMonth);
  return out;
}

/** Query string holding only the fields that differ from the defaults. */
export function toQuery(input: LoanInput): string {
  const params = new URLSearchParams();
  for (const k of Object.keys(KEYS) as (keyof LoanInput)[]) {
    if (k === 'start') {
      params.set(KEYS[k], input.start);
      continue;
    }
    if (input[k] !== DEFAULT_INPUT[k]) params.set(KEYS[k], String(input[k]));
  }
  return params.toString();
}

export function fromQuery(query: string): Partial<Record<keyof LoanInput, unknown>> {
  const params = new URLSearchParams(query);
  const out: Partial<Record<keyof LoanInput, unknown>> = {};
  for (const [k, short] of Object.entries(KEYS) as [keyof LoanInput, string][]) {
    const v = params.get(short);
    if (v !== null) out[k] = v;
  }
  return out;
}
