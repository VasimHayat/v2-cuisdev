import { describe, expect, it } from 'vitest';
import { calculateTip, comparisonTable, currencyDigits, formatMoney, type TipInput } from './logic';

const base: TipInput = { bill: '84.50', tipPercent: '18', people: '1', taxMode: 'none', tax: '', tipBase: 'post', rounding: 'none', currency: 'USD' };
const calc = (patch: Partial<TipInput>) => {
  const r = calculateTip({ ...base, ...patch });
  if (!r.ok) throw new Error(String(r.error));
  return r.result;
};

describe('tip calculator', () => {
  it('computes tip and total in cents', () => {
    const r = calc({});
    expect(r.tip).toBe(15.21);
    expect(r.total).toBe(99.71);
  });
  it('splits between people', () => {
    const r = calc({ people: '3', bill: '100', tipPercent: '20' });
    expect(r.total).toBe(120);
    expect(r.perPersonTotal).toBe(40);
    expect(r.perPersonTip).toBeCloseTo(6.6667, 3);
  });
  it('tips on the pre-tax amount from a tax amount or percent', () => {
    const amount = calc({ bill: '110', taxMode: 'amount', tax: '10', tipBase: 'pre', tipPercent: '20' });
    expect(amount.preTax).toBe(100);
    expect(amount.tip).toBe(20);
    expect(amount.total).toBe(130);
    const pct = calc({ bill: '110', taxMode: 'percent', tax: '10', tipBase: 'pre', tipPercent: '20' });
    expect(pct.tax).toBe(10);
    expect(pct.tip).toBe(20);
  });
  it('rounds the total or each share up', () => {
    const total = calc({ rounding: 'total' });
    expect(total.total).toBe(100);
    expect(total.tip).toBe(15.5);
    expect(total.roundingExtra).toBeCloseTo(0.29, 2);
    const person = calc({ people: '3', rounding: 'person' });
    expect(person.perPersonTotal).toBe(34);
    expect(person.total).toBe(102);
  });
  it('shows uneven splits so shares add up to the cent', () => {
    const r = calc({ people: '2' });
    expect(r.total).toBe(99.71);
    expect(r).toMatchObject({ shareLow: 49.85, shareHigh: 49.86, highCount: 1 });
    expect(calc({ people: '4', bill: '100', tipPercent: '20' }).highCount).toBe(0);
  });
  it('uses whole units for yen', () => {
    expect(currencyDigits('JPY')).toBe(0);
    const r = calc({ currency: 'JPY', bill: '4380', tipPercent: '15' });
    expect(r.tip).toBe(657);
    expect(formatMoney(657, 'JPY', 'en-US')).toBe('¥657');
  });
  it('validates input', () => {
    expect(calculateTip({ ...base, bill: '' })).toEqual({ ok: false, error: null });
    expect(calculateTip({ ...base, bill: 'abc' })).toMatchObject({ ok: false });
    expect(calculateTip({ ...base, people: '0' })).toMatchObject({ ok: false, error: expect.stringContaining('people') });
    expect(calculateTip({ ...base, people: '1.5' })).toMatchObject({ ok: false });
    expect(calculateTip({ ...base, tipPercent: '120' })).toMatchObject({ ok: false });
    expect(calculateTip({ ...base, taxMode: 'amount', tax: '200' })).toMatchObject({ ok: false });
  });
  it('accepts comma decimals', () => {
    expect(calc({ bill: '84,50' }).total).toBe(99.71);
  });
  it('builds a comparison table', () => {
    const rows = comparisonTable({ ...base, bill: '100', people: '4' });
    expect(rows.map((r) => r.percent)).toEqual([10, 12.5, 15, 18, 20, 22, 25]);
    expect(rows[0]).toMatchObject({ tip: 10, total: 110, perPerson: 27.5 });
  });
});
