import { describe as group, expect, it } from 'vitest';
import {
  CronError,
  FIELD_SPECS,
  PRESETS,
  SAMPLE,
  describe,
  explainField,
  formatRelative,
  humanDuration,
  intervalSummary,
  nextRuns,
  normalizeExpression,
  ordinal,
  splitFields,
  usesLegacyOr,
  validate,
  zoneOffsetLabel,
} from './logic';

const FROM = new Date(Date.UTC(2026, 9, 3, 12, 7, 30)); // Sat 3 Oct 2026 12:07:30 UTC

group('normalizeExpression', () => {
  it('trims, collapses whitespace and counts fields', () => {
    expect(normalizeExpression('  */15   *  * * *  ')).toMatchObject({ expression: '*/15 * * * *', fieldCount: 5 });
    expect(normalizeExpression('0 */15 * * * *').fieldCount).toBe(6);
    expect(normalizeExpression('0 0 12 * * ? 2030').fieldCount).toBe(7);
  });
  it('expands macros', () => {
    expect(normalizeExpression('@daily')).toMatchObject({ expression: '0 0 * * *', macro: '@daily', fieldCount: 5 });
    expect(normalizeExpression('@ANNUALLY').expression).toBe('0 0 1 1 *');
    expect(() => normalizeExpression('@sometimes')).toThrow(/Unknown shorthand/);
  });
  it('rejects empty input and wrong field counts', () => {
    expect(() => normalizeExpression('   ')).toThrow(CronError);
    expect(() => normalizeExpression('* * * *')).toThrow(/This one has 4/);
    expect(() => normalizeExpression('* * * * * * * *')).toThrow(/This one has 8/);
  });
});

group('splitFields and explanations', () => {
  it('names the fields in order for 5, 6 and 7 field expressions', () => {
    expect(splitFields('* * * * *').fields.map((f) => f.id)).toEqual(['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek']);
    expect(splitFields('0 * * * * *').fields[0]!.id).toBe('second');
    expect(splitFields('0 0 0 1 1 * 2030').fields.at(-1)!.id).toBe('year');
  });
  it('explains steps, ranges, lists and names', () => {
    const { fields } = splitFields('*/15 9-17 * JAN,JUL 1-5');
    expect(fields[0]!.meaning).toBe('every 15 minutes');
    expect(fields[1]!.meaning).toBe('09:00 to 17:00');
    expect(fields[3]!.meaning).toBe('January and July');
    expect(fields[4]!.meaning).toBe('Monday to Friday');
    expect(explainField(FIELD_SPECS.minute, '0,30')).toBe('0 and 30');
    expect(explainField(FIELD_SPECS.minute, '5/10')).toBe('every 10 minutes starting at 5');
    expect(explainField(FIELD_SPECS.hour, '*')).toBe('every hour');
  });
  it('explains special day tokens', () => {
    expect(explainField(FIELD_SPECS.dayOfMonth, 'L')).toBe('the last day of the month');
    expect(explainField(FIELD_SPECS.dayOfMonth, '15W')).toBe('the weekday nearest the 15th');
    expect(explainField(FIELD_SPECS.dayOfWeek, 'FRI#2')).toBe('the 2nd Friday of the month');
    expect(explainField(FIELD_SPECS.dayOfWeek, '5L')).toBe('the last Friday of the month');
    expect(explainField(FIELD_SPECS.dayOfWeek, '7')).toBe('Sunday');
  });
  it('reports the offending field', () => {
    const err = (expr: string) => validate(expr);
    expect(err('61 * * * *')).toMatchObject({ field: 'minute', message: expect.stringContaining('out of range') });
    expect(err('0 25 * * *')).toMatchObject({ field: 'hour' });
    expect(err('0 0 * 13 *')).toMatchObject({ field: 'month' });
    expect(err('0 17-9 * * *')).toMatchObject({ field: 'hour', message: expect.stringContaining('backwards') });
    expect(err('0 0 * * funday')).toMatchObject({ field: 'dayOfWeek' });
    expect(err('*/0 * * * *')).toMatchObject({ field: 'minute', message: expect.stringContaining('at least 1') });
    expect(err('every day at nine')).toBeInstanceOf(CronError);
    expect(validate(SAMPLE)).toBeNull();
  });
  it('detects legacy OR between day fields', () => {
    expect(usesLegacyOr(normalizeExpression('0 0 1 * 1'))).toBe(true);
    expect(usesLegacyOr(normalizeExpression('0 0 1 * *'))).toBe(false);
    expect(usesLegacyOr(normalizeExpression('0 0 ? * MON'))).toBe(false);
  });
});

