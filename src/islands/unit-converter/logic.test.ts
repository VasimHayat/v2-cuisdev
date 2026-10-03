import { describe, expect, it } from 'vitest';
import {
  CATEGORIES,
  UnitError,
  convert,
  describeFormula,
  findUnit,
  formatNumber,
  getCategory,
  getUnit,
  groupDigits,
  parseNumber,
  parseQuantity,
  queryToState,
  sanitizeState,
  search,
  splitScientific,
  stateToQuery,
  type Category,
  type Unit,
} from './logic';

const cat = (id: string): Category => getCategory(id)!;
const unit = (c: string, id: string): Unit => getUnit(cat(c), id)!;
const conv = (v: number, c: string, a: string, b: string) => convert(v, unit(c, a), unit(c, b));

describe('catalogue', () => {
  it('has the required categories with unique unit ids and valid defaults', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual(['length', 'mass', 'temperature', 'area', 'volume', 'speed', 'time', 'data', 'pressure', 'energy', 'power', 'angle', 'fuel', 'frequency']);
    for (const c of CATEGORIES) {
      expect(new Set(c.units.map((x) => x.id)).size).toBe(c.units.length);
      expect(getUnit(c, c.defaults[0])).toBeDefined();
      expect(getUnit(c, c.defaults[1])).toBeDefined();
    }
  });
});

describe('linear conversions use exact constants', () => {
  it('length, mass and volume', () => {
    expect(conv(1, 'length', 'ft', 'm')).toBe(0.3048);
    expect(conv(1, 'length', 'mi', 'km')).toBeCloseTo(1.609344, 12);
    expect(conv(1, 'mass', 'lb', 'kg')).toBe(0.45359237);
    expect(conv(1, 'mass', 'st', 'lb')).toBeCloseTo(14, 10);
    expect(conv(1, 'volume', 'gal_us', 'l')).toBe(3.785411784);
    expect(conv(1, 'volume', 'gal_uk', 'l')).toBe(4.54609);
    expect(conv(1, 'volume', 'cup_us', 'tbsp_us')).toBeCloseTo(16, 10);
  });
  it('data storage distinguishes SI and binary prefixes', () => {
    expect(conv(1, 'data', 'gib', 'mib')).toBe(1024);
    expect(conv(1, 'data', 'gb', 'gib')).toBeCloseTo(0.9313225746, 9);
    expect(conv(8, 'data', 'bit', 'b')).toBe(1);
  });
  it('speed, angle and frequency', () => {
    expect(conv(100, 'speed', 'kmh', 'mph')).toBeCloseTo(62.13711922, 7);
    expect(conv(180, 'angle', 'deg', 'rad')).toBeCloseTo(Math.PI, 12);
    expect(conv(60, 'frequency', 'rpm', 'hz')).toBeCloseTo(1, 12);
  });
});

describe('non-linear conversions', () => {
  it('temperature is affine', () => {
    expect(conv(100, 'temperature', 'c', 'f')).toBeCloseTo(212, 10);
    expect(conv(-40, 'temperature', 'f', 'c')).toBeCloseTo(-40, 10);
    expect(conv(0, 'temperature', 'c', 'k')).toBeCloseTo(273.15, 10);
    expect(conv(0, 'temperature', 'f', 'r')).toBeCloseTo(459.67, 10);
  });
  it('fuel economy is reciprocal', () => {
    expect(conv(10, 'fuel', 'l100km', 'kml')).toBeCloseTo(10, 10);
    expect(conv(5, 'fuel', 'l100km', 'mpg_us')).toBeCloseTo(47.0429, 3);
    expect(conv(30, 'fuel', 'mpg_us', 'mpg_uk')).toBeCloseTo(36.0285, 3);
    expect(conv(0, 'fuel', 'mpg_us', 'l100km')).toBe(Infinity);
  });
});

