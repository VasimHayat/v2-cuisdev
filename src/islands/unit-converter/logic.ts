/**
 * Unit Converter: pure functions, no DOM.
 *
 * Every unit converts through its category's base unit. Most units are linear (a
 * factor to the base); temperature is affine and fuel economy is reciprocal, so units
 * may supply their own toBase / fromBase. Constants are the exact legal definitions
 * (international inch 0.0254 m, pound 0.45359237 kg, US gallon 3.785411784 L,
 * imperial gallon 4.54609 L).
 */

export class UnitError extends Error {
  override name = 'UnitError';
}

export type CategoryId =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'area'
  | 'volume'
  | 'speed'
  | 'time'
  | 'data'
  | 'pressure'
  | 'energy'
  | 'power'
  | 'angle'
  | 'fuel'
  | 'frequency';

export interface Unit {
  id: string;
  name: string;
  symbol: string;
  /** Extra spellings accepted in expressions and search, lower case. */
  aliases?: string[];
  /** Linear factor: value × factor = base value. */
  factor?: number;
  /** Non-linear conversion to and from the base unit. */
  toBase?: (v: number) => number;
  fromBase?: (v: number) => number;
  /** Fuel economy units: base (L/100 km) = k / value. */
  reciprocal?: number;
}

export interface Category {
  id: CategoryId;
  name: string;
  /** Word used in formulas: "multiply the length value by ...". */
  noun: string;
  units: Unit[];
  defaults: [string, string];
}

const PI = Math.PI;
const MPG_US = (100 * 3.785411784) / 1.609344;
const MPG_UK = (100 * 4.54609) / 1.609344;

const u = (id: string, name: string, symbol: string, factor: number, aliases: string[] = []): Unit => ({ id, name, symbol, factor, aliases });

