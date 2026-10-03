import { describe, expect, it } from 'vitest';
import { decreaseBy, increaseBy, percentChange, percentDifference, percentOf, pointsVsPercent, wholeFromPart, whatPercent } from './logic';

const val = (o: { ok: boolean } & Partial<{ value: number }>) => (o.ok ? o.value : NaN);

describe('percentage calculators', () => {
  it('computes X% of Y', () => {
    expect(val(percentOf('15', '240'))).toBeCloseTo(36);
    expect(percentOf('15', '240')).toMatchObject({ working: '15 ÷ 100 × 240 = 36' });
  });
  it('computes X as a percent of Y and guards zero', () => {
    expect(val(whatPercent('36', '480'))).toBeCloseTo(7.5);
    expect(whatPercent('5', '0')).toMatchObject({ ok: false, error: expect.stringContaining('cannot be 0') });
  });
  it('finds the whole from a part and a percent', () => {
    expect(val(wholeFromPart('45', '15'))).toBeCloseTo(300);
    expect(wholeFromPart('45', '0')).toMatchObject({ ok: false });
  });
  it('words percentage change as increase or decrease', () => {
    expect(percentChange('80', '100')).toMatchObject({ direction: 'increase', outcome: { display: '25% increase' } });
    expect(percentChange('100', '80')).toMatchObject({ direction: 'decrease', outcome: { display: '20% decrease' } });
    expect(percentChange('50', '50')).toMatchObject({ direction: 'none' });
    expect(percentChange('0', '5').outcome.ok).toBe(false);
    expect(val(percentChange('-50', '-25').outcome)).toBeCloseTo(50);
  });
  it('increases and decreases by a percent', () => {
    expect(val(increaseBy('1200', '8'))).toBeCloseTo(1296);
    expect(val(decreaseBy('1200', '8'))).toBeCloseTo(1104);
  });
  it('computes the symmetric percentage difference', () => {
    expect(val(percentDifference('120', '150'))).toBeCloseTo(22.2222, 3);
    expect(val(percentDifference('150', '120'))).toBeCloseTo(22.2222, 3);
    expect(percentDifference('0', '0').ok).toBe(false);
  });
  it('separates percentage points from relative percent', () => {
    const r = pointsVsPercent('4', '5');
    expect(r.points).toMatchObject({ value: 1, display: '+1 percentage points' });
    expect(val(r.relative)).toBeCloseTo(25);
  });
  it('accepts comma decimals and flags junk, and stays quiet when empty', () => {
    expect(val(percentOf('12,5', '80'))).toBeCloseTo(10);
    expect(percentOf('abc', '80')).toMatchObject({ ok: false, error: expect.stringContaining('numbers only') });
    expect(percentOf('', '80')).toEqual({ ok: false, error: null });
  });
});
