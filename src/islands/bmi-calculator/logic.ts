/**
 * BMI calculations and unit conversion: pure, no DOM. Uses the WHO adult categories.
 */
import { parseNumber, round } from '../calc-kit/numbers';

export const CM_PER_INCH = 2.54;
export const KG_PER_LB = 0.45359237;
export const LB_PER_STONE = 14;

export type UnitSystem = 'metric' | 'imperial';
export type ImperialWeight = 'lb' | 'st';

export interface Category {
  id: 'under' | 'healthy' | 'over' | 'obese1' | 'obese2' | 'obese3';
  label: string;
  range: string;
  min: number;
  max: number;
  tone: 'warning' | 'success' | 'danger';
}

export const CATEGORIES: Category[] = [
  { id: 'under', label: 'Underweight', range: 'below 18.5', min: 0, max: 18.5, tone: 'warning' },
  { id: 'healthy', label: 'Healthy weight', range: '18.5 to 24.9', min: 18.5, max: 25, tone: 'success' },
  { id: 'over', label: 'Overweight', range: '25 to 29.9', min: 25, max: 30, tone: 'warning' },
  { id: 'obese1', label: 'Obesity class I', range: '30 to 34.9', min: 30, max: 35, tone: 'danger' },
  { id: 'obese2', label: 'Obesity class II', range: '35 to 39.9', min: 35, max: 40, tone: 'danger' },
  { id: 'obese3', label: 'Obesity class III', range: '40 and above', min: 40, max: Infinity, tone: 'danger' },
];

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Category for a BMI already rounded to one decimal, as charts show it. */
export function categoryFor(value: number): Category {
  const v = round(value, 1);
  return CATEGORIES.find((c) => v >= c.min && v < c.max) ?? CATEGORIES[CATEGORIES.length - 1]!;
}

/** Weight range (kg) for BMI 18.5 to 24.9 at this height. */
export function healthyRangeKg(heightCm: number): [number, number] {
  const m2 = (heightCm / 100) ** 2;
  return [18.5 * m2, 24.9 * m2];
}

/** BMI Prime: BMI divided by the upper healthy limit of 25. */
export function bmiPrime(value: number): number {
  return value / 25;
}

export function feetInchesToCm(ft: number, inch: number): number {
  return (ft * 12 + inch) * CM_PER_INCH;
}

export function cmToFeetInches(cm: number): { ft: number; in: number } {
  const totalIn = cm / CM_PER_INCH;
  let ft = Math.floor(totalIn / 12);
  let inch = round(totalIn - ft * 12, 1);
  if (inch >= 12) {
    ft += 1;
    inch = 0;
  }
  return { ft, in: inch };
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

export function kgToStoneLb(kg: number): { st: number; lb: number } {
  const totalLb = kgToLb(kg);
  let st = Math.floor(totalLb / LB_PER_STONE);
  let lb = round(totalLb - st * LB_PER_STONE, 1);
  if (lb >= LB_PER_STONE) {
    st += 1;
    lb = 0;
  }
  return { st, lb };
}

/** Marker position on a 15 to 40 BMI scale, as a percentage 0 to 100. */
export function scalePosition(value: number, min = 15, max = 40): number {
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export const DEFAULTS = {
  units: 'metric',
  cm: '175',
  kg: '72',
  ft: '5',
  in: '9',
  lb: '159',
  wunit: 'lb',
  st: '11',
  stlb: '5',
  age: '',
  sex: '',
};
export type BmiState = typeof DEFAULTS;

export interface Measurements {
  heightCm: number;
  weightKg: number;
}

export type MeasureOutcome = { ok: true; m: Measurements } | { ok: false; error: string | null };

/** Read height and weight from whichever unit system is active, with sanity ranges. */
export function readMeasurements(s: BmiState): MeasureOutcome {
  let heightCm: number;
  let weightKg: number;
  if (s.units === 'imperial') {
    if (s.ft.trim() === '' && s.in.trim() === '') return { ok: false, error: null };
    const ft = s.ft.trim() === '' ? 0 : parseNumber(s.ft);
    const inch = s.in.trim() === '' ? 0 : parseNumber(s.in);
    if (Number.isNaN(ft) || Number.isNaN(inch)) return { ok: false, error: 'Height must be numbers, for example 5 ft 9 in.' };
    heightCm = feetInchesToCm(ft, inch);
    if (s.wunit === 'st') {
      if (s.st.trim() === '' && s.stlb.trim() === '') return { ok: false, error: null };
      const st = s.st.trim() === '' ? 0 : parseNumber(s.st);
      const lb = s.stlb.trim() === '' ? 0 : parseNumber(s.stlb);
      if (Number.isNaN(st) || Number.isNaN(lb)) return { ok: false, error: 'Weight must be numbers, for example 11 st 5 lb.' };
      weightKg = lbToKg(st * LB_PER_STONE + lb);
    } else {
      if (s.lb.trim() === '') return { ok: false, error: null };
      const lb = parseNumber(s.lb);
      if (Number.isNaN(lb)) return { ok: false, error: 'Weight must be a number of pounds.' };
      weightKg = lbToKg(lb);
    }
  } else {
    if (s.cm.trim() === '' || s.kg.trim() === '') return { ok: false, error: null };
    heightCm = parseNumber(s.cm);
    weightKg = parseNumber(s.kg);
    if (Number.isNaN(heightCm) || Number.isNaN(weightKg)) return { ok: false, error: 'Enter height in centimetres and weight in kilograms.' };
  }
  if (heightCm < 50 || heightCm > 272) return { ok: false, error: 'Height should be between 50 cm (1 ft 8 in) and 272 cm (8 ft 11 in).' };
  if (weightKg < 10 || weightKg > 650) return { ok: false, error: 'Weight should be between 10 kg (22 lb) and 650 kg (1,433 lb).' };
  return { ok: true, m: { heightCm, weightKg } };
}

/** Mirror the current measurements into the other unit system's fields. */
export function syncUnits(s: BmiState, m: Measurements): Partial<BmiState> {
  const fi = cmToFeetInches(m.heightCm);
  const sl = kgToStoneLb(m.weightKg);
  return {
    cm: String(round(m.heightCm, 1)),
    kg: String(round(m.weightKg, 1)),
    ft: String(fi.ft),
    in: String(fi.in),
    lb: String(round(kgToLb(m.weightKg), 1)),
    st: String(sl.st),
    stlb: String(sl.lb),
  };
}

/** Short explanatory notes depending on optional age and sex. */
export function notesFor(ageRaw: string, sex: string): string[] {
  const notes: string[] = [];
  const age = parseNumber(ageRaw);
  if (!Number.isNaN(age)) {
    if (age < 2) notes.push('BMI is not used for children under 2.');
    else if (age < 20) notes.push('For ages 2 to 19, BMI is judged against age and sex percentiles, which this calculator does not compute. Use the adult categories with caution.');
    else if (age >= 65) notes.push('Over 65, a slightly higher BMI (around 23 to 30) is often linked with better health, because muscle and bone mass decline with age.');
  }
  if (sex === 'f') notes.push('At the same BMI, women typically carry more body fat than men; the categories are the same for both.');
  if (sex === 'm') notes.push('At the same BMI, men typically carry more muscle than women; the categories are the same for both.');
  return notes;
}