export const CATEGORIES: Category[] = [
  {
    id: 'length',
    name: 'Length',
    noun: 'length',
    defaults: ['m', 'ft'],
    units: [
      u('nm', 'Nanometre', 'nm', 1e-9, ['nanometer', 'nanometers', 'nanometres']),
      u('um', 'Micrometre', 'µm', 1e-6, ['micron', 'microns', 'micrometer', 'um', 'μm']),
      u('mm', 'Millimetre', 'mm', 0.001, ['millimeter', 'millimeters', 'millimetres']),
      u('cm', 'Centimetre', 'cm', 0.01, ['centimeter', 'centimeters', 'centimetres']),
      u('m', 'Metre', 'm', 1, ['meter', 'meters', 'metres']),
      u('km', 'Kilometre', 'km', 1000, ['kilometer', 'kilometers', 'kilometres']),
      u('mil', 'Mil (thou)', 'mil', 0.0000254, ['thou', 'mils']),
      u('in', 'Inch', 'in', 0.0254, ['inch', 'inches', '"', '″']),
      u('ft', 'Foot', 'ft', 0.3048, ['foot', 'feet', "'", '′']),
      u('yd', 'Yard', 'yd', 0.9144, ['yard', 'yards']),
      u('mi', 'Mile', 'mi', 1609.344, ['mile', 'miles']),
      u('nmi', 'Nautical mile', 'nmi', 1852, ['nautical mile', 'nautical miles', 'nm (nautical)']),
      u('au', 'Astronomical unit', 'au', 149_597_870_700, ['astronomical unit']),
      u('ly', 'Light year', 'ly', 9_460_730_472_580_800, ['light year', 'light years', 'lightyear']),
    ],
  },
  {
    id: 'mass',
    name: 'Weight',
    noun: 'weight',
    defaults: ['kg', 'lb'],
    units: [
      u('ug', 'Microgram', 'µg', 1e-9, ['microgram', 'micrograms', 'mcg', 'μg']),
      u('mg', 'Milligram', 'mg', 1e-6, ['milligram', 'milligrams']),
      u('g', 'Gram', 'g', 0.001, ['gram', 'grams', 'gramme']),
      u('kg', 'Kilogram', 'kg', 1, ['kilogram', 'kilograms', 'kilo', 'kilos']),
      u('t', 'Tonne', 't', 1000, ['tonne', 'tonnes', 'metric ton', 'metric tons']),
      u('gr', 'Grain', 'gr', 0.00006479891, ['grain', 'grains']),
      u('ct', 'Carat', 'ct', 0.0002, ['carat', 'carats']),
      u('oz', 'Ounce', 'oz', 0.028349523125, ['ounce', 'ounces']),
      u('lb', 'Pound', 'lb', 0.45359237, ['pound', 'pounds', 'lbs']),
      u('st', 'Stone', 'st', 6.35029318, ['stone', 'stones']),
      u('ton_us', 'US ton (short)', 'ton (US)', 907.18474, ['short ton', 'us ton', 'short tons']),
      u('ton_uk', 'UK ton (long)', 'ton (UK)', 1016.0469088, ['long ton', 'uk ton', 'long tons']),
    ],
  },
  {
    id: 'temperature',
    name: 'Temperature',
    noun: 'temperature',
    defaults: ['c', 'f'],
    units: [
      { id: 'c', name: 'Celsius', symbol: '°C', aliases: ['c', 'celsius', 'centigrade', 'degc', 'deg c'], toBase: (v) => v + 273.15, fromBase: (k) => k - 273.15 },
      { id: 'f', name: 'Fahrenheit', symbol: '°F', aliases: ['f', 'fahrenheit', 'degf', 'deg f'], toBase: (v) => ((v - 32) * 5) / 9 + 273.15, fromBase: (k) => ((k - 273.15) * 9) / 5 + 32 },
      { id: 'k', name: 'Kelvin', symbol: 'K', aliases: ['k', 'kelvin', 'kelvins'], toBase: (v) => v, fromBase: (k) => k },
      { id: 'r', name: 'Rankine', symbol: '°R', aliases: ['r', 'rankine', 'degr'], toBase: (v) => (v * 5) / 9, fromBase: (k) => (k * 9) / 5 },
    ],
  },
  {
    id: 'area',
    name: 'Area',
    noun: 'area',
    defaults: ['m2', 'ft2'],
    units: [
      u('mm2', 'Square millimetre', 'mm²', 1e-6, ['mm2', 'sq mm', 'square millimeter']),
      u('cm2', 'Square centimetre', 'cm²', 1e-4, ['cm2', 'sq cm', 'square centimeter']),
      u('m2', 'Square metre', 'm²', 1, ['m2', 'sq m', 'sqm', 'square meter', 'square meters']),
      u('ha', 'Hectare', 'ha', 10_000, ['hectare', 'hectares']),
      u('km2', 'Square kilometre', 'km²', 1e6, ['km2', 'sq km', 'square kilometer']),
      u('in2', 'Square inch', 'in²', 0.00064516, ['in2', 'sq in', 'square inch', 'square inches']),
      u('ft2', 'Square foot', 'ft²', 0.09290304, ['ft2', 'sq ft', 'sqft', 'square foot', 'square feet']),
      u('yd2', 'Square yard', 'yd²', 0.83612736, ['yd2', 'sq yd', 'square yard', 'square yards']),
      u('ac', 'Acre', 'ac', 4046.8564224, ['acre', 'acres']),
      u('mi2', 'Square mile', 'mi²', 2_589_988.110336, ['mi2', 'sq mi', 'square mile', 'square miles']),
    ],
  },
  {
    id: 'volume',
    name: 'Volume',
    noun: 'volume',
    defaults: ['l', 'gal_us'],
    units: [
      u('ml', 'Millilitre', 'mL', 0.001, ['millilitre', 'milliliter', 'milliliters', 'cc']),
      u('cm3', 'Cubic centimetre', 'cm³', 0.001, ['cm3', 'cubic centimeter']),
      u('l', 'Litre', 'L', 1, ['liter', 'liters', 'litre', 'litres', 'ltr']),
      u('m3', 'Cubic metre', 'm³', 1000, ['m3', 'cubic meter', 'cubic meters']),
      u('in3', 'Cubic inch', 'in³', 0.016387064, ['in3', 'cu in', 'cubic inch']),
      u('ft3', 'Cubic foot', 'ft³', 28.316846592, ['ft3', 'cu ft', 'cubic foot', 'cubic feet']),
      u('tsp_us', 'Teaspoon (US)', 'tsp', 0.00492892159375, ['teaspoon', 'teaspoons', 'tsp']),
      u('tbsp_us', 'Tablespoon (US)', 'tbsp', 0.01478676478125, ['tablespoon', 'tablespoons', 'tbsp']),
      u('floz_us', 'Fluid ounce (US)', 'fl oz (US)', 0.0295735295625, ['fl oz', 'floz', 'fluid ounce', 'fluid ounces']),
      u('cup_us', 'Cup (US)', 'cup (US)', 0.2365882365, ['cup', 'cups']),
      u('cup_metric', 'Cup (metric)', 'cup (metric)', 0.25, ['metric cup']),
      u('pt_us', 'Pint (US)', 'pt (US)', 0.473176473, ['pint', 'pints', 'pt']),
      u('qt_us', 'Quart (US)', 'qt (US)', 0.946352946, ['quart', 'quarts', 'qt']),
      u('gal_us', 'Gallon (US)', 'gal (US)', 3.785411784, ['gallon', 'gallons', 'gal', 'us gallon']),
      u('floz_uk', 'Fluid ounce (UK)', 'fl oz (UK)', 0.0284130625, ['imperial fluid ounce', 'uk fl oz']),
      u('pt_uk', 'Pint (UK)', 'pt (UK)', 0.56826125, ['imperial pint', 'uk pint']),
      u('qt_uk', 'Quart (UK)', 'qt (UK)', 1.1365225, ['imperial quart', 'uk quart']),
      u('gal_uk', 'Gallon (UK)', 'gal (UK)', 4.54609, ['imperial gallon', 'uk gallon']),
      u('gal_usdry', 'Gallon (US dry)', 'gal (US dry)', 4.40488377086, ['dry gallon']),
      u('bu_us', 'Bushel (US)', 'bu', 35.23907016688, ['bushel', 'bushels']),
      u('bbl', 'Barrel (oil)', 'bbl', 158.987294928, ['barrel', 'barrels', 'oil barrel']),
    ],
  },
  {
    id: 'speed',
    name: 'Speed',
    noun: 'speed',
    defaults: ['kmh', 'mph'],
    units: [
      u('ms', 'Metre per second', 'm/s', 1, ['mps', 'meters per second', 'metres per second']),
      u('kmh', 'Kilometre per hour', 'km/h', 1 / 3.6, ['kph', 'kmph', 'kilometers per hour', 'kilometres per hour']),
      u('mph', 'Mile per hour', 'mph', 0.44704, ['mi/h', 'miles per hour']),
      u('fts', 'Foot per second', 'ft/s', 0.3048, ['fps', 'feet per second']),
      u('kn', 'Knot', 'kn', 1852 / 3600, ['knot', 'knots', 'kt', 'kts']),
    ],
  },
  {
    id: 'time',
    name: 'Time',
    noun: 'time',
    defaults: ['h', 'min'],
    units: [
      u('ns', 'Nanosecond', 'ns', 1e-9, ['nanosecond', 'nanoseconds']),
      u('us', 'Microsecond', 'µs', 1e-6, ['microsecond', 'microseconds', 'μs']),
      u('ms', 'Millisecond', 'ms', 0.001, ['millisecond', 'milliseconds']),
      u('s', 'Second', 's', 1, ['sec', 'secs', 'second', 'seconds']),
      u('min', 'Minute', 'min', 60, ['mins', 'minute', 'minutes']),
      u('h', 'Hour', 'h', 3600, ['hr', 'hrs', 'hour', 'hours']),
      u('d', 'Day', 'd', 86_400, ['day', 'days']),
      u('wk', 'Week', 'wk', 604_800, ['week', 'weeks']),
      u('mo', 'Month (average)', 'mo', 2_629_746, ['month', 'months']),
      u('yr', 'Year (average)', 'yr', 31_556_952, ['year', 'years', 'y']),
      u('dec', 'Decade', 'decade', 315_569_520, ['decade', 'decades']),
      u('cent', 'Century', 'century', 3_155_695_200, ['century', 'centuries']),
    ],
  },
  {
    id: 'data',
    name: 'Data',
    noun: 'data size',
    defaults: ['gb', 'gib'],
    units: [
      u('bit', 'Bit', 'bit', 0.125, ['bits', 'b (bit)']),
      u('b', 'Byte', 'B', 1, ['byte', 'bytes']),
      u('kbit', 'Kilobit', 'kbit', 125, ['kb (bit)', 'kilobit', 'kilobits', 'kbps']),
      u('mbit', 'Megabit', 'Mbit', 125_000, ['megabit', 'megabits', 'mbps']),
      u('gbit', 'Gigabit', 'Gbit', 125_000_000, ['gigabit', 'gigabits', 'gbps']),
      u('kb', 'Kilobyte', 'kB', 1e3, ['kilobyte', 'kilobytes']),
      u('mb', 'Megabyte', 'MB', 1e6, ['megabyte', 'megabytes']),
      u('gb', 'Gigabyte', 'GB', 1e9, ['gigabyte', 'gigabytes']),
      u('tb', 'Terabyte', 'TB', 1e12, ['terabyte', 'terabytes']),
      u('pb', 'Petabyte', 'PB', 1e15, ['petabyte', 'petabytes']),
      u('kib', 'Kibibyte', 'KiB', 1024, ['kibibyte', 'kibibytes']),
      u('mib', 'Mebibyte', 'MiB', 1024 ** 2, ['mebibyte', 'mebibytes']),
      u('gib', 'Gibibyte', 'GiB', 1024 ** 3, ['gibibyte', 'gibibytes']),
      u('tib', 'Tebibyte', 'TiB', 1024 ** 4, ['tebibyte', 'tebibytes']),
      u('pib', 'Pebibyte', 'PiB', 1024 ** 5, ['pebibyte', 'pebibytes']),
    ],
  },
  {
    id: 'pressure',
    name: 'Pressure',
    noun: 'pressure',
    defaults: ['bar', 'psi'],
    units: [
      u('pa', 'Pascal', 'Pa', 1, ['pascal', 'pascals']),
      u('hpa', 'Hectopascal', 'hPa', 100, ['hectopascal', 'hectopascals']),
      u('kpa', 'Kilopascal', 'kPa', 1000, ['kilopascal', 'kilopascals']),
      u('mpa', 'Megapascal', 'MPa', 1e6, ['megapascal', 'megapascals']),
      u('mbar', 'Millibar', 'mbar', 100, ['millibar', 'millibars']),
      u('bar', 'Bar', 'bar', 100_000, ['bars']),
      u('atm', 'Standard atmosphere', 'atm', 101_325, ['atmosphere', 'atmospheres']),
      u('psi', 'Pound per square inch', 'psi', 6894.757293168361, ['lbf/in2', 'pounds per square inch']),
      u('torr', 'Torr', 'Torr', 101_325 / 760, ['torrs']),
      u('mmhg', 'Millimetre of mercury', 'mmHg', 133.322387415, ['mm hg', 'millimeters of mercury']),
      u('inhg', 'Inch of mercury', 'inHg', 3386.389, ['in hg', 'inches of mercury']),
    ],
  },
  {
    id: 'energy',
    name: 'Energy',
    noun: 'energy',
    defaults: ['kcal', 'kj'],
    units: [
      u('ev', 'Electronvolt', 'eV', 1.602176634e-19, ['electronvolt', 'electronvolts']),
      u('j', 'Joule', 'J', 1, ['joule', 'joules']),
      u('kj', 'Kilojoule', 'kJ', 1000, ['kilojoule', 'kilojoules']),
      u('mj', 'Megajoule', 'MJ', 1e6, ['megajoule', 'megajoules']),
      u('cal', 'Calorie', 'cal', 4.184, ['calorie', 'calories']),
      u('kcal', 'Kilocalorie (food calorie)', 'kcal', 4184, ['kilocalorie', 'kilocalories', 'food calorie', 'cal (food)']),
      u('wh', 'Watt hour', 'Wh', 3600, ['watt hour', 'watt hours']),
      u('kwh', 'Kilowatt hour', 'kWh', 3.6e6, ['kilowatt hour', 'kilowatt hours']),
      u('btu', 'British thermal unit', 'BTU', 1055.05585262, ['btus']),
      u('ftlbf', 'Foot-pound', 'ft·lbf', 1.3558179483314004, ['ft-lbf', 'ft lbf', 'foot pound', 'foot-pound']),
      u('therm', 'Therm (US)', 'thm', 105_505_585.262, ['therm', 'therms']),
    ],
  },
  {
    id: 'power',
    name: 'Power',
    noun: 'power',
    defaults: ['kw', 'hp'],
    units: [
      u('mw_milli', 'Milliwatt', 'mW', 0.001, ['milliwatt', 'milliwatts']),
      u('w', 'Watt', 'W', 1, ['watt', 'watts']),
      u('kw', 'Kilowatt', 'kW', 1000, ['kilowatt', 'kilowatts']),
      u('mw', 'Megawatt', 'MW', 1e6, ['megawatt', 'megawatts']),
      u('hp', 'Horsepower (mechanical)', 'hp', 745.69987158227022, ['horsepower', 'bhp']),
      u('ps', 'Horsepower (metric)', 'PS', 735.49875, ['metric horsepower', 'cv', 'pferdestarke']),
      u('btuh', 'BTU per hour', 'BTU/h', 0.29307107017, ['btu/hr', 'btuh']),
      u('ftlbfs', 'Foot-pound per second', 'ft·lbf/s', 1.3558179483314004, ['ft-lbf/s']),
    ],
  },
  {
    id: 'angle',
    name: 'Angle',
    noun: 'angle',
    defaults: ['deg', 'rad'],
    units: [
      u('deg', 'Degree', '°', PI / 180, ['degree', 'degrees', 'deg']),
      u('rad', 'Radian', 'rad', 1, ['radian', 'radians']),
      u('mrad', 'Milliradian', 'mrad', 0.001, ['milliradian', 'mil (angle)']),
      u('grad', 'Gradian', 'grad', PI / 200, ['gradian', 'gradians', 'gon']),
      u('arcmin', 'Arcminute', '′', PI / 10_800, ['arcminute', 'arcminutes', 'arcmin']),
      u('arcsec', 'Arcsecond', '″', PI / 648_000, ['arcsecond', 'arcseconds', 'arcsec']),
      u('turn', 'Turn', 'turn', 2 * PI, ['turns', 'revolution', 'revolutions', 'rev']),
    ],
  },
  {
    id: 'fuel',
    name: 'Fuel economy',
    noun: 'fuel economy',
    defaults: ['l100km', 'mpg_us'],
    units: [
      { id: 'l100km', name: 'Litres per 100 km', symbol: 'L/100 km', aliases: ['l/100km', 'l/100 km', 'liters per 100 km'], factor: 1 },
      { id: 'kml', name: 'Kilometres per litre', symbol: 'km/L', aliases: ['kmpl', 'km/l', 'kilometers per liter'], reciprocal: 100 },
      { id: 'mpg_us', name: 'Miles per gallon (US)', symbol: 'mpg (US)', aliases: ['mpg', 'us mpg', 'miles per gallon'], reciprocal: MPG_US },
      { id: 'mpg_uk', name: 'Miles per gallon (UK)', symbol: 'mpg (UK)', aliases: ['uk mpg', 'imperial mpg'], reciprocal: MPG_UK },
    ],
  },
  {
    id: 'frequency',
    name: 'Frequency',
    noun: 'frequency',
    defaults: ['hz', 'rpm'],
    units: [
      u('hz', 'Hertz', 'Hz', 1, ['hertz']),
      u('khz', 'Kilohertz', 'kHz', 1000, ['kilohertz']),
      u('mhz', 'Megahertz', 'MHz', 1e6, ['megahertz']),
      u('ghz', 'Gigahertz', 'GHz', 1e9, ['gigahertz']),
      u('rpm', 'Revolutions per minute', 'rpm', 1 / 60, ['rev/min', 'revolutions per minute']),
      u('rads', 'Radian per second', 'rad/s', 1 / (2 * PI), ['radians per second']),
    ],
  },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): Category | undefined {
  return BY_ID.get(id as CategoryId);
}

