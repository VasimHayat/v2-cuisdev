/**
 * Timestamp Converter: pure functions, no DOM. Parses Unix timestamps in any unit,
 * ISO 8601, RFC 2822, plain date-time text and a few shortcuts, and derives every
 * representation of an instant in a chosen IANA time zone. Functions that need the
 * current time take it as an argument so tests are deterministic.
 */

export class TimestampError extends Error {
  override name = 'TimestampError';
}

export type TimestampUnit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds';
export type UnitChoice = TimestampUnit | 'auto';

export interface Parsed {
  /** Milliseconds since the Unix epoch. */
  ms: number;
  /** What the input was read as, e.g. "Unix seconds" or "ISO 8601". */
  detected: string;
}

export interface Row {
  id: string;
  label: string;
  value: string;
  /** Short hint shown under the label. */
  hint?: string;
}

export interface ParseOptions {
  assume?: UnitChoice;
  now?: Date;
  /** IANA zone for date text without an offset. Defaults to the browser's local zone. */
  timeZone?: string;
}

/** The largest absolute time value a JavaScript Date can hold. */
export const MAX_TIME_MS = 8_640_000_000_000_000;

/** 2026-01-01T00:00:00Z, used for the sample. */
export const SAMPLE_INPUT = '1767225600';

export const UNIT_LABELS: Record<TimestampUnit, string> = {
  seconds: 'Unix seconds',
  milliseconds: 'Unix milliseconds',
  microseconds: 'Unix microseconds',
  nanoseconds: 'Unix nanoseconds',
};

const UNIT_PER_MS: Record<TimestampUnit, number> = { seconds: 0.001, milliseconds: 1, microseconds: 1000, nanoseconds: 1_000_000 };

/** Common zones offered as a fallback when Intl.supportedValuesOf is missing. */
export const FALLBACK_ZONES: readonly string[] = [
  'UTC', 'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/Mexico_City', 'America/New_York',
  'America/Toronto', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'Europe/London', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Warsaw', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg', 'Asia/Jerusalem',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Tokyo',
  'Asia/Seoul', 'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
];

export const QUICK_ZONES: { label: string; zone: string }[] = [
  { label: 'UTC', zone: 'UTC' },
  { label: 'New York', zone: 'America/New_York' },
  { label: 'London', zone: 'Europe/London' },
  { label: 'Berlin', zone: 'Europe/Berlin' },
  { label: 'Kolkata', zone: 'Asia/Kolkata' },
  { label: 'Tokyo', zone: 'Asia/Tokyo' },
  { label: 'Sydney', zone: 'Australia/Sydney' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const NUMERIC = /^[+-]?\d+(\.\d+)?$/;
const RFC2822 = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{2,4}\s+\d{2}:\d{2}(?::\d{2})?\s*(?:GMT|UTC|UT|[A-Z]{3}|[+-]\d{4})?$/i;

// --- time zones ------------------------------------------------------------------

/** IANA zone names, UTC first, from the browser when available. */
export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof intl.supportedValuesOf === 'function') zones = intl.supportedValuesOf('timeZone');
  } catch {}
  if (zones.length === 0) zones = [...FALLBACK_ZONES];
  const set = new Set(['UTC', ...zones]);
  return [...set];
}

