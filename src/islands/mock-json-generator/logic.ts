/**
 * Mock JSON Generator: pure functions, no DOM.
 *
 * A template is ordinary JSON. String values may contain placeholders such as
 * "{{name.full}}" or "{{number.int(1,100)}}". A string that is exactly one placeholder
 * keeps the generated value's native type (numbers stay numbers); placeholders inside
 * longer strings are interpolated as text. An array whose first element is
 * "{{repeat(n)}}" or "{{repeat(min,max)}}" repeats its remaining element(s).
 * Output is reproducible: the same template, seed and base date give the same JSON.
 */
import { scanJsonError } from '../shared/json-errors';

export class MockError extends Error {
  override name = 'MockError';
  offset?: number;
  constructor(message: string, offset?: number) {
    super(message);
    if (offset !== undefined) this.offset = offset;
  }
}

// --- PRNG ----------------------------------------------------------------------

/** mulberry32: small, fast, good enough for mock data, fully deterministic. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 999_999) + 1;
}

// --- word lists ---------------------------------------------------------------------

const FIRST = ['Ada', 'Linus', 'Grace', 'Alan', 'Margaret', 'Tim', 'Aiko', 'Kenji', 'Priya', 'Arjun', 'Fatima', 'Omar', 'Sofia', 'Mateo', 'Chloe', 'Lucas', 'Amara', 'Kwame', 'Ingrid', 'Lars', 'Mei', 'Wei', 'Olga', 'Dmitri', 'Isabella', 'Diego', 'Noor', 'Yusuf', 'Hana', 'Jonas', 'Leila', 'Rafael', 'Zara', 'Emeka', 'Sven', 'Ananya', 'Carmen', 'Hiro', 'Nadia', 'Elif'];
const LAST = ['Lovelace', 'Torvalds', 'Hopper', 'Turing', 'Hamilton', 'Berners-Lee', 'Tanaka', 'Sato', 'Sharma', 'Patel', 'Haddad', 'Khan', 'Rossi', 'Garcia', 'Martin', 'Dubois', 'Okafor', 'Mensah', 'Johansson', 'Nielsen', 'Chen', 'Wang', 'Ivanova', 'Petrov', 'Silva', 'Lopez', 'Rahman', 'Yilmaz', 'Kim', 'Schmidt', 'Moreau', 'Costa', 'Nguyen', 'Adeyemi', 'Larsen', 'Iyer', 'Fernandez', 'Suzuki', 'Novak', 'Demir'];
const COMPANY_A = ['Blue', 'Bright', 'North', 'Silver', 'Quantum', 'Green', 'Red', 'Swift', 'Clear', 'Iron', 'Open', 'Golden', 'Rapid', 'Lunar', 'Solar', 'Urban'];
const COMPANY_B = ['Harbor', 'Peak', 'Field', 'Labs', 'Works', 'Systems', 'Dynamics', 'Logic', 'Bridge', 'Forge', 'Wave', 'Grid', 'Cloud', 'Stack', 'Signal', 'Path'];
const COMPANY_SUFFIX = ['Inc.', 'Ltd', 'GmbH', 'LLC', 'Co.', 'Group', 'SA', 'BV'];
const JOBS = ['Software Engineer', 'Product Manager', 'Data Analyst', 'UX Designer', 'DevOps Engineer', 'Account Executive', 'Marketing Lead', 'Support Specialist', 'QA Engineer', 'Technical Writer', 'Engineering Manager', 'Data Scientist', 'Security Analyst', 'Sales Manager', 'Operations Director'];
const STREET = ['Main', 'Oak', 'Maple', 'Cedar', 'Elm', 'High', 'Station', 'Church', 'Park', 'Mill', 'Lake', 'River', 'King', 'Queen', 'Market', 'Harbour'];
const STREET_KIND = ['Street', 'Road', 'Avenue', 'Lane', 'Way', 'Drive', 'Close', 'Boulevard'];
const CITIES: [string, string][] = [['London', 'United Kingdom'], ['Berlin', 'Germany'], ['Paris', 'France'], ['Madrid', 'Spain'], ['Rome', 'Italy'], ['Lisbon', 'Portugal'], ['Amsterdam', 'Netherlands'], ['Stockholm', 'Sweden'], ['Oslo', 'Norway'], ['Warsaw', 'Poland'], ['New York', 'United States'], ['Toronto', 'Canada'], ['Mexico City', 'Mexico'], ['São Paulo', 'Brazil'], ['Buenos Aires', 'Argentina'], ['Lagos', 'Nigeria'], ['Nairobi', 'Kenya'], ['Cairo', 'Egypt'], ['Mumbai', 'India'], ['Bengaluru', 'India'], ['Singapore', 'Singapore'], ['Tokyo', 'Japan'], ['Seoul', 'South Korea'], ['Sydney', 'Australia'], ['Auckland', 'New Zealand']];
const TLDS = ['com', 'io', 'dev', 'net', 'org', 'co', 'app'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'INR', 'CAD', 'AUD', 'CHF', 'SEK', 'BRL', 'SGD', 'ZAR'];
const PRODUCT_ADJ = ['Ergonomic', 'Wireless', 'Compact', 'Smart', 'Recycled', 'Premium', 'Portable', 'Modular', 'Rugged', 'Minimal'];
const PRODUCT_MAT = ['Steel', 'Wooden', 'Cotton', 'Ceramic', 'Leather', 'Glass', 'Bamboo', 'Aluminium'];
const PRODUCT_NOUN = ['Chair', 'Keyboard', 'Lamp', 'Backpack', 'Mug', 'Desk', 'Headphones', 'Notebook', 'Bottle', 'Speaker', 'Watch', 'Jacket'];
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum'.split(' ');

// --- generator library ---------------------------------------------------------------

export interface GenContext {
  rng: () => number;
  /** Index of the current repeated item (0-based); 0 outside any repeat. */
  index: number;
  /** Base instant for relative dates, so output is reproducible. */
  now: number;
}