describe('numbers', () => {
  it('reads decimal commas and thousands separators', () => {
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1 000')).toBe(1000);
    expect(parseNumber('2.5e3')).toBe(2500);
    expect(parseNumber('−3')).toBe(-3);
    expect(parseNumber('abc')).toBeNaN();
  });
  it('formats with precision and scientific notation', () => {
    expect(formatNumber(0.3048)).toBe('0.3048');
    expect(formatNumber(1 / 3)).toBe('0.3333333333');
    expect(formatNumber(1 / 3, 3)).toBe('0.333');
    expect(formatNumber(9_460_730_472_580_800)).toBe('9.460730473e15');
    expect(formatNumber(1.602176634e-19)).toBe('1.602176634e-19');
    expect(formatNumber(Infinity)).toBe('∞');
    expect(groupDigits('1234567.89')).toBe('1,234,567.89');
    expect(splitScientific('1.5e-19')).toEqual({ mantissa: '1.5', exponent: '-19' });
  });
});

describe('expressions', () => {
  it('sums mixed units into the From unit', () => {
    expect(parseQuantity('5 ft 11 in', cat('length'), unit('length', 'm')).value).toBeCloseTo(1.8034, 10);
    expect(parseQuantity(`5'11"`, cat('length'), unit('length', 'in')).value).toBeCloseTo(71, 10);
    expect(parseQuantity('1 h 30 min', cat('time'), unit('time', 'min')).value).toBeCloseTo(90, 10);
    expect(parseQuantity('1,5', cat('length'), unit('length', 'm'))).toEqual({ value: 1.5, parts: [] });
  });
  it('explains bad input', () => {
    expect(() => parseQuantity('5 kg', cat('length'), unit('length', 'm'))).toThrow(/weight unit/);
    expect(() => parseQuantity('5 ft 11', cat('length'), unit('length', 'm'))).toThrow(UnitError);
    expect(() => parseQuantity('', cat('length'), unit('length', 'm'))).toThrow(/Enter a value/);
    expect(() => parseQuantity('5 C 3 F', cat('temperature'), unit('temperature', 'k'))).toThrow(/cannot be added/);
  });
  it('finds units by symbol, name and alias', () => {
    expect(findUnit(cat('length'), 'feet')?.id).toBe('ft');
    expect(findUnit(cat('data'), 'MB')?.id).toBe('mb');
    expect(findUnit(cat('mass'), 'Pounds')?.id).toBe('lb');
  });
});

describe('search, formulas and state', () => {
  it('search jumps across categories', () => {
    const [first] = search('ft');
    expect(first?.category.id).toBe('length');
    expect(first?.unit?.id).toBe('ft');
    expect(search('psi')[0]?.category.id).toBe('pressure');
    expect(search('temperature')[0]?.category.id).toBe('temperature');
  });
  it('describes formulas in words', () => {
    expect(describeFormula(cat('length'), unit('length', 'ft'), unit('length', 'm'))).toBe('To convert ft to m, multiply the length value by 0.3048.');
    expect(describeFormula(cat('length'), unit('length', 'm'), unit('length', 'ft'))).toBe('To convert m to ft, divide the length value by 0.3048.');
    expect(describeFormula(cat('temperature'), unit('temperature', 'c'), unit('temperature', 'f'))).toMatch(/multiply by 1.8 \(9\/5\), then add 32/);
    expect(describeFormula(cat('fuel'), unit('fuel', 'l100km'), unit('fuel', 'mpg_us'))).toMatch(/divide 235.215 by the value/);
  });
  it('round-trips state through the query string and repairs bad values', () => {
    const s = sanitizeState({ category: 'mass', from: 'kg', to: 'lb', input: '72', precision: 4 });
    expect(queryToState(stateToQuery(s))).toEqual(s);
    expect(queryToState('?x=1')).toBeNull();
    expect(sanitizeState({ category: 'nope', from: 'zz', to: 'zz' })).toMatchObject({ category: 'length', from: 'm', to: 'ft' });
    expect(sanitizeState({ category: 'length', from: 'm', to: 'm' }).to).not.toBe('m');
  });
});