export function getUnit(category: Category, id: string): Unit | undefined {
  return category.units.find((x) => x.id === id);
}

export function isLinear(unit: Unit): boolean {
  return unit.factor !== undefined && unit.toBase === undefined && unit.reciprocal === undefined;
}

// --- conversion ---------------------------------------------------------------

export function toBase(unit: Unit, value: number): number {
  if (unit.toBase) return unit.toBase(value);
  if (unit.reciprocal !== undefined) return value === 0 ? Infinity : unit.reciprocal / value;
  return value * (unit.factor ?? 1);
}

export function fromBase(unit: Unit, base: number): number {
  if (unit.fromBase) return unit.fromBase(base);
  if (unit.reciprocal !== undefined) return base === 0 ? Infinity : unit.reciprocal / base;
  return base / (unit.factor ?? 1);
}

export function convert(value: number, from: Unit, to: Unit): number {
  if (from.id === to.id) return value;
  if (isLinear(from) && isLinear(to)) return (value * from.factor!) / to.factor!;
  return fromBase(to, toBase(from, value));
}

// --- numbers ------------------------------------------------------------------

/**
 * Parse a number written by a person: "1,234.5", "1.234,5", "1,5" (decimal comma),
 * "1 000", "2.5e3", "-3", "½" is not supported. Returns NaN when unreadable.
 */
