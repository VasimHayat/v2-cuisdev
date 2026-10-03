/**
 * Cron Expression Parser: normalising, field breakdown and plain-English explanations
 * are pure and live here. cronstrue (sentence) and croner (next runs) are loaded on
 * first use so the page bundle stays small.
 */

export class CronError extends Error {
  override name = 'CronError';
  /** Field id the problem belongs to, when known. */
  field?: FieldId;
  constructor(message: string, field?: FieldId) {
    super(message);
    if (field) this.field = field;
  }
}

export type FieldId = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek' | 'year';
export type FieldCount = 5 | 6 | 7;

export interface FieldSpec {
  id: FieldId;
  name: string;
  unit: string;
  plural: string;
  allowed: string;
  min: number;
  max: number;
}

export interface FieldBreakdown extends FieldSpec {
  value: string;
  meaning: string;
}

export interface Normalized {
  expression: string;
  fieldCount: FieldCount;
  fields: string[];
  macro?: string;
}

export interface Preset {
  label: string;
  expression: string;
}

export const MACROS: Readonly<Record<string, string>> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

export const SAMPLE = '30 8 * * 1-5';

export const PRESETS: readonly Preset[] = [
  { label: 'Every minute', expression: '* * * * *' },
  { label: 'Every 5 minutes', expression: '*/5 * * * *' },
  { label: 'Every 15 minutes', expression: '*/15 * * * *' },
  { label: 'Every 30 minutes', expression: '*/30 * * * *' },
  { label: 'Every hour', expression: '0 * * * *' },
  { label: 'Every 6 hours', expression: '0 */6 * * *' },
  { label: 'Every day at midnight', expression: '0 0 * * *' },
  { label: 'Every day at 02:30', expression: '30 2 * * *' },
  { label: 'Every weekday at 09:00', expression: '0 9 * * 1-5' },
  { label: 'Weekdays every hour 9 to 17', expression: '0 9-17 * * 1-5' },
  { label: 'Every Sunday at 03:00', expression: '0 3 * * 0' },
  { label: 'First day of the month', expression: '0 0 1 * *' },
  { label: 'Last day of the month', expression: '0 0 L * *' },
  { label: 'Quarterly on the 1st', expression: '0 0 1 1,4,7,10 *' },
  { label: 'Every 10 seconds', expression: '*/10 * * * * *' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY_ABBR = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export const FIELD_SPECS: Record<FieldId, FieldSpec> = {
  second: { id: 'second', name: 'Second', unit: 'second', plural: 'seconds', allowed: '0-59', min: 0, max: 59 },
  minute: { id: 'minute', name: 'Minute', unit: 'minute', plural: 'minutes', allowed: '0-59', min: 0, max: 59 },
  hour: { id: 'hour', name: 'Hour', unit: 'hour', plural: 'hours', allowed: '0-23', min: 0, max: 23 },
  dayOfMonth: { id: 'dayOfMonth', name: 'Day of month', unit: 'day of the month', plural: 'days', allowed: '1-31, L, W', min: 1, max: 31 },
  month: { id: 'month', name: 'Month', unit: 'month', plural: 'months', allowed: '1-12 or JAN-DEC', min: 1, max: 12 },
  dayOfWeek: { id: 'dayOfWeek', name: 'Day of week', unit: 'day of the week', plural: 'days', allowed: '0-7 or SUN-SAT (0 and 7 are Sunday), L, #', min: 0, max: 7 },
  year: { id: 'year', name: 'Year', unit: 'year', plural: 'years', allowed: '1970-2099', min: 1970, max: 2099 },
};

export function fieldOrder(count: FieldCount): FieldId[] {
  if (count === 5) return ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];
  if (count === 6) return ['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];
  return ['second', 'minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek', 'year'];
}

// --- normalising -------------------------------------------------------------

/** Trim, collapse whitespace, expand macros and count fields (5, 6 or 7). */
export function normalizeExpression(text: string): Normalized {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed === '') throw new CronError('Type a cron expression such as */15 * * * *');
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('@')) {
    const expanded = MACROS[lower];
    if (!expanded) throw new CronError(`Unknown shorthand "${trimmed}". Supported: ${Object.keys(MACROS).join(', ')}.`);
    return { expression: expanded, fieldCount: 5, fields: expanded.split(' '), macro: lower };
  }
  const fields = trimmed.split(' ');
  if (fields.length < 5 || fields.length > 7) {
    throw new CronError(`A cron expression has 5 fields (minute hour day-of-month month day-of-week), optionally 6 with leading seconds or 7 with a trailing year. This one has ${fields.length}.`);
  }
  return { expression: fields.join(' '), fieldCount: fields.length as FieldCount, fields };
}

// --- explaining --------------------------------------------------------------

