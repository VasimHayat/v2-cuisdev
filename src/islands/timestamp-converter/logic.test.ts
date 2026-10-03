import { describe, expect, it } from 'vitest';
import {
  TimestampError,
  batchToCsv,
  convertBatch,
  dayOfYear,
  detectUnit,
  dotNetTicks,
  excelSerial,
  formatAll,
  formatRelative,
  isoWeek,
  msToZonedParts,
  parseInput,
  toIsoWithOffset,
  toRfc2822,
  windowsFileTime,
  zoneOffsetLabel,
  zonedPartsToMs,
} from './logic';

const NOW = new Date('2026-10-03T12:00:00Z');
const FIXED = 1_700_000_000_000; // 2023-11-14T22:13:20Z

describe('parseInput numbers', () => {
  it('detects seconds, milliseconds, microseconds and nanoseconds by magnitude', () => {
    expect(detectUnit(1_700_000_000)).toBe('seconds');
    expect(detectUnit(1_700_000_000_000)).toBe('milliseconds');
    expect(detectUnit(1_700_000_000_000_000)).toBe('microseconds');
    expect(detectUnit(1.7e18)).toBe('nanoseconds');
    expect(parseInput('1700000000').ms).toBe(FIXED);
    expect(parseInput('1700000000000').ms).toBe(FIXED);
    expect(parseInput('1700000000000000').ms).toBe(FIXED);
    expect(parseInput('1700000000000000000').ms).toBe(FIXED);
    expect(parseInput('1700000000').detected).toBe('Unix seconds (detected)');
  });
  it('honours an explicit unit and tolerates separators', () => {
    expect(parseInput('1700000000', { assume: 'milliseconds' }).ms).toBe(1_700_000_000);
    expect(parseInput('1,700,000,000').ms).toBe(FIXED);
    expect(parseInput('1_700_000_000').ms).toBe(FIXED);
    expect(parseInput('1700000000', { assume: 'seconds' }).detected).toBe('Unix seconds');
  });
  it('rejects values outside the Date range', () => {
    expect(() => parseInput('9'.repeat(30), { assume: 'seconds' })).toThrow(TimestampError);
  });
});

describe('parseInput text', () => {
  it('reads ISO 8601 with Z and with an offset', () => {
    expect(parseInput('2023-11-14T22:13:20Z')).toEqual({ ms: FIXED, detected: 'ISO 8601' });
    expect(parseInput('2023-11-15T03:43:20+05:30').ms).toBe(FIXED);
  });
  it('reads RFC 2822', () => {
    expect(parseInput('Tue, 14 Nov 2023 22:13:20 GMT')).toEqual({ ms: FIXED, detected: 'RFC 2822' });
    expect(parseInput('14 Nov 2023 22:13:20 +0000').ms).toBe(FIXED);
  });
  it('reads plain date-time as the local wall clock', () => {
    const r = parseInput('2023-11-14 22:13');
    expect(r.ms).toBe(new Date(2023, 10, 14, 22, 13).getTime());
    expect(r.detected).toMatch(/local/);
    expect(parseInput('2023-11-14').ms).toBe(new Date(2023, 10, 14).getTime());
    expect(() => parseInput('2023-02-30')).toThrow(/not a real calendar date/);
  });
  it('supports shortcuts relative to now', () => {
    expect(parseInput('now', { now: NOW }).ms).toBe(NOW.getTime());
    expect(parseInput('+2h', { now: NOW }).ms).toBe(NOW.getTime() + 7_200_000);
    expect(parseInput('-3d', { now: NOW }).ms).toBe(NOW.getTime() - 3 * 86_400_000);
    const yesterday = new Date(NOW);
    yesterday.setHours(0, 0, 0, 0);
    yesterday.setDate(yesterday.getDate() - 1);
    expect(parseInput('yesterday', { now: NOW })).toEqual({ ms: yesterday.getTime(), detected: 'Yesterday at local midnight' });
    expect(() => parseInput('+2q', { now: NOW })).toThrow(/Unknown unit/);
  });
  it('explains unreadable input', () => {
    expect(() => parseInput('')).toThrow(/Enter a timestamp/);
    expect(() => parseInput('next blue moon')).toThrow(/could not be read/);
  });
});

