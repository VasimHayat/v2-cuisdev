import { describe, expect, it } from 'vitest';
import { DEFAULTS, bmi, bmiPrime, categoryFor, cmToFeetInches, feetInchesToCm, healthyRangeKg, kgToStoneLb, lbToKg, notesFor, readMeasurements, scalePosition, syncUnits } from './logic';

describe('BMI', () => {
  it('computes BMI and prime', () => {
    expect(bmi(72, 175)).toBeCloseTo(23.51, 2);
    expect(bmiPrime(25)).toBe(1);
  });
  it('classifies at the rounded boundaries', () => {
    expect(categoryFor(18.44).id).toBe('under');
    expect(categoryFor(18.49).id).toBe('healthy');
    expect(categoryFor(18.46).id).toBe('healthy');
    expect(categoryFor(24.94).id).toBe('healthy');
    expect(categoryFor(24.96).id).toBe('over');
    expect(categoryFor(30).id).toBe('obese1');
    expect(categoryFor(45).id).toBe('obese3');
  });
  it('gives the healthy weight range for a height', () => {
    const [lo, hi] = healthyRangeKg(175);
    expect(lo).toBeCloseTo(56.66, 1);
    expect(hi).toBeCloseTo(76.26, 1);
  });
});

describe('units', () => {
  it('converts feet and inches both ways', () => {
    expect(feetInchesToCm(5, 9)).toBeCloseTo(175.26, 2);
    expect(cmToFeetInches(175)).toEqual({ ft: 5, in: 8.9 });
    expect(cmToFeetInches(182.88)).toEqual({ ft: 6, in: 0 });
  });
  it('converts pounds and stones', () => {
    expect(lbToKg(159)).toBeCloseTo(72.12, 2);
    expect(kgToStoneLb(72)).toEqual({ st: 11, lb: 4.7 });
  });
  it('reads metric and imperial input', () => {
    expect(readMeasurements(DEFAULTS)).toMatchObject({ ok: true, m: { heightCm: 175, weightKg: 72 } });
    const imp = readMeasurements({ ...DEFAULTS, units: 'imperial' });
    expect(imp.ok && bmi(imp.m.weightKg, imp.m.heightCm)).toBeCloseTo(23.5, 1);
    const st = readMeasurements({ ...DEFAULTS, units: 'imperial', wunit: 'st', st: '11', stlb: '5' });
    expect(st.ok && st.m.weightKg).toBeCloseTo(72.12, 1);
  });
  it('rejects implausible values and stays quiet when empty', () => {
    expect(readMeasurements({ ...DEFAULTS, cm: '17' })).toMatchObject({ ok: false, error: expect.stringContaining('Height') });
    expect(readMeasurements({ ...DEFAULTS, kg: '2' })).toMatchObject({ ok: false, error: expect.stringContaining('Weight') });
    expect(readMeasurements({ ...DEFAULTS, kg: '' })).toEqual({ ok: false, error: null });
    expect(readMeasurements({ ...DEFAULTS, kg: '7O' })).toMatchObject({ ok: false });
  });
  it('mirrors measurements into the other system', () => {
    expect(syncUnits(DEFAULTS, { heightCm: 175, weightKg: 72 })).toMatchObject({ ft: '5', in: '8.9', lb: '158.7', st: '11', stlb: '4.7' });
  });
});

describe('scale and notes', () => {
  it('positions the marker on a 15 to 40 scale', () => {
    expect(scalePosition(15)).toBe(0);
    expect(scalePosition(27.5)).toBe(50);
    expect(scalePosition(50)).toBe(100);
  });
  it('adds notes for children and older adults', () => {
    expect(notesFor('12', '')[0]).toMatch(/percentiles/);
    expect(notesFor('70', 'f')).toHaveLength(2);
    expect(notesFor('', '')).toEqual([]);
  });
});