function nameOf(spec: FieldSpec, n: number): string {
  if (spec.id === 'dayOfWeek') return WEEKDAYS[n % 7] ?? String(n);
  if (spec.id === 'month') return MONTHS[n - 1] ?? String(n);
  if (spec.id === 'hour') return `${String(n).padStart(2, '0')}:00`;
  if (spec.id === 'dayOfMonth') return ordinal(n);
  return String(n);
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

function toNumber(spec: FieldSpec, token: string): number {
  const t = token.toUpperCase();
  if (spec.id === 'dayOfWeek' && WEEKDAY_ABBR.includes(t)) return WEEKDAY_ABBR.indexOf(t);
  if (spec.id === 'month' && MONTH_ABBR.includes(t)) return MONTH_ABBR.indexOf(t) + 1;
  if (!/^\d+$/.test(token)) throw new CronError(`"${token}" is not a valid ${spec.unit} value. Allowed: ${spec.allowed}.`, spec.id);
  const n = Number(token);
  if (n < spec.min || n > spec.max) throw new CronError(`${spec.name} value ${n} is out of range. Allowed: ${spec.allowed}.`, spec.id);
  return n;
}

function explainPart(spec: FieldSpec, part: string): string {
  const p = part.trim();
  if (p === '*' || p === '?') return p === '?' ? `any ${spec.unit} (no restriction)` : `every ${spec.unit}`;
  // Special day-of-month / day-of-week tokens
  if (spec.id === 'dayOfMonth') {
    if (/^L$/i.test(p)) return 'the last day of the month';
    if (/^L-\d+$/i.test(p)) return `${p.slice(2)} day${p.slice(2) === '1' ? '' : 's'} before the end of the month`;
    if (/^\d+W$/i.test(p)) return `the weekday nearest the ${ordinal(Number(p.slice(0, -1)))}`;
    if (/^LW$/i.test(p)) return 'the last weekday of the month';
  }
  if (spec.id === 'dayOfWeek') {
    const nth = /^([0-7]|[A-Z]{3})#([1-5])$/i.exec(p);
    if (nth) return `the ${ordinal(Number(nth[2]))} ${WEEKDAYS[toNumber(spec, nth[1]!) % 7]} of the month`;
    const last = /^([0-7]|[A-Z]{3})L$/i.exec(p);
    if (last) return `the last ${WEEKDAYS[toNumber(spec, last[1]!) % 7]} of the month`;
  }
  // Steps
  const step = /^(.+)\/(\d+)$/.exec(p);
  if (step) {
    const base = step[1]!;
    const every = Number(step[2]);
    if (every < 1) throw new CronError(`Step value must be at least 1 in "${p}".`, spec.id);
    const unitWord = every === 1 ? spec.unit : spec.plural;
    if (base === '*') return `every ${every === 1 ? '' : every + ' '}${unitWord}`.replace('  ', ' ');
    const range = /^(\w+)-(\w+)$/.exec(base);
    if (range) {
      const a = toNumber(spec, range[1]!);
      const b = toNumber(spec, range[2]!);
      return `every ${every} ${unitWord} from ${nameOf(spec, a)} to ${nameOf(spec, b)}`;
    }
    const start = toNumber(spec, base);
    return `every ${every} ${unitWord} starting at ${nameOf(spec, start)}`;
  }
  // Ranges
  const range = /^(\w+)-(\w+)$/.exec(p);
  if (range) {
    const a = toNumber(spec, range[1]!);
    const b = toNumber(spec, range[2]!);
    if (a > b && spec.id !== 'dayOfWeek') throw new CronError(`Range "${p}" runs backwards: ${a} is greater than ${b}.`, spec.id);
    return `${nameOf(spec, a)} to ${nameOf(spec, b)}`;
  }
  const n = toNumber(spec, p);
  return nameOf(spec, n);
}

// Plain-English meaning of one field value such as "*/15" or "1-5".
export function explainField(spec: FieldSpec, value: string): string {
  const v = value.trim();
  if (v === '') throw new CronError(`${spec.name} is empty.`, spec.id);
  const parts = v.split(',');
  if (parts.some((x) => x === '')) throw new CronError(`${spec.name} has an empty list item in "${v}".`, spec.id);
  const meanings = parts.map((part) => explainPart(spec, part));
  if (meanings.length === 1) return meanings[0]!;
  return meanings.slice(0, -1).join(', ') + ' and ' + meanings[meanings.length - 1];
}

/** Break an expression into named fields with raw values and meanings. Throws CronError. */
export function splitFields(text: string): { normalized: Normalized; fields: FieldBreakdown[] } {
  const normalized = normalizeExpression(text);
  const order = fieldOrder(normalized.fieldCount);
  const fields = order.map((id, i) => {
    const spec = FIELD_SPECS[id];
    const value = normalized.fields[i]!;
    return { ...spec, value, meaning: explainField(spec, value) };
  });
  return { normalized, fields };
}

/** Returns null when valid, otherwise the CronError (with field when known). */
export function validate(text: string): CronError | null {
  try {
    splitFields(text);
    return null;
  } catch (err) {
    return err instanceof CronError ? err : new CronError(String(err));
  }
}

/** True when both day-of-month and day-of-week are restricted (classic cron ORs them). */
export function usesLegacyOr(normalized: Normalized): boolean {
  const order = fieldOrder(normalized.fieldCount);
  const dom = normalized.fields[order.indexOf('dayOfMonth')] ?? '*';
  const dow = normalized.fields[order.indexOf('dayOfWeek')] ?? '*';
  const restricted = (v: string) => v !== '*' && v !== '?';
  return restricted(dom) && restricted(dow);
}

// --- libraries ---------------------------------------------------------------

type Cronstrue = typeof import('cronstrue');
type Croner = typeof import('croner');
let cronstruePromise: Promise<Cronstrue> | undefined;
let cronerPromise: Promise<Croner> | undefined;

function loadCronstrue(): Promise<Cronstrue> {
  cronstruePromise ??= import('cronstrue');
  return cronstruePromise;
}
function loadCroner(): Promise<Croner> {
  cronerPromise ??= import('croner');
  return cronerPromise;
}

/** English sentence for the expression, e.g. "At 09:00, Monday through Friday". */
export async function describe(text: string): Promise<string> {
  const { normalized } = splitFields(text);
  const mod = await loadCronstrue();
  const toString = (mod as unknown as { toString?: Cronstrue['toString'] }).toString ?? (mod as unknown as { default: Cronstrue }).default.toString;
  try {
    const sentence = toString(normalized.expression, { use24HourTimeFormat: true, verbose: false, throwExceptionOnParseError: true });
    return sentence.replace(/\s+/g, ' ').trim();
  } catch (err) {
    throw new CronError(typeof err === 'string' ? err : err instanceof Error ? err.message : 'The expression could not be described.');
  }
}

export interface NextRunsResult {
  dates: Date[];
  /** True when day-of-month and day-of-week are both restricted and were combined with OR. */
  legacyOr: boolean;
}

/** Next `count` run times after `from`, interpreted in `timeZone` (IANA). */
export async function nextRuns(text: string, count = 10, timeZone?: string, from: Date = new Date()): Promise<NextRunsResult> {
  const { normalized } = splitFields(text);
  const { Cron } = await loadCroner();
  const legacyOr = usesLegacyOr(normalized);
  let job: InstanceType<Croner['Cron']>;
  try {
    const mode = normalized.fieldCount === 5 ? '5-part' : normalized.fieldCount === 6 ? '6-part' : '7-part';
    // Classic cron semantics: when both day fields are restricted, a day matching either one runs.
    job = new Cron(normalized.expression, { timezone: timeZone, domAndDow: false, mode, paused: true });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    throw new CronError(raw.replace(/^CronPattern:\s*/, ''));
  }
  const dates = job.nextRuns(Math.max(1, Math.min(100, count)), from);
  job.stop();
  return { dates, legacyOr };
}

// --- presentation ------------------------------------------------------------

/** "every 15 minutes" when the gaps between runs are equal, "irregular" otherwise. */
export function intervalSummary(dates: readonly Date[]): string {
  if (dates.length < 2) return '';
  const gaps = dates.slice(1).map((d, i) => d.getTime() - dates[i]!.getTime());
  const first = gaps[0]!;
  if (!gaps.every((g) => g === first)) return 'irregular interval';
  return `every ${humanDuration(first)}`;
}

export function humanDuration(ms: number): string {
  const units: [number, string][] = [
    [7 * 86_400_000, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second'],
  ];
  for (const [size, unit] of units) {
    if (ms % size === 0) {
      const n = ms / size;
      return n === 1 ? unit : `${n} ${unit}s`;
    }
    if (ms >= size) {
      const n = Math.round((ms / size) * 10) / 10;
      return `${n} ${unit}s`;
    }
  }
  return `${ms} ms`;
}

/** "in 3 hours", "in 2 days", "4 minutes ago". */
export function formatRelative(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  if (abs < 1_000) return 'now';
  const units: [number, string][] = [
    [365 * 86_400_000, 'year'],
    [30 * 86_400_000, 'month'],
    [7 * 86_400_000, 'week'],
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second'],
  ];
  for (const [size, unit] of units) {
    if (abs >= size) {
      const n = Math.round(abs / size);
      const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
      return diff > 0 ? `in ${label}` : `${label} ago`;
    }
  }
  return 'now';
}

/** Date formatted in a zone: "Mon 05 Oct 2026, 09:00:00". */
export function formatInZone(date: Date, timeZone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** "UTC+05:30" style label for a zone at an instant. */
export function zoneOffsetLabel(date: Date, timeZone: string | undefined): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(date);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    return name === 'GMT' ? 'UTC' : name.replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

export function listTimeZones(): string[] {
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones && zones.length) return ['UTC', ...zones.filter((z) => z !== 'UTC')];
  } catch {}
  return ['UTC', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];
}

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