export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Offset of a zone from UTC in milliseconds at a given instant. */
export function zoneOffsetMs(ms: number, timeZone: string): number {
  const date = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    era: 'short',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const era = parts.find((p) => p.type === 'era')?.value ?? 'AD';
  let year = get('year');
  if (/^B/i.test(era)) year = 1 - year;
  const asUtc = Date.UTC(year, get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** "UTC+05:30", "UTC-04:00", "UTC". */
export function zoneOffsetLabel(ms: number, timeZone: string): string {
  const offset = zoneOffsetMs(ms, timeZone);
  if (offset === 0) return 'UTC';
  return `UTC${formatOffset(offset, false)}`;
}

/** +05:30, -05:00, Z (or +00:00 when `zAllowed` is false). */
export function formatOffset(offsetMs: number, zAllowed = true): string {
  if (offsetMs === 0) return zAllowed ? 'Z' : '+00:00';
  const sign = offsetMs < 0 ? '-' : '+';
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A Date whose UTC getters report the wall clock of `timeZone`. Only read with getUTC*. */
function wallClock(ms: number, timeZone: string): Date {
  return new Date(ms + zoneOffsetMs(ms, timeZone));
}

function pad(value: number, length = 2): string {
  return String(Math.abs(Math.trunc(value))).padStart(length, '0');
}

// --- parsing ---------------------------------------------------------------------

/** Strip the separators people paste: spaces, underscores, thousands commas. */
export function cleanNumeric(input: string): string {
  return input.trim().replace(/[\s_]/g, '').replace(/,/g, '');
}

/** Ten digits are seconds, thirteen milliseconds, sixteen microseconds, nineteen nanoseconds. */
export function detectUnit(value: number): TimestampUnit {
  const magnitude = Math.abs(value);
  if (magnitude < 1e11) return 'seconds';
  if (magnitude < 1e14) return 'milliseconds';
  if (magnitude < 1e17) return 'microseconds';
  return 'nanoseconds';
}

function fromNumber(value: number, unit: TimestampUnit): number {
  const ms = value / UNIT_PER_MS[unit];
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_TIME_MS) {
    throw new TimestampError(`That value is outside the range a date can represent (about 270,000 years either side of 1970). Check whether it is really in ${UNIT_LABELS[unit].toLowerCase()}.`);
  }
  return ms;
}

const SHORTCUT_UNITS: Record<string, number> = { s: 1000, sec: 1000, second: 1000, seconds: 1000, m: 60_000, min: 60_000, minute: 60_000, minutes: 60_000, h: 3_600_000, hr: 3_600_000, hour: 3_600_000, hours: 3_600_000, d: 86_400_000, day: 86_400_000, days: 86_400_000, w: 7 * 86_400_000, week: 7 * 86_400_000, weeks: 7 * 86_400_000 };

/**
 * Parse anything a person might paste: a Unix timestamp in any unit, ISO 8601 with or
 * without an offset, RFC 2822, "YYYY-MM-DD HH:mm[:ss]", or the shortcuts now, today,
 * yesterday, tomorrow, +2h, -3d. Throws TimestampError with a helpful message.
 */
export function parseInput(text: string, options: ParseOptions = {}): Parsed {
  const now = options.now ?? new Date();
  const assume = options.assume ?? 'auto';
  const raw = text.trim();
  if (raw === '') throw new TimestampError('Enter a timestamp or a date, for example 1767225600 or 2026-01-01T09:30:00Z.');

  const lower = raw.toLowerCase();
  if (lower === 'now') return { ms: now.getTime(), detected: 'Now' };
  if (lower === 'today' || lower === 'yesterday' || lower === 'tomorrow') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    if (lower === 'yesterday') d.setDate(d.getDate() - 1);
    if (lower === 'tomorrow') d.setDate(d.getDate() + 1);
    return { ms: d.getTime(), detected: `${lower[0]!.toUpperCase()}${lower.slice(1)} at local midnight` };
  }
  const rel = /^([+-])\s*(\d+(?:\.\d+)?)\s*([a-z]+)$/.exec(lower);
  if (rel) {
    const size = SHORTCUT_UNITS[rel[3]!];
    if (!size) throw new TimestampError(`Unknown unit "${rel[3]}" in "${raw}". Use s, m, h, d or w, for example +2h or -3d.`);
    const delta = Number(rel[2]) * size * (rel[1] === '-' ? -1 : 1);
    return { ms: now.getTime() + delta, detected: `Now ${rel[1]}${rel[2]}${rel[3]}` };
  }

  const cleaned = cleanNumeric(raw);
  if (NUMERIC.test(cleaned)) {
    const value = Number(cleaned);
    if (!Number.isFinite(value)) throw new TimestampError('That number is too large to read as a timestamp.');
    const unit = assume === 'auto' ? detectUnit(value) : assume;
    return { ms: fromNumber(value, unit), detected: `${UNIT_LABELS[unit]}${assume === 'auto' ? ' (detected)' : ''}` };
  }

  // Plain "YYYY-MM-DD HH:mm[:ss[.sss]]" or "YYYY-MM-DD" without an offset: wall clock of the
  // chosen zone, or the browser's local zone when none is given.
  const plain = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(raw);
  if (plain) {
    const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '0'] = plain;
    const check = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
    if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) throw new TimestampError(`"${raw}" is not a real calendar date.`);
    const millis = Number(frac.padEnd(3, '0'));
    const zone = options.timeZone;
    const ms = zone
      ? zonedPartsToMs(`${y}-${mo}-${d}`, `${pad(Number(h))}:${pad(Number(mi))}:${pad(Number(s))}`, zone) + millis
      : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), millis).getTime();
    const where = zone ? `in ${zone}` : 'local';
    return { ms, detected: plain[4] ? `Date and time (${where}, no offset given)` : `Date (midnight ${where})` };
  }

  if (RFC2822.test(raw)) {
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return { ms, detected: 'RFC 2822' };
  }

  const isoLike = /^[+-]?\d{4,6}-\d{2}-\d{2}T/.test(raw);
  const ms = Date.parse(raw);
  if (!Number.isNaN(ms)) {
    const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    if (isoLike && !hasOffset && options.timeZone) {
      // Date.parse read it as local time; re-read the same wall clock in the chosen zone.
      const local = new Date(ms);
      const shifted = zonedPartsToMs(
        `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
        `${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`,
        options.timeZone,
      );
      return { ms: shifted + local.getMilliseconds(), detected: `ISO 8601 (in ${options.timeZone}, no offset given)` };
    }
    return { ms, detected: isoLike ? `ISO 8601${hasOffset ? '' : ' (local, no offset given)'}` : 'Date text' };
  }
  throw new TimestampError(`"${raw}" could not be read as a timestamp or date. Try Unix seconds (1767225600), ISO 8601 (2026-01-01T09:30:00Z), RFC 2822, or a shortcut such as now, +2h or -3d.`);
}

// --- formatting -------------------------------------------------------------------

export function toIsoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

/** ISO 8601 with the zone's own offset, e.g. 2026-01-01T05:30:00+05:30. */
export function toIsoWithOffset(ms: number, timeZone: string): string {
  const offset = zoneOffsetMs(ms, timeZone);
  const local = wallClock(ms, timeZone);
  const year = local.getUTCFullYear();
  const yearText = year < 0 ? `-${pad(year, 6)}` : year > 9999 ? `+${pad(year, 6)}` : pad(year, 4);
  const millis = local.getUTCMilliseconds();
  return `${yearText}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${millis ? `.${pad(millis, 3)}` : ''}${formatOffset(offset, false)}`;
}

/** RFC 2822 / HTTP date in UTC, e.g. Thu, 01 Jan 2026 00:00:00 GMT. */
export function toRfc2822(ms: number): string {
  const date = new Date(ms);
  return `${WEEKDAYS_SHORT[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS_SHORT[date.getUTCMonth()]} ${pad(date.getUTCFullYear(), 4)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT`;
}

/** RFC 3339 in UTC with milliseconds, e.g. 2026-01-01T00:00:00.000+00:00 */
export function toRfc3339(ms: number): string {
  return toIsoUtc(ms).replace(/Z$/, '+00:00');
}

export function dayOfYear(ms: number, timeZone: string): number {
  const local = wallClock(ms, timeZone);
  const startOfYear = Date.UTC(local.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - startOfYear) / 86_400_000) + 1;
}

export function daysInYear(ms: number, timeZone: string): number {
  const year = wallClock(ms, timeZone).getUTCFullYear();
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365;
}

/** ISO 8601 week number and its week-numbering year. */
export function isoWeek(ms: number, timeZone: string): { year: number; week: number } {
  const local = wallClock(ms, timeZone);
  const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return { year: date.getUTCFullYear(), week };
}

export function weekdayName(ms: number, timeZone: string): string {
  return WEEKDAYS[wallClock(ms, timeZone).getUTCDay()] ?? 'Sunday';
}

export function quarter(ms: number, timeZone: string): number {
  return Math.floor(wallClock(ms, timeZone).getUTCMonth() / 3) + 1;
}

/** "in 3 hours", "2 days ago", "just now". */
export function formatRelative(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  if (abs < 1_000) return 'just now';
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
  return 'just now';
}

/** Full date and time in the zone, e.g. Thursday, 1 January 2026 at 05:30:00 IST. */
export function formatHuman(ms: number, timeZone: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'full', timeStyle: 'long', hour12: false }).format(new Date(ms));
}

/** Excel serial date (days since 1899-12-30, in the zone's wall clock). */
export function excelSerial(ms: number, timeZone: string): number {
  const local = wallClock(ms, timeZone);
  return Math.round(((local.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000) * 1e8) / 1e8;
}

/** .NET DateTime ticks (100 ns since 0001-01-01 UTC). */
export function dotNetTicks(ms: number): string {
  const EPOCH_TICKS = 621_355_968_000_000_000n;
  return (EPOCH_TICKS + BigInt(Math.round(ms)) * 10_000n).toString();
}

/** Windows FILETIME (100 ns since 1601-01-01 UTC). */
export function windowsFileTime(ms: number): string {
  const EPOCH_FT = 116_444_736_000_000_000n;
  return (EPOCH_FT + BigInt(Math.round(ms)) * 10_000n).toString();
}

export function unixSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** Every representation of one instant, in display order. */
export function formatAll(ms: number, timeZone: string, now: Date = new Date()): Row[] {
  const week = isoWeek(ms, timeZone);
  const label = zoneOffsetLabel(ms, timeZone);
  return [
    { id: 'seconds', label: 'Unix seconds', value: String(unixSeconds(ms)) },
    { id: 'milliseconds', label: 'Unix milliseconds', value: String(Math.round(ms)) },
    { id: 'iso-utc', label: 'ISO 8601 (UTC)', value: toIsoUtc(ms) },
    { id: 'iso-zone', label: `ISO 8601 (${timeZone})`, value: toIsoWithOffset(ms, timeZone), hint: label },
    { id: 'rfc2822', label: 'RFC 2822', value: toRfc2822(ms) },
    { id: 'rfc3339', label: 'RFC 3339', value: toRfc3339(ms) },
    { id: 'human', label: `Date and time (${timeZone})`, value: formatHuman(ms, timeZone) },
    { id: 'relative', label: 'Relative to now', value: formatRelative(ms, now.getTime()) },
    { id: 'weekday', label: 'Day of week', value: weekdayName(ms, timeZone) },
    { id: 'day-of-year', label: 'Day of year', value: `${dayOfYear(ms, timeZone)} of ${daysInYear(ms, timeZone)}` },
    { id: 'iso-week', label: 'ISO week', value: `${week.year}-W${pad(week.week)}` },
    { id: 'quarter', label: 'Quarter', value: `Q${quarter(ms, timeZone)} ${wallClock(ms, timeZone).getUTCFullYear()}` },
    { id: 'excel', label: 'Excel serial date', value: String(excelSerial(ms, timeZone)), hint: 'days since 1899-12-30' },
    { id: 'dotnet', label: '.NET ticks', value: dotNetTicks(ms), hint: '100 ns since 0001-01-01' },
    { id: 'filetime', label: 'Windows FILETIME', value: windowsFileTime(ms), hint: '100 ns since 1601-01-01' },
    { id: 'nanoseconds', label: 'Unix nanoseconds', value: (BigInt(Math.round(ms)) * 1_000_000n).toString() },
  ];
}

// --- date picker helpers ------------------------------------------------------------

/** "2026-01-01" and "09:30:00" wall-clock parts in the zone, for date and time inputs. */
export function msToZonedParts(ms: number, timeZone: string): { date: string; time: string } {
  const local = wallClock(ms, timeZone);
  return {
    date: `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`,
  };
}

/** Wall clock "YYYY-MM-DD" + "HH:mm[:ss]" in the zone to milliseconds, DST-aware. */
export function zonedPartsToMs(date: string, time: string, timeZone: string): number {
  const m = /^(-?\d{4,6})-(\d{2})-(\d{2})$/.exec(date.trim());
  const t = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim() || '00:00');
  if (!m || !t) throw new TimestampError('Pick a valid date and time.');
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]), Number(t[3] ?? '0'));
  const firstGuess = naive - zoneOffsetMs(naive, timeZone);
  return naive - zoneOffsetMs(firstGuess, timeZone);
}

// --- batch -----------------------------------------------------------------------

export interface BatchRow {
  input: string;
  ms?: number;
  iso?: string;
  seconds?: number;
  zone?: string;
  error?: string;
}

/** Convert each non-empty line; errors are reported per line. */
export function convertBatch(text: string, timeZone: string, options: ParseOptions = {}): BatchRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .map((input) => {
      try {
        const { ms } = parseInput(input, { timeZone, ...options });
        return { input, ms, iso: toIsoUtc(ms), seconds: unixSeconds(ms), zone: toIsoWithOffset(ms, timeZone) };
      } catch (err) {
        return { input, error: err instanceof Error ? err.message : String(err) };
      }
    });
}

export function batchToCsv(rows: BatchRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ['input,unix_seconds,iso_utc,iso_zone,error'];
  for (const r of rows) lines.push([r.input, r.seconds?.toString() ?? '', r.iso ?? '', r.zone ?? '', r.error ?? ''].map(esc).join(','));
  return lines.join('\n') + '\n';
}
