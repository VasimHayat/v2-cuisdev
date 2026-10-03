/**
 * Date calculator logic: pure functions on calendar dates, no DOM.
 *
 * Every calculation works on (year, month, day) values converted to UTC midnights, so a
 * user's time zone or a daylight saving change can never shift a result by a day.
 */

export interface CalDate {
  y: number;
  /** 1 to 12 */
  m: number;
  d: number;
}

export interface Ymd {
  years: number;
  months: number;
  days: number;
}

export type Feb29Rule = 'feb28' | 'mar1';

const DAY_MS = 86_400_000;

// --- basics --------------------------------------------------------------------

export function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 30;
}

/** Days since 1970-01-01 for a calendar date (UTC midnight based). */
export function dayNumber(c: CalDate): number {
  return Math.round(Date.UTC(c.y, c.m - 1, c.d) / DAY_MS);
}

export function fromDayNumber(n: number): CalDate {
  const dt = new Date(n * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(c: CalDate): number {
  return new Date(dayNumber(c) * DAY_MS).getUTCDay();
}

export function compare(a: CalDate, b: CalDate): number {
  return dayNumber(a) - dayNumber(b);
}

export function sameDate(a: CalDate, b: CalDate): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** Parse "YYYY-MM-DD"; null when malformed or not a real calendar date. */
export function parseIsoDate(text: string): CalDate | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(text);
  if (!m) return null;
  const c = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (c.m < 1 || c.m > 12 || c.d < 1 || c.d > daysInMonth(c.y, c.m)) return null;
  return c;
}

export function toIso(c: CalDate): string {
  return `${String(c.y).padStart(4, '0')}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

/** Today's calendar date in the user's own zone (only used as a default value). */
export function today(now: Date = new Date()): CalDate {
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

/** Parse "HH:MM" (or "HH:MM:SS") to seconds after midnight; null when empty or invalid. */
export function parseTime(text: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(text);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = Number(m[3] ?? '0');
  if (h > 23 || mi > 59 || s > 59) return null;
  return h * 3600 + mi * 60 + s;
}

// --- differences -----------------------------------------------------------------

/**
 * Years, months and days from `a` to `b` (a <= b), borrowing days from the month
 * before `b`, the convention used by most date calculators: 31 Jan to 28 Feb is 28 days.
 */
export function diffYmd(a: CalDate, b: CalDate): Ymd {
  let years = b.y - a.y;
  let months = b.m - a.m;
  let days = b.d - a.d;
  if (days < 0) {
    months -= 1;
    const pm = b.m === 1 ? 12 : b.m - 1;
    const py = b.m === 1 ? b.y - 1 : b.y;
    days += daysInMonth(py, pm);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/** Add years and months with end-of-month clamping, then weeks and days. */
export function addDuration(c: CalDate, dur: { years?: number; months?: number; weeks?: number; days?: number }): CalDate {
  const totalMonths = (c.y * 12 + (c.m - 1)) + (dur.years ?? 0) * 12 + (dur.months ?? 0);
  const y = Math.floor(totalMonths / 12);
  const m = (totalMonths % 12 + 12) % 12 + 1;
  const d = Math.min(c.d, daysInMonth(y, m));
  return fromDayNumber(dayNumber({ y, m, d }) + (dur.weeks ?? 0) * 7 + (dur.days ?? 0));
}

export function isBusinessDay(c: CalDate, holidays: ReadonlySet<number> = new Set()): boolean {
  const w = weekday(c);
  return w !== 0 && w !== 6 && !holidays.has(dayNumber(c));
}

/** Mon to Fri days in [a, b) or [a, b] when inclusive, skipping holidays. a <= b. */
export function businessDaysBetween(a: CalDate, b: CalDate, inclusive: boolean, holidays: ReadonlySet<number> = new Set()): number {
  const start = dayNumber(a);
  const end = dayNumber(b) + (inclusive ? 1 : 0);
  let count = 0;
  for (let n = start; n < end; n++) {
    const w = new Date(n * DAY_MS).getUTCDay();
    if (w !== 0 && w !== 6 && !holidays.has(n)) count++;
  }
  return count;
}

/** Move by `n` business days (negative goes back). Holidays and weekends are skipped. */
export function addBusinessDays(c: CalDate, n: number, holidays: ReadonlySet<number> = new Set()): CalDate {
  let day = dayNumber(c);
  const step = n < 0 ? -1 : 1;
  let left = Math.min(Math.abs(Math.trunc(n)), 1_000_000);
  while (left > 0) {
    day += step;
    const w = new Date(day * DAY_MS).getUTCDay();
    if (w !== 0 && w !== 6 && !holidays.has(day)) left--;
  }
  return fromDayNumber(day);
}

export interface HolidayParse {
  days: Set<number>;
  invalid: string[];
}

/** One date per line (YYYY-MM-DD); anything after the date on a line is treated as a label. */
export function parseHolidays(text: string): HolidayParse {
  const days = new Set<number>();
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const c = parseIsoDate(line.slice(0, 10));
    if (c) days.add(dayNumber(c));
    else invalid.push(line);
  }
  return { days, invalid };
}

export interface DifferenceInput {
  start: CalDate;
  end: CalDate;
  /** Seconds after midnight, when times are used. */
  startTime?: number | null;
  endTime?: number | null;
  /** Count the end date as a full day. */
  inclusive?: boolean;
  holidays?: ReadonlySet<number>;
}

export interface DifferenceResult {
  /** True when the end is before the start; all values are then magnitudes. */
  negative: boolean;
  ymd: Ymd;
  /** Leftover hours, minutes and seconds when times are used. */
  hms: { h: number; m: number; s: number };
  totalDays: number;
  weeks: number;
  weekRemainderDays: number;
  totalMonths: number;
  totalHours: number;
  totalMinutes: number;
  totalSeconds: number;
  businessDays: number;
  weekendDays: number;
}

export function difference(input: DifferenceInput): DifferenceResult {
  const useTime = input.startTime != null || input.endTime != null;
  let aDate = input.start;
  let bDate = input.end;
  let aT = useTime ? (input.startTime ?? 0) : 0;
  let bT = useTime ? (input.endTime ?? 0) : 0;
  let negative = false;
  if (dayNumber(bDate) * 86400 + bT < dayNumber(aDate) * 86400 + aT) {
    [aDate, bDate] = [bDate, aDate];
    [aT, bT] = [bT, aT];
    negative = true;
  }
  if (input.inclusive) bDate = fromDayNumber(dayNumber(bDate) + 1);
  // Borrow a day when the end time is earlier than the start time.
  let ymdEnd = bDate;
  let secs = bT - aT;
  if (secs < 0) {
    secs += 86400;
    ymdEnd = fromDayNumber(dayNumber(bDate) - 1);
  }
  const ymd = diffYmd(aDate, ymdEnd);
  const totalSeconds = (dayNumber(bDate) - dayNumber(aDate)) * 86400 + (bT - aT);
  const totalDays = Math.floor(totalSeconds / 86400);
  const inclusiveEnd = fromDayNumber(dayNumber(bDate) - 1);
  const businessDays = dayNumber(bDate) > dayNumber(aDate) ? businessDaysBetween(aDate, inclusiveEnd, true, input.holidays) : 0;
  let weekendDays = 0;
  for (let n = dayNumber(aDate); n < dayNumber(bDate); n++) {
    const w = new Date(n * DAY_MS).getUTCDay();
    if (w === 0 || w === 6) weekendDays++;
  }
  return {
    negative,
    ymd,
    hms: { h: Math.floor(secs / 3600), m: Math.floor((secs % 3600) / 60), s: secs % 60 },
    totalDays,
    weeks: Math.floor(totalDays / 7),
    weekRemainderDays: totalDays % 7,
    totalMonths: ymd.years * 12 + ymd.months,
    totalHours: Math.floor(totalSeconds / 3600),
    totalMinutes: Math.floor(totalSeconds / 60),
    totalSeconds,
    businessDays,
    weekendDays,
  };
}

// --- age -------------------------------------------------------------------------

/** The date a birthday falls on in `year`, applying the 29 February rule. */
export function birthdayIn(birth: CalDate, year: number, rule: Feb29Rule = 'feb28'): CalDate {
  if (birth.m === 2 && birth.d === 29 && !isLeap(year)) return rule === 'feb28' ? { y: year, m: 2, d: 28 } : { y: year, m: 3, d: 1 };
  return { y: year, m: birth.m, d: birth.d };
}

export interface Milestone {
  label: string;
  date: CalDate;
  passed: boolean;
}

export interface AgeResult {
  ymd: Ymd;
  totalDays: number;
  totalWeeks: number;
  weekRemainderDays: number;
  totalMonths: number;
  totalHours: number;
  totalMinutes: number;
  lastBirthday: CalDate;
  nextBirthday: CalDate;
  daysToNextBirthday: number;
  /** Age the person turns on the next birthday. */
  nextAge: number;
  isBirthday: boolean;
  bornWeekday: number;
  milestones: Milestone[];
  zodiac: string;
  chineseZodiac: string;
}

export class DateCalcError extends Error {
  override name = 'DateCalcError';
}

export function age(birth: CalDate, on: CalDate, rule: Feb29Rule = 'feb28'): AgeResult {
  if (compare(birth, on) > 0) throw new DateCalcError('The date of birth is after the date the age is calculated on.');
  const thisYear = birthdayIn(birth, on.y, rule);
  const hadThisYear = compare(on, thisYear) >= 0;
  const years = on.y - birth.y - (hadThisYear ? 0 : 1);
  const lastBirthday = years === 0 ? birth : birthdayIn(birth, birth.y + years, rule);
  const rest = diffYmd(lastBirthday, on);
  const isBirthday = years > 0 ? sameDate(thisYear, on) : sameDate(birth, on);
  const nextBirthday = isBirthday ? on : hadThisYear ? birthdayIn(birth, on.y + 1, rule) : thisYear;
  const totalDays = dayNumber(on) - dayNumber(birth);
  return {
    ymd: { years, months: rest.months, days: rest.days },
    totalDays,
    totalWeeks: Math.floor(totalDays / 7),
    weekRemainderDays: totalDays % 7,
    totalMonths: years * 12 + rest.months,
    totalHours: totalDays * 24,
    totalMinutes: totalDays * 1440,
    lastBirthday,
    nextBirthday,
    daysToNextBirthday: dayNumber(nextBirthday) - dayNumber(on),
    nextAge: nextBirthday.y - birth.y,
    isBirthday,
    bornWeekday: weekday(birth),
    milestones: milestones(birth, on),
    zodiac: zodiacSign(birth),
    chineseZodiac: chineseZodiac(birth.y),
  };
}

export function milestones(birth: CalDate, on: CalDate): Milestone[] {
  const start = dayNumber(birth);
  const now = dayNumber(on);
  const byDays: [string, number][] = [
    ['1 million minutes', Math.floor(1_000_000 / 1440)],
    ['1,000 days', 1000],
    ['500 weeks', 3500],
    ['5,000 days', 5000],
    ['1,000 weeks', 7000],
    ['10,000 days', 10000],
    ['1 billion seconds', Math.floor(1_000_000_000 / 86400)],
    ['20,000 days', 20000],
    ['25,000 days', 25000],
    ['30,000 days', 30000],
  ];
  const out: Milestone[] = byDays.map(([label, days]) => ({ label, date: fromDayNumber(start + days), passed: start + days <= now }));
  out.push({ label: '500 months', date: addDuration(birth, { months: 500 }), passed: compare(addDuration(birth, { months: 500 }), on) <= 0 });
  return out.sort((a, b) => compare(a.date, b.date));
}

/** Sign that begins in each month, with its first day. Before that day the previous sign applies. */
const ZODIAC: [number, string][] = [
  [20, 'Aquarius'], [19, 'Pisces'], [21, 'Aries'], [20, 'Taurus'], [21, 'Gemini'], [21, 'Cancer'],
  [23, 'Leo'], [23, 'Virgo'], [23, 'Libra'], [23, 'Scorpio'], [22, 'Sagittarius'], [22, 'Capricorn'],
];

/** Western sun sign for a birth date. */
export function zodiacSign(c: CalDate): string {
  const [startDay, sign] = ZODIAC[c.m - 1]!;
  if (c.d >= startDay) return sign;
  return ZODIAC[(c.m + 10) % 12]![1];
}

const ANIMALS = ['Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig'];

/** Animal of the Gregorian year (Chinese New Year falls in January or February). */
export function chineseZodiac(year: number): string {
  return ANIMALS[(((year - 4) % 12) + 12) % 12]!;
}

// --- formatting ------------------------------------------------------------------

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatLong(c: CalDate): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dayNumber(c) * DAY_MS));
}

export function formatYmd(v: Ymd): string {
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return `${part(v.years, 'year')}, ${part(v.months, 'month')}, ${part(v.days, 'day')}`;
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}