group('describe (cronstrue)', () => {
  it('produces a readable 24-hour sentence', async () => {
    const s = await describe('0 9 * * 1-5');
    expect(s).toContain('09:00');
    expect(s).toContain('Monday through Friday');
    expect(await describe('*/15 * * * *')).toBe('Every 15 minutes');
  });
  it('throws a CronError for invalid input', async () => {
    await expect(describe('99 * * * *')).rejects.toBeInstanceOf(CronError);
  });
});

group('nextRuns (croner)', () => {
  it('spaces */15 runs 15 minutes apart', async () => {
    const { dates } = await nextRuns('*/15 * * * *', 5, 'UTC', FROM);
    expect(dates.map((d) => d.toISOString())).toEqual([
      '2026-10-03T12:15:00.000Z',
      '2026-10-03T12:30:00.000Z',
      '2026-10-03T12:45:00.000Z',
      '2026-10-03T13:00:00.000Z',
      '2026-10-03T13:15:00.000Z',
    ]);
    expect(intervalSummary(dates)).toBe('every 15 minutes');
  });
  it('honours the time zone', async () => {
    const utc = await nextRuns('0 9 * * *', 1, 'UTC', FROM);
    const ist = await nextRuns('0 9 * * *', 1, 'Asia/Kolkata', FROM);
    expect(utc.dates[0]!.toISOString()).toBe('2026-10-04T09:00:00.000Z');
    expect(ist.dates[0]!.toISOString()).toBe('2026-10-04T03:30:00.000Z');
    expect(zoneOffsetLabel(FROM, 'Asia/Kolkata')).toBe('UTC+05:30');
  });
  it('supports seconds and ORs the day fields', async () => {
    const secs = await nextRuns('*/10 * * * * *', 3, 'UTC', FROM);
    expect(intervalSummary(secs.dates)).toBe('every 10 seconds');
    // 1st of the month OR any Monday: from Sat 3 Oct the next are Mon 5, Mon 12, ...
    const or = await nextRuns('0 0 1 * 1', 3, 'UTC', FROM);
    expect(or.legacyOr).toBe(true);
    expect(or.dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-05', '2026-10-12', '2026-10-19']);
  });
  it('finds the last day of the month', async () => {
    const { dates } = await nextRuns('0 0 L * *', 2, 'UTC', FROM);
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-10-31', '2026-11-30']);
  });
});

group('presentation helpers', () => {
  it('summarises intervals and durations', () => {
    const d = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
    expect(intervalSummary([d(1), d(2), d(3)])).toBe('every hour');
    expect(intervalSummary([d(1), d(2), d(5)])).toBe('irregular interval');
    expect(intervalSummary([d(1)])).toBe('');
    expect(humanDuration(86_400_000)).toBe('day');
    expect(humanDuration(6 * 3_600_000)).toBe('6 hours');
  });
  it('formats relative times and ordinals', () => {
    expect(formatRelative(FROM.getTime() + 3 * 3_600_000, FROM.getTime())).toBe('in 3 hours');
    expect(formatRelative(FROM.getTime() - 120_000, FROM.getTime())).toBe('2 minutes ago');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
  it('has valid presets', async () => {
    for (const p of PRESETS) expect(validate(p.expression), p.label).toBeNull();
    await expect(nextRuns(PRESETS.at(-1)!.expression, 2, 'UTC', FROM)).resolves.toBeTruthy();
  });
});