export function parseNumber(raw: string): number {
  let s = raw.trim().replace(/[−‒–]/g, '-').replace(/[\s  _']/g, '');
  if (s === '' || !/^[-+]?[\d.,]*\d[\d.,]*(e[-+]?\d+)?$/i.test(s)) return NaN;
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // The separator that appears last is the decimal one.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // "1,234" and "1,234,567" are thousands; "1,5" and "0,25" are decimals.
    s = /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g) ?? []).length > 1) {
    // "1.234.567" with dots as thousands separators.
    if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else return NaN;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function trimZeros(text: string): string {
  if (text.includes('e')) {
    const [m, e] = text.split('e') as [string, string];
    return `${trimZeros(m)}e${e}`;
  }
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

export type Precision = 'auto' | number;

/**
 * Format a result. Auto uses up to 10 significant digits; very large or very small
 * magnitudes switch to scientific notation. Returns a plain machine-readable string
 * (no grouping); use `groupDigits` for display.
 */
export function formatNumber(value: number, precision: Precision = 'auto'): string {
  if (Number.isNaN(value)) return '';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  if (value === 0) return '0';
  const sig = precision === 'auto' ? 10 : Math.min(17, Math.max(1, Math.round(precision)));
  const abs = Math.abs(value);
  if (abs >= 1e15 || abs < 1e-6) return trimZeros(value.toExponential(sig - 1)).replace('e+', 'e');
  let text = value.toPrecision(sig);
  if (text.includes('e')) text = Number(text).toString();
  return trimZeros(text);
}

/** Insert thousands separators into the integer part for display. */
export function groupDigits(text: string): string {
  if (text.includes('e') || !/^-?\d/.test(text)) return text;
  const [int, frac] = text.split('.') as [string, string | undefined];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/** Split scientific notation for display as mantissa × 10^exponent. */
export function splitScientific(text: string): { mantissa: string; exponent: string } | null {
  const m = /^(-?[\d.]+)e([-+]?\d+)$/.exec(text);
  return m ? { mantissa: m[1]!, exponent: String(Number(m[2])) } : null;
}

// --- unit lookup and expressions ------------------------------------------------

function norm(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
}

/** Find a unit in a category by id, symbol, name or alias (case-insensitive, then exact). */
export function findUnit(category: Category, text: string): Unit | undefined {
  const raw = text.trim();
  if (!raw) return undefined;
  const exact = category.units.find((x) => x.symbol === raw || x.id === raw);
  if (exact) return exact;
  const n = norm(raw);
  return category.units.find((x) => x.id === n || norm(x.symbol) === n || norm(x.name) === n || norm(`${x.name}s`) === n || x.aliases?.some((a) => a === n));
}

export interface SearchHit {
  category: Category;
  unit?: Unit;
  score: number;
}

/** Search units and categories across the whole catalogue. Best matches first. */
export function search(query: string, limit = 8): SearchHit[] {
  const q = norm(query);
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const c of CATEGORIES) {
    const cn = norm(c.name);
    if (cn === q || c.id === q) hits.push({ category: c, score: 95 });
    else if (cn.startsWith(q)) hits.push({ category: c, score: 60 });
    for (const unit of c.units) {
      const names = [unit.id, norm(unit.symbol), norm(unit.name), ...(unit.aliases ?? [])];
      let score = 0;
      if (unit.symbol === query.trim()) score = 100;
      else if (names.includes(q)) score = 90;
      else if (names.some((x) => x.startsWith(q))) score = 50;
      else if (q.length >= 3 && names.some((x) => x.includes(q))) score = 30;
      if (score) hits.push({ category: c, unit, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export interface ParsedQuantity {
  /** Value expressed in the "from" unit. */
  value: number;
  /** Units that appeared in the expression, in order (empty for a plain number). */
  parts: { value: number; unit: Unit }[];
}

/**
 * Read the From field. A plain number is taken in the From unit. An expression with
 * units, such as "5 ft 11 in" or "1 h 30 min", is summed in the base unit and then
 * expressed in the From unit. Units must belong to the current category.
 */
export function parseQuantity(text: string, category: Category, from: Unit): ParsedQuantity {
  const raw = text.trim();
  if (raw === '') throw new UnitError('Enter a value to convert.');
  const plain = parseNumber(raw);
  if (!Number.isNaN(plain)) return { value: plain, parts: [] };

  const re = /\s*([-+−]?\d[\d.,]*(?:e[-+]?\d+)?)\s*([^\d\s+−-][^\d]*?)?\s*(?=[-+−]?\d|$)/giy;
  const parts: { value: number; unit: Unit }[] = [];
  let pos = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while (pos < raw.length && (m = re.exec(raw)) !== null) {
    if (m[0] === '') break;
    pos = re.lastIndex;
    const value = parseNumber(m[1]!);
    if (Number.isNaN(value)) throw new UnitError(`"${m[1]!.trim()}" is not a number.`);
    const unitText = (m[2] ?? '').trim();
    let unit: Unit | undefined;
    if (unitText === '') {
      if (parts.length === 0) throw new UnitError('Add a unit after each number, for example 5 ft 11 in.');
      throw new UnitError(`The number ${m[1]!.trim()} has no unit.`);
    }
    unit = findUnit(category, unitText);
    if (!unit) {
      const elsewhere = search(unitText, 1)[0];
      if (elsewhere?.unit && elsewhere.score >= 90 && elsewhere.category.id !== category.id) {
        throw new UnitError(`"${unitText}" is a ${elsewhere.category.name.toLowerCase()} unit. Switch the category to ${elsewhere.category.name}.`);
      }
      throw new UnitError(`"${unitText}" is not a ${category.name.toLowerCase()} unit.`);
    }
    parts.push({ value, unit });
  }
  if (pos < raw.length || parts.length === 0) throw new UnitError(`Could not read "${raw}". Enter a number such as 12.5, or an expression such as 5 ft 11 in.`);
  if (parts.length > 1 && parts.some((p) => !isLinear(p.unit))) throw new UnitError(`${category.name} values cannot be added together; enter a single value.`);
  const base = parts.reduce((sum, p) => sum + toBase(p.unit, p.value), 0);
  return { value: fromBase(from, base), parts };
}

// --- formula ------------------------------------------------------------------

const TEMP_FORMULAS: Record<string, string> = {
  'c>f': 'multiply by 1.8 (9/5), then add 32',
  'f>c': 'subtract 32, then divide by 1.8 (multiply by 5/9)',
  'c>k': 'add 273.15',
  'k>c': 'subtract 273.15',
  'f>k': 'subtract 32, divide by 1.8, then add 273.15',
  'k>f': 'subtract 273.15, multiply by 1.8, then add 32',
  'r>k': 'divide by 1.8',
  'k>r': 'multiply by 1.8',
  'c>r': 'add 273.15, then multiply by 1.8',
  'r>c': 'divide by 1.8, then subtract 273.15',
  'f>r': 'add 459.67',
  'r>f': 'subtract 459.67',
};

/** The conversion rule in words, e.g. "multiply the length value by 0.3048". */
export function describeFormula(category: Category, from: Unit, to: Unit): string {
  if (from.id === to.id) return 'The value stays the same.';
  if (category.id === 'temperature') return `To convert ${from.symbol} to ${to.symbol}, ${TEMP_FORMULAS[`${from.id}>${to.id}`] ?? 'convert through kelvin'}.`;
  if (category.id === 'fuel') {
    const fk = from.reciprocal;
    const tk = to.reciprocal;
    if (fk === undefined && tk !== undefined) return `To convert ${from.symbol} to ${to.symbol}, divide ${formatNumber(tk, 6)} by the value.`;
    if (fk !== undefined && tk === undefined) return `To convert ${from.symbol} to ${to.symbol}, divide ${formatNumber(fk, 6)} by the value.`;
    if (fk !== undefined && tk !== undefined) return `To convert ${from.symbol} to ${to.symbol}, multiply the value by ${formatNumber(tk / fk, 6)}.`;
  }
  const f = from.factor! / to.factor!;
  const mult = formatNumber(f, 'auto');
  const div = formatNumber(1 / f, 'auto');
  const useDivide = div.replace(/[-.e]/g, '').length < mult.replace(/[-.e]/g, '').length;
  return useDivide
    ? `To convert ${from.symbol} to ${to.symbol}, divide the ${category.noun} value by ${groupDigits(div)}.`
    : `To convert ${from.symbol} to ${to.symbol}, multiply the ${category.noun} value by ${groupDigits(mult)}.`;
}

// --- state ----------------------------------------------------------------------

export interface ConverterState {
  category: CategoryId;
  from: string;
  to: string;
  input: string;
  precision: Precision;
}

export function defaultState(categoryId: CategoryId = 'length'): ConverterState {
  const c = getCategory(categoryId) ?? CATEGORIES[0]!;
  return { category: c.id, from: c.defaults[0], to: c.defaults[1], input: '1', precision: 'auto' };
}

/** Make any partial state valid: unknown category or units fall back to defaults. */
export function sanitizeState(raw: Partial<Record<keyof ConverterState, unknown>> | null | undefined): ConverterState {
  const c = getCategory(String(raw?.category ?? '')) ?? CATEGORIES[0]!;
  const d = defaultState(c.id);
  const from = typeof raw?.from === 'string' && getUnit(c, raw.from) ? raw.from : d.from;
  let to = typeof raw?.to === 'string' && getUnit(c, raw.to) ? raw.to : d.to;
  if (to === from) to = c.units.find((x) => x.id !== from)?.id ?? to;
  const input = typeof raw?.input === 'string' && raw.input.length <= 200 ? raw.input : d.input;
  const p = raw?.precision;
  const precision: Precision = typeof p === 'number' && p >= 1 && p <= 17 ? Math.round(p) : typeof p === 'string' && /^\d+$/.test(p) && Number(p) >= 1 && Number(p) <= 17 ? Number(p) : 'auto';
  return { category: c.id, from, to, input, precision };
}

/** Query string for a shareable link: ?c=length&from=ft&to=m&v=5 */
export function stateToQuery(s: ConverterState): string {
  const p = new URLSearchParams({ c: s.category, from: s.from, to: s.to, v: s.input });
  if (s.precision !== 'auto') p.set('p', String(s.precision));
  return `?${p.toString()}`;
}

/** Read state from a query string, or null when it carries no converter state. */
export function queryToState(search: string): ConverterState | null {
  const p = new URLSearchParams(search);
  if (!p.has('c')) return null;
  return sanitizeState({ category: p.get('c'), from: p.get('from'), to: p.get('to'), input: p.get('v') ?? '1', precision: p.get('p') ?? 'auto' });
}