type Arg = string;
interface GeneratorDef {
  /** Example shown in the reference panel. */
  example: string;
  description: string;
  run: (ctx: GenContext, args: Arg[]) => unknown;
}

const DAY = 86_400_000;

function int(ctx: GenContext, min: number, max: number): number {
  if (max < min) [min, max] = [max, min];
  return Math.floor(ctx.rng() * (max - min + 1)) + min;
}
function pickOf<T>(ctx: GenContext, list: readonly T[]): T {
  return list[Math.floor(ctx.rng() * list.length)] as T;
}
function hex(ctx: GenContext, digits: number): string {
  let s = '';
  for (let i = 0; i < digits; i++) s += Math.floor(ctx.rng() * 16).toString(16);
  return s;
}
function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
function num(arg: Arg | undefined, name: string, label: string): number | undefined {
  if (arg === undefined || arg === '') return undefined;
  const n = Number(arg);
  if (!Number.isFinite(n)) throw new MockError(`${name}: ${label} must be a number, got "${arg}".`);
  return n;
}
function companyName(ctx: GenContext): string {
  return `${pickOf(ctx, COMPANY_A)} ${pickOf(ctx, COMPANY_B)} ${pickOf(ctx, COMPANY_SUFFIX)}`;
}
function sentence(ctx: GenContext): string {
  const n = int(ctx, 6, 14);
  const words = Array.from({ length: n }, () => pickOf(ctx, LOREM));
  const s = words.join(' ');
  return s[0]!.toUpperCase() + s.slice(1) + '.';
}
function parseDateArg(arg: Arg | undefined, name: string): number | undefined {
  if (!arg) return undefined;
  const ms = Date.parse(arg);
  if (Number.isNaN(ms)) throw new MockError(`${name}: "${arg}" is not a date. Use YYYY-MM-DD.`);
  return ms;
}

