import { describe, expect, it } from 'vitest';
import {
  DEFAULTS,
  calculate,
  compactMoney,
  doublingTime,
  effectiveAnnualRate,
  formatMoney,
  monthlyFactor,
  niceMax,
  parseInputs,
  rowsToCsv,
  type Inputs,
} from './logic';

const base: Inputs = {
  principal: 0,
  contribution: 0,
  frequency: 'monthly',
  timing: 'end',
  rate: 0.05,
  compounding: 'annual',
  years: 10,
  increase: 0,
  inflation: 0,
  currency: 'USD',
};

describe('lump sum', () => {
  it('matches A = P(1 + r/n)^(nt) for every discrete compounding', () => {
    for (const [compounding, n] of [['annual', 1], ['semiannual', 2], ['quarterly', 4], ['monthly', 12], ['daily', 365]] as const) {
      const r = calculate({ ...base, principal: 1000, compounding });
      expect(r.finalBalance).toBeCloseTo(1000 * (1 + 0.05 / n) ** (n * 10), 6);
    }
  });
  it('matches P e^(rt) for continuous compounding', () => {
    expect(calculate({ ...base, principal: 1000, compounding: 'continuous' }).finalBalance).toBeCloseTo(1648.7213, 3);
  });
  it('is flat at a zero rate', () => {
    const r = calculate({ ...base, principal: 500, contribution: 10, rate: 0, compounding: 'monthly' });
    expect(r.finalBalance).toBeCloseTo(500 + 10 * 120, 9);
    expect(r.totalInterest).toBeCloseTo(0, 9);
  });
});

describe('regular contributions', () => {
  const i = 0.06 / 12;
  const annuity = 100 * (((1 + i) ** 120 - 1) / i);
  it('monthly deposits at the end equal the ordinary annuity formula', () => {
    const r = calculate({ ...base, contribution: 100, rate: 0.06, compounding: 'monthly' });
    expect(r.finalBalance).toBeCloseTo(annuity, 6);
    expect(r.finalBalance).toBeCloseTo(16387.93, 2);
    expect(r.totalContributions).toBeCloseTo(12000, 9);
  });
  it('deposits at the start equal the annuity-due formula', () => {
    const r = calculate({ ...base, contribution: 100, rate: 0.06, compounding: 'monthly', timing: 'start' });
    expect(r.finalBalance).toBeCloseTo(annuity * (1 + i), 6);
  });
  it('quarterly deposits with monthly compounding use the effective quarterly rate', () => {
    const q = (1 + 0.06 / 12) ** 3 - 1;
    const r = calculate({ ...base, contribution: 300, frequency: 'quarterly', rate: 0.06, compounding: 'monthly' });
    expect(r.finalBalance).toBeCloseTo(300 * (((1 + q) ** 40 - 1) / q), 6);
  });
  it('yearly deposits with annual compounding match the textbook value', () => {
    const r = calculate({ ...base, contribution: 1000, frequency: 'yearly', compounding: 'annual' });
    expect(r.finalBalance).toBeCloseTo(12577.89, 2);
  });
  it('raises the contribution each year when an increase is set', () => {
    const r = calculate({ ...base, contribution: 100, frequency: 'yearly', rate: 0, increase: 0.1, years: 3 });
    expect(r.rows.map((x) => Math.round(x.contributions * 100) / 100)).toEqual([100, 110, 121]);
    expect(r.totalContributions).toBeCloseTo(331, 9);
  });
});

describe('rows, inflation and derived figures', () => {
  it('builds consistent yearly rows', () => {
    const r = calculate({ ...base, principal: 1000, contribution: 50, rate: 0.07, compounding: 'monthly', years: 5 });
    expect(r.rows).toHaveLength(5);
    const last = r.rows[4]!;
    expect(last.totalDeposited + last.totalInterest).toBeCloseTo(last.balance, 6);
    expect(r.rows.reduce((s, x) => s + x.interest, 0)).toBeCloseTo(r.totalInterest, 6);
    expect(r.principal + r.totalContributions + r.totalInterest).toBeCloseTo(r.finalBalance, 6);
  });
  it('deflates by inflation for the real value', () => {
    const r = calculate({ ...base, principal: 1000, rate: 0.05, inflation: 0.02, compounding: 'annual' });
    expect(r.realFinalBalance).toBeCloseTo(r.finalBalance / 1.02 ** 10, 6);
  });
  it('computes APY, monthly factors and doubling time', () => {
    expect(effectiveAnnualRate(0.12, 'monthly')).toBeCloseTo(0.126825, 6);
    expect(effectiveAnnualRate(0.05, 'continuous')).toBeCloseTo(Math.exp(0.05) - 1, 12);
    expect(monthlyFactor(0.12, 'annual') ** 12).toBeCloseTo(1.12, 12);
    const d = doublingTime(0.07, 'annual')!;
    expect(d.rule72).toBeCloseTo(10.2857, 3);
    expect(d.exact).toBeCloseTo(10.2448, 3);
    expect(doublingTime(0, 'annual')).toBeNull();
  });
});

describe('input parsing and formatting', () => {
  it('parses the defaults cleanly', () => {
    const { inputs, errors } = parseInputs(DEFAULTS);
    expect(errors).toEqual({});
    expect(inputs).toMatchObject({ principal: 10000, contribution: 200, rate: 0.07, years: 20, inflation: 0.025, frequency: 'monthly', timing: 'end' });
  });
  it('reports bad fields and clamps them', () => {
    const { inputs, errors } = parseInputs({ ...DEFAULTS, rate: 'abc', years: '75', principal: '1.234,5', contribution: '', freq: 'weekly' });
    expect(errors.rate).toMatch(/number/);
    expect(errors.years).toMatch(/between 1 and 60/);
    expect(inputs.years).toBe(60);
    expect(inputs.principal).toBe(1234.5);
    expect(inputs.contribution).toBe(0);
    expect(inputs.frequency).toBe('monthly');
    expect(parseInputs({ ...DEFAULTS, years: '2.5' }).errors.years).toMatch(/whole number/);
  });
  it('formats money, compact labels, nice maxima and CSV', () => {
    expect(formatMoney(1234567.891, 'INR')).toBe('₹12,34,567.89');
    expect(formatMoney(1500, 'JPY')).toMatch(/1,500/);
    expect(compactMoney(2_500_000, 'INR')).toBe('25L');
    expect(compactMoney(12_345, 'USD')).toBe('12.3k');
    expect(niceMax(87_000)).toBe(100_000);
    expect(niceMax(130)).toBe(150);
    const csv = rowsToCsv(calculate({ ...base, principal: 100, years: 2 }).rows);
    expect(csv.split('\n')[0]).toBe('Year,Contributions,Interest,End balance,Real balance,Total deposited,Total interest');
    expect(csv.split('\n')[2]).toBe('2,0.00,5.25,110.25,110.25,100.00,10.25');
  });
});
