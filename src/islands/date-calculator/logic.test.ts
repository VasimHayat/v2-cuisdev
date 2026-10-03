import { describe, expect, it } from 'vitest';
import {
  DateCalcError,
  addBusinessDays,
  addDuration,
  age,
  birthdayIn,
  businessDaysBetween,
  chineseZodiac,
  dayNumber,
  daysInMonth,
  diffYmd,
  difference,
  fromDayNumber,
  isLeap,
  parseHolidays,
  parseIsoDate,
  parseTime,
  toIso,
  weekday,
  zodiacSign,
} from './logic';

const D = (s: string) => parseIsoDate(s)!;

describe('calendar basics', () => {
  it('knows leap years and month lengths', () => {
    expect([isLeap(2000), isLeap(1900), isLeap(2024), isLeap(2026)]).toEqual([true, false, true, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
  it('parses and formats ISO dates and times strictly', () => {
    expect(toIso(D('2026-10-03'))).toBe('2026-10-03');
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseTime('09:30')).toBe(34200);
    expect(parseTime('24:00')).toBeNull();
    expect(fromDayNumber(dayNumber(D('1969-12-31')))).toEqual(D('1969-12-31'));
    expect(weekday(D('2026-10-05'))).toBe(1);
  });
});

describe('differences', () => {
  it('borrows from the previous month at month ends', () => {
    expect(diffYmd(D('2026-01-31'), D('2026-02-28'))).toEqual({ years: 0, months: 0, days: 28 });
    expect(diffYmd(D('2020-02-29'), D('2021-02-28'))).toEqual({ years: 0, months: 11, days: 30 });
    expect(diffYmd(D('2025-12-15'), D('2026-01-14'))).toEqual({ years: 0, months: 0, days: 30 });
  });
  it('includes the end date when asked', () => {
    const excl = difference({ start: D('2026-01-01'), end: D('2026-01-31') });
    const incl = difference({ start: D('2026-01-01'), end: D('2026-01-31'), inclusive: true });
    expect([excl.totalDays, excl.ymd]).toEqual([30, { years: 0, months: 0, days: 30 }]);
    expect([incl.totalDays, incl.ymd]).toEqual([31, { years: 0, months: 1, days: 0 }]);
  });
  it('handles reversed dates and times across midnight', () => {
    const r = difference({ start: D('2026-03-10'), end: D('2026-03-01') });
    expect([r.negative, r.totalDays]).toEqual([true, 9]);
    const t = difference({ start: D('2026-01-01'), end: D('2026-01-02'), startTime: 22 * 3600, endTime: 6 * 3600 });
    expect([t.totalHours, t.ymd.days, t.hms]).toEqual([8, 0, { h: 8, m: 0, s: 0 }]);
  });
  it('counts business days and weekends with holidays', () => {
    const mon = D('2026-10-05');
    const nextMon = D('2026-10-12');
    expect(businessDaysBetween(mon, nextMon, false)).toBe(5);
    const { days, invalid } = parseHolidays('2026-10-07 Founders day\n# comment\nnot a date\n\n2026-12-25');
    expect(invalid).toEqual(['not a date']);
    expect(days.size).toBe(2);
    expect(businessDaysBetween(mon, nextMon, false, days)).toBe(4);
    const r = difference({ start: mon, end: nextMon, holidays: days });
    expect([r.businessDays, r.weekendDays]).toEqual([4, 2]);
  });
});

describe('adding and subtracting', () => {
  it('clamps month ends and supports subtraction', () => {
    expect(addDuration(D('2026-01-31'), { months: 1 })).toEqual(D('2026-02-28'));
    expect(addDuration(D('2024-02-29'), { years: 1 })).toEqual(D('2025-02-28'));
    expect(addDuration(D('2026-03-31'), { months: -1 })).toEqual(D('2026-02-28'));
    expect(addDuration(D('2026-01-01'), { weeks: 2, days: 3 })).toEqual(D('2026-01-18'));
    expect(addDuration(D('2026-01-15'), { years: -1, months: -2 })).toEqual(D('2024-11-15'));
  });
  it('steps over weekends and holidays in business days', () => {
    expect(addBusinessDays(D('2026-10-09'), 1)).toEqual(D('2026-10-12'));
    expect(addBusinessDays(D('2026-10-12'), -1)).toEqual(D('2026-10-09'));
    expect(addBusinessDays(D('2026-10-09'), 1, new Set([dayNumber(D('2026-10-12'))]))).toEqual(D('2026-10-13'));
    expect(addBusinessDays(D('2026-10-09'), 0)).toEqual(D('2026-10-09'));
  });
});

describe('age', () => {
  it('computes exact age and the next birthday', () => {
    const a = age(D('1990-05-15'), D('2026-10-03'));
    expect(a.ymd).toEqual({ years: 36, months: 4, days: 18 });
    expect(a.nextBirthday).toEqual(D('2027-05-15'));
    expect(a.nextAge).toBe(37);
    expect(a.daysToNextBirthday).toBe(dayNumber(D('2027-05-15')) - dayNumber(D('2026-10-03')));
    expect(a.totalDays).toBe(dayNumber(D('2026-10-03')) - dayNumber(D('1990-05-15')));
  });
  it('applies the 29 February rule in common years', () => {
    expect(birthdayIn(D('2000-02-29'), 2001, 'feb28')).toEqual(D('2001-02-28'));
    expect(birthdayIn(D('2000-02-29'), 2001, 'mar1')).toEqual(D('2001-03-01'));
    const feb28 = age(D('2000-02-29'), D('2001-02-28'), 'feb28');
    expect([feb28.ymd.years, feb28.isBirthday]).toEqual([1, true]);
    const mar1 = age(D('2000-02-29'), D('2001-02-28'), 'mar1');
    expect([mar1.ymd, mar1.daysToNextBirthday]).toEqual([{ years: 0, months: 11, days: 30 }, 1]);
    expect(age(D('2000-02-29'), D('2004-02-29')).ymd).toEqual({ years: 4, months: 0, days: 0 });
  });
  it('rejects a birth date after the target and lists milestones in order', () => {
    expect(() => age(D('2027-01-01'), D('2026-01-01'))).toThrow(DateCalcError);
    const a = age(D('2000-01-01'), D('2026-10-03'));
    const tenK = a.milestones.find((m) => m.label === '10,000 days')!;
    expect(tenK).toMatchObject({ date: D('2027-05-19'), passed: false });
    expect(a.milestones.find((m) => m.label === '5,000 days')!.passed).toBe(true);
    const billion = a.milestones.find((m) => m.label === '1 billion seconds')!;
    expect(billion.date).toEqual(fromDayNumber(dayNumber(D('2000-01-01')) + 11574));
    const days = a.milestones.map((m) => dayNumber(m.date));
    expect([...days].sort((x, y) => x - y)).toEqual(days);
  });
  it('names the zodiac signs', () => {
    expect([zodiacSign(D('1990-01-19')), zodiacSign(D('1990-01-20')), zodiacSign(D('1990-12-22')), zodiacSign(D('1990-03-20'))]).toEqual(['Capricorn', 'Aquarius', 'Capricorn', 'Pisces']);
    expect([chineseZodiac(2024), chineseZodiac(2000), chineseZodiac(1990)]).toEqual(['Dragon', 'Dragon', 'Horse']);
  });
});

describe('totals', () => {
  it('reports weeks, months, hours and seconds for a span', () => {
    const r = difference({ start: D('2025-01-01'), end: D('2026-03-15') });
    expect(r.ymd).toEqual({ years: 1, months: 2, days: 14 });
    expect(r.totalMonths).toBe(14);
    expect(r.totalDays).toBe(438);
    expect([r.weeks, r.weekRemainderDays]).toEqual([62, 4]);
    expect(r.totalHours).toBe(438 * 24);
    expect(r.totalSeconds).toBe(438 * 86400);
  });
  it('counts the end day in business days when inclusive', () => {
    const fri = D('2026-10-09');
    expect(businessDaysBetween(D('2026-10-05'), fri, true)).toBe(5);
    expect(difference({ start: D('2026-10-05'), end: fri, inclusive: true }).businessDays).toBe(5);
    expect(difference({ start: D('2026-10-05'), end: fri }).businessDays).toBe(4);
  });
});