export const GENERATORS: Record<string, GeneratorDef> = {
  uuid: { example: '{{uuid}}', description: 'Random UUID v4', run: (ctx) => `${hex(ctx, 8)}-${hex(ctx, 4)}-4${hex(ctx, 3)}-${'89ab'[int(ctx, 0, 3)]}${hex(ctx, 3)}-${hex(ctx, 12)}` },
  index: { example: '{{index(1)}}', description: 'Position in the current repeat, optionally starting at a number', run: (ctx, a) => ctx.index + (num(a[0], 'index', 'start') ?? 0) },
  boolean: { example: '{{boolean(0.7)}}', description: 'true or false, optional probability of true', run: (ctx, a) => ctx.rng() < (num(a[0], 'boolean', 'probability') ?? 0.5) },
  'number.int': { example: '{{number.int(1,100)}}', description: 'Whole number in a range', run: (ctx, a) => int(ctx, num(a[0], 'number.int', 'min') ?? 0, num(a[1], 'number.int', 'max') ?? 1000) },
  'number.float': {
    example: '{{number.float(0,1,3)}}',
    description: 'Decimal number in a range with a precision',
    run: (ctx, a) => {
      const min = num(a[0], 'number.float', 'min') ?? 0;
      const max = num(a[1], 'number.float', 'max') ?? 1;
      const p = num(a[2], 'number.float', 'precision') ?? 2;
      return Number((min + ctx.rng() * (max - min)).toFixed(Math.max(0, Math.min(10, p))));
    },
  },
  pick: {
    example: '{{pick(red,green,blue)}}',
    description: 'One of the listed values',
    run: (ctx, a) => {
      if (a.length === 0) throw new MockError('pick needs at least one value, for example {{pick(red,green)}}.');
      return pickOf(ctx, a);
    },
  },
  'name.first': { example: '{{name.first}}', description: 'First name', run: (ctx) => pickOf(ctx, FIRST) },
  'name.last': { example: '{{name.last}}', description: 'Last name', run: (ctx) => pickOf(ctx, LAST) },
  'name.full': { example: '{{name.full}}', description: 'First and last name', run: (ctx) => `${pickOf(ctx, FIRST)} ${pickOf(ctx, LAST)}` },
  'internet.username': { example: '{{internet.username}}', description: 'Username', run: (ctx) => `${slug(pickOf(ctx, FIRST))}${pickOf(ctx, ['', '.', '_'])}${slug(pickOf(ctx, LAST))}${int(ctx, 1, 99)}` },
  'internet.domain': { example: '{{internet.domain}}', description: 'Domain name', run: (ctx) => `${slug(pickOf(ctx, COMPANY_A))}${slug(pickOf(ctx, COMPANY_B))}.${pickOf(ctx, TLDS)}` },
  'internet.email': {
    example: '{{internet.email}}',
    description: 'Email address on example domains',
    run: (ctx) => `${slug(pickOf(ctx, FIRST))}.${slug(pickOf(ctx, LAST))}@${pickOf(ctx, ['example.com', 'example.org', 'example.net', 'mail.example'])}`,
  },
  'internet.url': { example: '{{internet.url}}', description: 'HTTPS URL', run: (ctx) => `https://www.${slug(pickOf(ctx, COMPANY_A))}${slug(pickOf(ctx, COMPANY_B))}.${pickOf(ctx, TLDS)}/${pickOf(ctx, LOREM)}` },
  'internet.ipv4': { example: '{{internet.ipv4}}', description: 'IPv4 address', run: (ctx) => [int(ctx, 1, 223), int(ctx, 0, 255), int(ctx, 0, 255), int(ctx, 1, 254)].join('.') },
  'internet.ipv6': { example: '{{internet.ipv6}}', description: 'IPv6 address', run: (ctx) => Array.from({ length: 8 }, () => hex(ctx, 4)).join(':') },
  phone: { example: '{{phone}}', description: 'Phone number in international format', run: (ctx) => `+${int(ctx, 1, 99)} ${int(ctx, 100, 999)} ${int(ctx, 100, 999)} ${int(ctx, 1000, 9999)}` },
  'company.name': { example: '{{company.name}}', description: 'Company name', run: (ctx) => companyName(ctx) },
  'company.job': { example: '{{company.job}}', description: 'Job title', run: (ctx) => pickOf(ctx, JOBS) },
  'address.street': { example: '{{address.street}}', description: 'Street address', run: (ctx) => `${int(ctx, 1, 250)} ${pickOf(ctx, STREET)} ${pickOf(ctx, STREET_KIND)}` },
  'address.city': { example: '{{address.city}}', description: 'City', run: (ctx) => pickOf(ctx, CITIES)[0] },
  'address.country': { example: '{{address.country}}', description: 'Country', run: (ctx) => pickOf(ctx, CITIES)[1] },
  'address.postcode': { example: '{{address.postcode}}', description: 'Postcode', run: (ctx) => String(int(ctx, 10000, 99999)) },
  'address.lat': { example: '{{address.lat}}', description: 'Latitude', run: (ctx) => Number((ctx.rng() * 180 - 90).toFixed(6)) },
  'address.lng': { example: '{{address.lng}}', description: 'Longitude', run: (ctx) => Number((ctx.rng() * 360 - 180).toFixed(6)) },
  'color.hex': { example: '{{color.hex}}', description: 'Hex colour', run: (ctx) => `#${hex(ctx, 6)}` },
  'finance.currency': { example: '{{finance.currency}}', description: 'ISO currency code', run: (ctx) => pickOf(ctx, CURRENCIES) },
  'finance.price': {
    example: '{{finance.price(5,500)}}',
    description: 'Price with two decimals',
    run: (ctx, a) => {
      const min = num(a[0], 'finance.price', 'min') ?? 1;
      const max = num(a[1], 'finance.price', 'max') ?? 1000;
      return Number((min + ctx.rng() * (max - min)).toFixed(2));
    },
  },
  'product.name': { example: '{{product.name}}', description: 'Product name', run: (ctx) => `${pickOf(ctx, PRODUCT_ADJ)} ${pickOf(ctx, PRODUCT_MAT)} ${pickOf(ctx, PRODUCT_NOUN)}` },
  'lorem.word': { example: '{{lorem.word}}', description: 'One lorem ipsum word', run: (ctx) => pickOf(ctx, LOREM) },
  'lorem.words': {
    example: '{{lorem.words(3)}}',
    description: 'Several words',
    run: (ctx, a) => Array.from({ length: Math.max(1, Math.min(100, num(a[0], 'lorem.words', 'count') ?? 3)) }, () => pickOf(ctx, LOREM)).join(' '),
  },
  'lorem.sentence': { example: '{{lorem.sentence}}', description: 'A sentence', run: (ctx) => sentence(ctx) },
  'lorem.paragraph': { example: '{{lorem.paragraph}}', description: 'A paragraph of 3 to 6 sentences', run: (ctx) => Array.from({ length: int(ctx, 3, 6) }, () => sentence(ctx)).join(' ') },
  'date.past': {
    example: '{{date.past(2)}}',
    description: 'ISO date-time within the past N years (default 1)',
    run: (ctx, a) => new Date(ctx.now - Math.floor(ctx.rng() * (num(a[0], 'date.past', 'years') ?? 1) * 365 * DAY)).toISOString(),
  },
  'date.future': {
    example: '{{date.future(1)}}',
    description: 'ISO date-time within the next N years (default 1)',
    run: (ctx, a) => new Date(ctx.now + Math.floor(ctx.rng() * (num(a[0], 'date.future', 'years') ?? 1) * 365 * DAY)).toISOString(),
  },
  'date.recent': {
    example: '{{date.recent(7)}}',
    description: 'ISO date-time within the past N days (default 7)',
    run: (ctx, a) => new Date(ctx.now - Math.floor(ctx.rng() * (num(a[0], 'date.recent', 'days') ?? 7) * DAY)).toISOString(),
  },
  'date.between': {
    example: '{{date.between(2024-01-01,2024-12-31)}}',
    description: 'ISO date-time between two dates',
    run: (ctx, a) => {
      const from = parseDateArg(a[0], 'date.between') ?? ctx.now - 365 * DAY;
      const to = parseDateArg(a[1], 'date.between') ?? ctx.now;
      return new Date(Math.min(from, to) + Math.floor(ctx.rng() * Math.abs(to - from))).toISOString();
    },
  },
  'date.day': {
    example: '{{date.day}}',
    description: 'Calendar date (YYYY-MM-DD) within the past year',
    run: (ctx) => new Date(ctx.now - Math.floor(ctx.rng() * 365) * DAY).toISOString().slice(0, 10),
  },
  'image.url': {
    example: '{{image.url(640,480)}}',
    description: 'Placeholder image URL (picsum.photos)',
    run: (ctx, a) => `https://picsum.photos/seed/${hex(ctx, 8)}/${num(a[0], 'image.url', 'width') ?? 640}/${num(a[1], 'image.url', 'height') ?? 480}`,
  },
};