describe('formatting', () => {
  it('formats a fixed instant in UTC', () => {
    const rows = Object.fromEntries(formatAll(FIXED, 'UTC', NOW).map((r) => [r.id, r.value]));
    expect(rows['seconds']).toBe('1700000000');
    expect(rows['iso-utc']).toBe('2023-11-14T22:13:20.000Z');
    expect(rows['iso-zone']).toBe('2023-11-14T22:13:20+00:00');
    expect(rows['rfc2822']).toBe('Tue, 14 Nov 2023 22:13:20 GMT');
    expect(rows['weekday']).toBe('Tuesday');
    expect(rows['quarter']).toBe('Q4 2023');
    expect(rows['relative']).toBe('3 years ago');
    expect(rows['nanoseconds']).toBe('1700000000000000000');
    expect(toRfc2822(FIXED)).toBe('Tue, 14 Nov 2023 22:13:20 GMT');
  });
  it('applies a zone offset (Asia/Kolkata)', () => {
    expect(zoneOffsetLabel(FIXED, 'Asia/Kolkata')).toBe('UTC+05:30');
    expect(toIsoWithOffset(FIXED, 'Asia/Kolkata')).toBe('2023-11-15T03:43:20+05:30');
    expect(zoneOffsetLabel(FIXED, 'UTC')).toBe('UTC');
    expect(zoneOffsetLabel(FIXED, 'America/New_York')).toBe('UTC-05:00');
    const rows = Object.fromEntries(formatAll(FIXED, 'Asia/Kolkata', NOW).map((r) => [r.id, r.value]));
    expect(rows['weekday']).toBe('Wednesday');
  });
  it('computes ISO week and day of year', () => {
    const jan1_2021 = Date.UTC(2021, 0, 1);
    expect(isoWeek(jan1_2021, 'UTC')).toEqual({ year: 2020, week: 53 });
    expect(isoWeek(FIXED, 'UTC')).toEqual({ year: 2023, week: 46 });
    expect(dayOfYear(Date.UTC(2024, 11, 31), 'UTC')).toBe(366);
    expect(dayOfYear(FIXED, 'UTC')).toBe(318);
  });
  it('produces Excel, .NET and FILETIME values', () => {
    expect(excelSerial(0, 'UTC')).toBe(25569);
    expect(dotNetTicks(0)).toBe('621355968000000000');
    expect(windowsFileTime(0)).toBe('116444736000000000');
  });
  it('formats relative times', () => {
    expect(formatRelative(NOW.getTime() + 3 * 3_600_000, NOW.getTime())).toBe('in 3 hours');
    expect(formatRelative(NOW.getTime() - 2 * 86_400_000, NOW.getTime())).toBe('2 days ago');
    expect(formatRelative(NOW.getTime(), NOW.getTime())).toBe('just now');
  });
});

describe('date picker and batch', () => {
  it('round-trips wall-clock parts in a zone, across DST', () => {
    expect(msToZonedParts(FIXED, 'Asia/Kolkata')).toEqual({ date: '2023-11-15', time: '03:43:20' });
    expect(zonedPartsToMs('2023-11-15', '03:43:20', 'Asia/Kolkata')).toBe(FIXED);
    // New York summer time (UTC-4)
    expect(zonedPartsToMs('2026-07-01', '09:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 13, 0));
    expect(() => zonedPartsToMs('bad', '09:00', 'UTC')).toThrow(TimestampError);
  });
  it('converts a batch with good and bad lines and exports CSV', () => {
    const rows = convertBatch('1700000000\n\n  nope \n2023-11-14T22:13:20Z', 'UTC');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ input: '1700000000', seconds: 1_700_000_000, iso: '2023-11-14T22:13:20.000Z' });
    expect(rows[1]!.error).toMatch(/could not be read/);
    expect(rows[2]!.ms).toBe(FIXED);
    const csv = batchToCsv(rows);
    expect(csv.split('\n')[0]).toBe('input,unix_seconds,iso_utc,iso_zone,error');
    expect(csv.split('\n')[1]).toBe('1700000000,1700000000,2023-11-14T22:13:20.000Z,2023-11-14T22:13:20+00:00,');
  });
});

describe('zone-aware parsing', () => {
  it('reads offset-free text in the chosen zone', () => {
    expect(parseInput('2023-11-15 03:43:20', { timeZone: 'Asia/Kolkata' })).toEqual({ ms: 1_700_000_000_000, detected: 'Date and time (in Asia/Kolkata, no offset given)' });
    expect(parseInput('2023-11-14T22:13:20', { timeZone: 'UTC' }).ms).toBe(1_700_000_000_000);
    expect(parseInput('2023-11-14', { timeZone: 'UTC' }).ms).toBe(Date.UTC(2023, 10, 14));
  });
  it('handles daylight saving and leaves explicit offsets alone', () => {
    expect(parseInput('2026-07-01 12:00', { timeZone: 'America/New_York' }).ms).toBe(Date.UTC(2026, 6, 1, 16));
    expect(parseInput('2026-01-01 12:00', { timeZone: 'America/New_York' }).ms).toBe(Date.UTC(2026, 0, 1, 17));
    expect(parseInput('2023-11-14T22:13:20Z', { timeZone: 'Asia/Tokyo' }).ms).toBe(1_700_000_000_000);
    expect(() => parseInput('2023-02-30', { timeZone: 'UTC' })).toThrow(/not a real calendar date/);
  });
  it('passes the batch zone to the parser', () => {
    const [row] = convertBatch('2023-11-15 03:43:20', 'Asia/Kolkata');
    expect(row?.ms).toBe(1_700_000_000_000);
  });
});
