import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INPUT,
  calculate,
  emi,
  formatDuration,
  formatMoney,
  fromQuery,
  paymentDate,
  periodCount,
  periodForMonth,
  periodRate,
  sanitize,
  scheduleCsv,
  toQuery,
  yearly,
  type LoanInput,
} from './logic';

const base: LoanInput = { ...DEFAULT_INPUT, amount: 100_000, rate: 12, years: 1, months: 0, start: '2026-01', frequency: 'monthly', extraMonthly: 0, lumpSum: 0, lumpMonth: 6, currency: 'USD' };

describe('emi', () => {
  it('matches the standard annuity formula', () => {
    // 100,000 at 12% a year over 12 months: 8,884.88
    expect(emi(100_000, 0.01, 12)).toBeCloseTo(8884.8788, 3);
    // 250,000 at 7.5% over 20 years: 2,013.98
    expect(emi(250_000, periodRate(7.5, 'monthly'), 240)).toBeCloseTo(2013.98, 2);
  });
  it('handles a zero rate and empty loans', () => {
    expect(emi(12_000, 0, 12)).toBe(1000);
    expect(emi(0, 0.01, 12)).toBe(0);
    expect(emi(1000, 0.01, 0)).toBe(0);
  });
  it('counts periods per frequency', () => {
    expect(periodCount(1, 0, 'monthly')).toBe(12);
    expect(periodCount(1, 6, 'monthly')).toBe(18);
    expect(periodCount(2, 0, 'fortnightly')).toBe(52);
    expect(periodCount(1, 0, 'weekly')).toBe(52);
    expect(periodCount(0, 0, 'monthly')).toBe(0);
  });
});

describe('schedule', () => {
  it('amortises to exactly zero with consistent totals', () => {
    const r = calculate(base);
    expect(r.rows).toHaveLength(12);
    expect(r.rows.at(-1)!.balance).toBe(0);
    const principal = r.rows.reduce((t, row) => t + row.principal + row.extra, 0);
    expect(principal).toBeCloseTo(100_000, 6);
    expect(r.totalInterest).toBeCloseTo(8884.8788 * 12 - 100_000, 2);
    expect(r.totalPaid).toBeCloseTo(100_000 + r.totalInterest, 6);
    expect(r.rows[0]!.interest).toBeCloseTo(1000, 6);
    expect(r.payoffDate).toBe('2026-12-01');
  });
  it('has no interest at a zero rate', () => {
    const r = calculate({ ...base, rate: 0 });
    expect(r.totalInterest).toBe(0);
    expect(r.rows.every((row) => Math.abs(row.payment - 100_000 / 12) < 1e-9)).toBe(true);
  });
  it('shortens the loan and saves interest with prepayments', () => {
    const plain = calculate({ ...base, years: 20, rate: 7.5, amount: 250_000 });
    const extra = calculate({ ...base, years: 20, rate: 7.5, amount: 250_000, extraMonthly: 200 });
    expect(extra.rows.length).toBeLessThan(plain.rows.length);
    expect(extra.interestSaved).toBeGreaterThan(0);
    expect(extra.interestSaved).toBeCloseTo(plain.totalInterest - extra.totalInterest, 6);
    expect(extra.monthsSaved).toBe(plain.rows.length - extra.rows.length);
    expect(extra.rows.at(-1)!.balance).toBe(0);
  });
  it('applies a lump sum in the chosen month and caps it at the balance', () => {
    const r = calculate({ ...base, lumpSum: 50_000, lumpMonth: 3 });
    expect(r.rows[2]!.extra).toBe(50_000);
    expect(r.rows[1]!.extra).toBe(0);
    const big = calculate({ ...base, lumpSum: 1_000_000, lumpMonth: 2 });
    expect(big.rows).toHaveLength(2);
    expect(big.rows[1]!.balance).toBe(0);
    expect(big.rows[1]!.extra).toBeLessThan(100_000);
  });
  it('supports fortnightly and weekly payments', () => {
    const f = calculate({ ...base, frequency: 'fortnightly' });
    expect(f.rows).toHaveLength(26);
    expect(f.rows.at(-1)!.balance).toBe(0);
    expect(f.rows[1]!.date).toBe('2026-01-15');
    const w = calculate({ ...base, frequency: 'weekly', extraMonthly: 520 });
    // 520 a month spread over 52 weeks a year is 120 a week
    expect(w.rows[0]!.extra).toBeCloseTo(120, 9);
    expect(periodForMonth(6, 'weekly')).toBe(26);
  });
  it('groups the schedule by loan year', () => {
    const r = calculate({ ...base, years: 2, months: 6, extraMonthly: 100 });
    const years = yearly(r.rows, 'monthly');
    expect(years).toHaveLength(3);
    expect(years[2]!.from).toBe('2028-01-01');
    expect(years.at(-1)!.balance).toBe(0);
    const total = years.reduce((t, y) => t + y.principal + y.extra, 0);
    expect(total).toBeCloseTo(100_000, 6);
    expect(years[0]!.extra).toBeCloseTo(1200, 9);
    expect(years[0]!.principal + years[0]!.interest).toBeCloseTo(years[0]!.payment, 6);
  });
});

describe('formatting and persistence', () => {
  it('formats money per currency', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(1234567, 'INR', 0)).toBe('₹12,34,567');
    expect(formatMoney(1234.6, 'JPY')).toBe('￥1,235');
  });
  it('formats durations and dates', () => {
    expect(formatDuration(30)).toBe('2 years 6 months');
    expect(formatDuration(12)).toBe('1 year');
    expect(formatDuration(0)).toBe('0 months');
    expect(paymentDate('2026-11', 2, 'monthly')).toBe('2027-01-01');
  });
  it('round-trips through the query string and sanitises bad values', () => {
    const input = { ...base, extraMonthly: 150, currency: 'EUR' as const };
    expect(sanitize(fromQuery(toQuery(input)), base)).toEqual(input);
    const bad = sanitize({ amount: '-5', rate: 'abc', years: 99, start: '2026-13', frequency: 'daily', currency: 'XYZ' });
    expect(bad.amount).toBe(0);
    expect(bad.rate).toBe(DEFAULT_INPUT.rate);
    expect(bad.years).toBe(50);
    expect(bad.start).toBe(DEFAULT_INPUT.start);
    expect(bad.frequency).toBe('monthly');
    expect(bad.currency).toBe('USD');
  });
  it('writes a plain CSV', () => {
    const csv = scheduleCsv(calculate(base).rows).split('\n');
    expect(csv[0]).toBe('Period,Date,Payment,Principal,Interest,Extra,Balance');
    expect(csv[1]).toBe('1,2026-01-01,8884.88,7884.88,1000.00,0.00,92115.12');
    expect(csv[12]?.endsWith(',0.00')).toBe(true);
  });
});