export const GENERATOR_NAMES = Object.keys(GENERATORS);

/** Reference panel entries grouped by the part before the dot. */
export function referenceGroups(): { group: string; items: { name: string; example: string; description: string }[] }[] {
  const groups = new Map<string, { name: string; example: string; description: string }[]>();
  for (const [name, def] of Object.entries(GENERATORS)) {
    const group = name.includes('.') ? name.split('.')[0]! : 'basic';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push({ name, example: def.example, description: def.description });
  }
  groups.set('structure', [
    { name: 'repeat', example: '"{{repeat(5)}}"', description: 'First element of an array: repeat the next element 5 times' },
    { name: 'repeat', example: '"{{repeat(3,8)}}"', description: 'Repeat a random number of times in a range' },
  ]);
  return [...groups].map(([group, items]) => ({ group, items }));
}

// --- placeholders ----------------------------------------------------------------

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][\w.]*)\s*(?:\(([^)]*)\))?\s*\}\}/g;
const WHOLE = /^\{\{\s*([a-zA-Z_][\w.]*)\s*(?:\(([^)]*)\))?\s*\}\}$/;
const REPEAT = /^\{\{\s*repeat\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)\s*\}\}$/;

function splitArgs(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw.split(',').map((s) => s.trim().replace(/^(['"])(.*)\1$/, '$2'));
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

/** Closest known placeholder names for a typo, best first. */
export function suggest(name: string, limit = 3): string[] {
  const n = name.toLowerCase();
  // Compare against the full name and its last segment, so "emial" finds internet.email.
  return GENERATOR_NAMES.map((g) => ({ g, d: g.startsWith(n) || g.endsWith('.' + n) ? 0 : Math.min(levenshtein(n, g), levenshtein(n, g.split('.').pop()!)) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(n.length / 3)))
    .sort((a, b) => a.d - b.d || a.g.localeCompare(b.g))
    .slice(0, limit)
    .map((x) => x.g);
}

/** Every unknown placeholder in a parsed template, with suggestions. */
export function findUnknown(template: unknown): { name: string; suggestions: string[] }[] {
  const unknown = new Map<string, string[]>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (REPEAT.test(v)) return;
      for (const m of v.matchAll(PLACEHOLDER)) {
        const name = m[1]!;
        if (name !== 'repeat' && !GENERATORS[name] && !unknown.has(name)) unknown.set(name, suggest(name));
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(template);
  return [...unknown].map(([name, suggestions]) => ({ name, suggestions }));
}

// --- parsing and generation ------------------------------------------------------------

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) (line++, (start = i + 1));
  return { line, column: offset - start + 1 };
}

/** JSON.parse with a positioned MockError. */
export function parseTemplate(text: string): unknown {
  if (text.trim() === '') throw new MockError('The template is empty. Write some JSON, or load the sample.');
  try {
    return JSON.parse(text);
  } catch (err) {
    const scanned = scanJsonError(text);
    if (scanned) {
      const { line, column } = offsetToLineColumn(text, scanned.offset);
      throw new MockError(`Template is not valid JSON at line ${line}, column ${column}: ${scanned.message}.`, scanned.offset);
    }
    throw new MockError(`Template is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export interface GenerateOptions {
  seed: number;
  /** Base instant for relative dates. */
  now: number;
  /** Overrides the root repeat count when the root is a repeat array. */
  rootCount?: number;
}

/** Hard ceiling on generated array items so a typo cannot hang the tab. */
export const MAX_ITEMS = 50_000;
export const MAX_REPEAT = 10_000;

/** Repeat spec of an array template, or null when it is a plain array. */
export function repeatSpec(value: unknown): { min: number; max: number } | null {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return null;
  const m = REPEAT.exec(value[0]);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}

export function generate(template: unknown, options: GenerateOptions): unknown {
  const unknown = findUnknown(template);
  if (unknown.length) {
    const first = unknown[0]!;
    const hint = first.suggestions.length ? ` Did you mean ${first.suggestions.map((s) => `{{${s}}}`).join(' or ')}?` : '';
    const more = unknown.length > 1 ? ` (${unknown.length - 1} more unknown)` : '';
    throw new MockError(`Unknown placeholder {{${first.name}}}.${hint}${more}`);
  }
  const ctx: GenContext = { rng: createRng(options.seed), index: 0, now: options.now };
  let items = 0;

  const fill = (s: string): unknown => {
    const whole = WHOLE.exec(s);
    if (whole && whole[1] !== 'repeat') return GENERATORS[whole[1]!]!.run(ctx, splitArgs(whole[2]));
    if (!s.includes('{{')) return s;
    return s.replace(PLACEHOLDER, (match, name: string, args?: string) => {
      if (name === 'repeat') return match;
      const v = GENERATORS[name]!.run(ctx, splitArgs(args));
      return typeof v === 'string' ? v : JSON.stringify(v);
    });
  };

  const walk = (v: unknown, isRoot: boolean): unknown => {
    if (typeof v === 'string') return fill(v);
    if (Array.isArray(v)) {
      const spec = repeatSpec(v);
      if (!spec) return v.map((x) => walk(x, false));
      const body = v.slice(1);
      if (body.length === 0) return [];
      let count = isRoot && options.rootCount !== undefined ? options.rootCount : int(ctx, spec.min, spec.max);
      count = Math.max(0, Math.min(MAX_REPEAT, Math.floor(count)));
      const saved = ctx.index;
      const out: unknown[] = [];
      for (let i = 0; i < count; i++) {
        if (++items > MAX_ITEMS) throw new MockError(`The template would generate more than ${MAX_ITEMS.toLocaleString('en-US')} items. Lower the repeat counts.`);
        ctx.index = i;
        out.push(walk(body[i % body.length], false));
      }
      ctx.index = saved;
      return out;
    }
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, false);
      return out;
    }
    return v;
  };
  return walk(template, true);
}

/** Parse, generate and serialise in one call. */
export function run(text: string, options: GenerateOptions & { minify?: boolean }): { json: string; value: unknown; records: number | null } {
  const template = parseTemplate(text);
  const value = generate(template, options);
  const json = options.minify ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  return { json, value, records: Array.isArray(value) ? value.length : null };
}

// --- CSV --------------------------------------------------------------------------

/** True when the value is a non-empty array of objects whose values are all primitives. */
export function isFlatTable(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((r) => r && typeof r === 'object' && !Array.isArray(r) && Object.values(r).every((x) => x === null || typeof x !== 'object'))
  );
}

export function toCsv(rows: Record<string, unknown>[]): string {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const cell = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

/** Start of today in UTC: a stable base date so the same seed gives the same output all day. */
export function todayBase(now = Date.now()): number {
  return Math.floor(now / DAY) * DAY;
}

export const SAMPLE_TEMPLATE = `[
  "{{repeat(5)}}",
  {
    "id": "{{uuid}}",
    "index": "{{index(1)}}",
    "name": "{{name.full}}",
    "email": "{{internet.email}}",
    "age": "{{number.int(18,80)}}",
    "active": "{{boolean(0.7)}}",
    "balance": "{{finance.price(10,5000)}}",
    "currency": "{{finance.currency}}",
    "company": "{{company.name}}",
    "jobTitle": "{{company.job}}",
    "address": {
      "street": "{{address.street}}",
      "city": "{{address.city}}",
      "postcode": "{{address.postcode}}"
    },
    "tags": ["{{repeat(1,3)}}", "{{lorem.word}}"],
    "favoriteColor": "{{pick(red,green,blue)}}",
    "avatar": "{{image.url(128,128)}}",
    "registered": "{{date.past(3)}}",
    "greeting": "Hello {{name.first}}, you have {{number.int(1,9)}} new messages."
  }
]
`;
