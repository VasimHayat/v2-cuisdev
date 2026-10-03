/**
 * Date calculator shared by the Age Calculator and Date Difference Calculator pages.
 * Three modes (age, difference between dates, add or subtract); `kind` picks the
 * default. State round-trips through the URL query string so a result can be shared,
 * with localStorage as a fallback. All arithmetic is in logic.ts on calendar dates.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { Chip, Segmented } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import {
  DateCalcError,
  WEEKDAYS,
  addBusinessDays,
  addDuration,
  age,
  dayNumber,
  difference,
  fmt,
  formatLong,
  formatYmd,
  parseHolidays,
  parseIsoDate,
  parseTime,
  toIso,
  today,
  weekday,
  type CalDate,
  type Feb29Rule,
} from './logic';

type Kind = 'age' | 'difference';
type Mode = 'age' | 'diff' | 'add';

interface Props {
  kind?: Kind;
}

interface State {
  mode: Mode;
  dob: string;
  on: string;
  feb29: Feb29Rule;
  start: string;
  end: string;
  useTime: boolean;
  startTime: string;
  endTime: string;
  inclusive: boolean;
  holidays: string;
  base: string;
  op: 'add' | 'sub';
  years: string;
  months: string;
  weeks: string;
  days: string;
  businessDays: string;
}

const STORE = (kind: Kind) => `cuis-dates:prefs:${kind}`;

function defaults(kind: Kind): State {
  const t = today();
  return {
    mode: kind === 'age' ? 'age' : 'diff',
    dob: toIso({ y: t.y - 30, m: 6, d: 15 }),
    on: toIso(t),
    feb29: 'feb28',
    start: toIso(t),
    end: toIso({ y: t.y, m: 12, d: 31 }),
    useTime: false,
    startTime: '09:00',
    endTime: '17:30',
    inclusive: false,
    holidays: '',
    base: toIso(t),
    op: 'add',
    years: '0',
    months: '0',
    weeks: '0',
    days: '30',
    businessDays: '0',
  };
}

/** URL parameter names per field; holidays stay local because they can be long. */
const PARAMS: Partial<Record<keyof State, string>> = {
  dob: 'dob', on: 'on', feb29: 'feb29',
  start: 'start', end: 'end', startTime: 'st', endTime: 'et', inclusive: 'incl', useTime: 'time',
  base: 'base', op: 'op', years: 'y', months: 'mo', weeks: 'w', days: 'd', businessDays: 'bd',
};
const MODE_FIELDS: Record<Mode, (keyof State)[]> = {
  age: ['dob', 'on', 'feb29'],
  diff: ['start', 'end', 'useTime', 'startTime', 'endTime', 'inclusive'],
  add: ['base', 'op', 'years', 'months', 'weeks', 'days', 'businessDays'],
};

function initialState(kind: Kind): State {
  const s = defaults(kind);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE(kind)) ?? 'null') as Partial<State> | null;
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(s) as (keyof State)[]) {
        if (typeof saved[k] === typeof s[k]) (s as unknown as Record<string, unknown>)[k] = saved[k];
      }
    }
  } catch {}
  try {
    const q = new URLSearchParams(location.search);
    const mode = q.get('mode');
    if (mode === 'age' || mode === 'diff' || mode === 'add') s.mode = mode;
    for (const [field, name] of Object.entries(PARAMS) as [keyof State, string][]) {
      const v = q.get(name);
      if (v === null) continue;
      if (typeof s[field] === 'boolean') (s as unknown as Record<string, unknown>)[field] = v === '1';
      else (s as unknown as Record<string, unknown>)[field] = v;
    }
    if (s.feb29 !== 'feb28' && s.feb29 !== 'mar1') s.feb29 = 'feb28';
    if (s.op !== 'add' && s.op !== 'sub') s.op = 'add';
  } catch {}
  return s;
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export default function DateCalculator({ kind = 'difference' }: Props) {
  /** Query string for Copy link, rebuilt from state; never written to the address bar. */
  const shareQuery = useRef('');
  const tool = kind === 'age' ? 'age-calculator' : 'date-difference-calculator';
  const [s, setS] = useState<State>(() => initialState(kind));
  const [showHolidays, setShowHolidays] = useState(() => s.holidays.trim() !== '');
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));

  // Persist and mirror the active mode's fields into the URL.
  useEffect(() => {
    try {
      localStorage.setItem(STORE(kind), JSON.stringify(s));
    } catch {}
    const t = setTimeout(() => {
      try {
        const q = new URLSearchParams();
        const defMode: Mode = kind === 'age' ? 'age' : 'diff';
        if (s.mode !== defMode) q.set('mode', s.mode);
        for (const f of MODE_FIELDS[s.mode]) {
          const v = s[f];
          const name = PARAMS[f];
          if (!name) continue;
          if (typeof v === 'boolean') {
            if (v) q.set(name, '1');
          } else if (v !== '') q.set(name, String(v));
        }
        // Not written to the address bar (GA4 history page views would record a date of
        // birth); Copy link uses it on demand.
        shareQuery.current = q.toString();
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [s, kind]);

  const holidays = useMemo(() => parseHolidays(s.holidays), [s.holidays]);

  // ------------------------------------------------------------------ results

  const ageResult = useMemo(() => {
    if (s.mode !== 'age') return null;
    const b = parseIsoDate(s.dob);
    const o = parseIsoDate(s.on);
    if (!b || !o) return { error: 'Enter a date of birth and a date to calculate the age on.' };
    try {
      return { birth: b, on: o, r: age(b, o, s.feb29) };
    } catch (e) {
      return { error: e instanceof DateCalcError ? e.message : String(e) };
    }
  }, [s.mode, s.dob, s.on, s.feb29]);

  const diffResult = useMemo(() => {
    if (s.mode !== 'diff') return null;
    const a = parseIsoDate(s.start);
    const b = parseIsoDate(s.end);
    if (!a || !b) return { error: 'Enter a start date and an end date.' };
    const st = s.useTime ? parseTime(s.startTime) : null;
    const et = s.useTime ? parseTime(s.endTime) : null;
    if (s.useTime && (st === null || et === null)) return { error: 'Enter both times as HH:MM.' };
    return { a, b, r: difference({ start: a, end: b, startTime: st, endTime: et, inclusive: s.inclusive, holidays: holidays.days }) };
  }, [s.mode, s.start, s.end, s.useTime, s.startTime, s.endTime, s.inclusive, holidays]);

  const addResult = useMemo(() => {
    if (s.mode !== 'add') return null;
    const base = parseIsoDate(s.base);
    if (!base) return { error: 'Enter a start date.' };
    const sign = s.op === 'sub' ? -1 : 1;
    const mid = addDuration(base, { years: sign * num(s.years), months: sign * num(s.months), weeks: sign * num(s.weeks), days: sign * num(s.days) });
    const bd = num(s.businessDays);
    const result = bd ? addBusinessDays(mid, sign * bd, holidays.days) : mid;
    return { base, result, delta: dayNumber(result) - dayNumber(base) };
  }, [s.mode, s.base, s.op, s.years, s.months, s.weeks, s.days, s.businessDays, holidays]);

  // ------------------------------------------------------------------ actions

  const copyLink = async () => {
    const ok = await copyText(`${location.origin}${location.pathname}${shareQuery.current ? `?${shareQuery.current}` : ''}`);
    toast(ok ? 'Link copied. It opens with these dates.' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool, action: 'copy_link', mode: s.mode });
  };
  const reset = () => {
    const d = defaults(kind);
    setS({ ...d, mode: s.mode, holidays: s.holidays });
    track('tool_action', { tool, action: 'reset' });
  };
  const copyValue = async (text: string) => {
    const ok = await copyText(text);
    toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error');
  };

  const t = today();
  const nextJan1 = toIso({ y: t.y + 1, m: 1, d: 1 });

  return (
    <div class="relative flex min-h-[600px] flex-col rounded-xl border border-line-strong bg-surface-2 p-2 text-ink shadow-sm">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={s.mode}
          onChange={(m) => {
            set('mode', m);
            track('tool_action', { tool, action: 'mode', mode: m });
          }}
          options={[
            { value: 'age', label: 'Age' },
            { value: 'diff', label: 'Between dates' },
            { value: 'add', label: 'Add or subtract' },
          ]}
          label="Calculation"
        />
        <span class="flex-1" />
        <button type="button" class="btn-secondary btn-sm" onClick={() => void copyLink()} title="Copy a link that opens with these dates">
          <Icon name="link" size={14} /> Copy link
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Back to the default dates">
          <Icon name="eraser" size={14} /> Reset
        </button>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        {/* Inputs */}
        <section class="min-w-0 rounded-lg border border-line-strong bg-surface p-3 text-sm" aria-label="Inputs">
          {s.mode === 'age' && (
            <div class="space-y-3">
              <DateField label="Date of birth" value={s.dob} onChange={(v) => set('dob', v)} />
              <DateField label="Age on" value={s.on} onChange={(v) => set('on', v)} />
              <div class="flex flex-wrap gap-1.5">
                <Chip on={s.on === toIso(t)} onClick={() => set('on', toIso(t))}>
                  Today
                </Chip>
                <Chip on={s.on === nextJan1} onClick={() => set('on', nextJan1)}>
                  1 Jan {t.y + 1}
                </Chip>
              </div>
              <Field label="Birthday on 29 February in common years">
                <Segmented
                  value={s.feb29}
                  onChange={(v) => set('feb29', v)}
                  options={[
                    { value: 'feb28', label: '28 February' },
                    { value: 'mar1', label: '1 March' },
                  ]}
                  label="29 February rule"
                />
              </Field>
            </div>
          )}

          {s.mode === 'diff' && (
            <div class="space-y-3">
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <DateField label="Start date" value={s.start} onChange={(v) => set('start', v)} />
                {s.useTime && <TimeField label="Time" value={s.startTime} onChange={(v) => set('startTime', v)} />}
              </div>
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                <DateField label="End date" value={s.end} onChange={(v) => set('end', v)} />
                {s.useTime && <TimeField label="Time" value={s.endTime} onChange={(v) => set('endTime', v)} />}
              </div>
              <div class="flex flex-wrap gap-1.5">
                <Chip on={s.inclusive} onClick={() => set('inclusive', !s.inclusive)} title="Count the end date as a full day, as for a booking or a leave request">
                  Include end date
                </Chip>
                <Chip on={s.useTime} onClick={() => set('useTime', !s.useTime)} title="Add times of day to both dates">
                  Use times
                </Chip>
                <button type="button" class="btn-ghost btn-sm" onClick={() => set('end', toIso(t))}>
                  End today
                </button>
                <button
                  type="button"
                  class="btn-ghost btn-sm"
                  onClick={() => setS((p) => ({ ...p, start: p.end, end: p.start, startTime: p.endTime, endTime: p.startTime }))}
                  title="Swap start and end"
                >
                  <Icon name="arrow-left-right" size={14} /> Swap
                </button>
              </div>
              <HolidayEditor open={showHolidays} setOpen={setShowHolidays} value={s.holidays} onChange={(v) => set('holidays', v)} invalid={holidays.invalid} count={holidays.days.size} />
            </div>
          )}

          {s.mode === 'add' && (
            <div class="space-y-3">
              <DateField label="Start date" value={s.base} onChange={(v) => set('base', v)} />
              <Segmented
                value={s.op}
                onChange={(v) => set('op', v)}
                options={[
                  { value: 'add', label: 'Add' },
                  { value: 'sub', label: 'Subtract' },
                ]}
                label="Add or subtract"
              />
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <NumField label="Years" value={s.years} onChange={(v) => set('years', v)} />
                <NumField label="Months" value={s.months} onChange={(v) => set('months', v)} />
                <NumField label="Weeks" value={s.weeks} onChange={(v) => set('weeks', v)} />
                <NumField label="Days" value={s.days} onChange={(v) => set('days', v)} />
              </div>
              <NumField label="Then business days (Mon to Fri, skipping holidays)" value={s.businessDays} onChange={(v) => set('businessDays', v)} />
              <HolidayEditor open={showHolidays} setOpen={setShowHolidays} value={s.holidays} onChange={(v) => set('holidays', v)} invalid={holidays.invalid} count={holidays.days.size} />
            </div>
          )}
        </section>

        {/* Results */}
        <section class="min-w-0 rounded-lg border border-line-strong bg-surface p-3" aria-label="Result" aria-live="polite">
          {s.mode === 'age' && ageResult && ('error' in ageResult ? <ErrorNote text={ageResult.error!} /> : <AgeView res={ageResult} onCopy={copyValue} />)}
          {s.mode === 'diff' && diffResult && ('error' in diffResult ? <ErrorNote text={diffResult.error!} /> : <DiffView res={diffResult} useTime={s.useTime} inclusive={s.inclusive} holidayCount={holidays.days.size} onCopy={copyValue} />)}
          {s.mode === 'add' && addResult && ('error' in addResult ? <ErrorNote text={addResult.error!} /> : <AddView res={addResult} onCopy={copyValue} />)}
        </section>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Calculated on calendar dates in your browser, so time zones and daylight saving never shift the result.</span>
        <span class="hidden shrink-0 sm:inline">The link keeps your dates</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ result views

type AgeOk = { birth: CalDate; on: CalDate; r: ReturnType<typeof age> };
type DiffOk = { a: CalDate; b: CalDate; r: ReturnType<typeof difference> };
type AddOk = { base: CalDate; result: CalDate; delta: number };

function AgeView({ res, onCopy }: { res: AgeOk; onCopy: (t: string) => void }) {
  const { r, on, birth } = res;
  const headline = formatYmd(r.ymd);
  return (
    <div class="space-y-4">
      <div>
        <div class="text-xs text-ink-3">Age on {formatLong(on)}</div>
        <button type="button" class="mt-1 text-left font-display text-2xl font-bold leading-tight text-ink hover:text-brand-700 sm:text-3xl dark:hover:text-brand-300" onClick={() => onCopy(headline)} title="Copy">
          {headline}
        </button>
        {r.isBirthday && <span class="badge ml-0 mt-2 border-success/40 bg-success/10 text-success">Happy birthday! {r.ymd.years > 0 ? `${r.ymd.years} today` : 'Born today'}</span>}
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Months" value={fmt(r.totalMonths)} />
        <Tile label="Weeks" value={fmt(r.totalWeeks)} sub={r.weekRemainderDays ? `and ${r.weekRemainderDays} day${r.weekRemainderDays === 1 ? '' : 's'}` : undefined} />
        <Tile label="Days" value={fmt(r.totalDays)} />
        <Tile label="Hours" value={fmt(r.totalHours)} />
        <Tile label="Minutes" value={fmt(r.totalMinutes)} />
        <Tile label="Born on a" value={WEEKDAYS[r.bornWeekday]!} />
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <div class="rounded-md border border-line bg-surface-2 p-2.5 text-sm">
          <div class="text-xs text-ink-3">Next birthday</div>
          <div class="font-medium text-ink">{formatLong(r.nextBirthday)}</div>
          <div class="text-xs text-ink-2">{r.daysToNextBirthday === 0 ? `Today, turning ${r.nextAge}` : `In ${fmt(r.daysToNextBirthday)} day${r.daysToNextBirthday === 1 ? '' : 's'}, turning ${r.nextAge}`}</div>
        </div>
        <div class="rounded-md border border-line bg-surface-2 p-2.5 text-sm">
          <div class="text-xs text-ink-3">Signs</div>
          <div class="font-medium text-ink">{r.zodiac}</div>
          <div class="text-xs text-ink-2" title="By Gregorian year. Chinese New Year falls in January or February, so early-year birthdays may belong to the previous animal.">
            Year of the {r.chineseZodiac} ({birth.y})
          </div>
        </div>
      </div>
      <div>
        <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Milestones</div>
        <ul class="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-2">
          {r.milestones.map((m) => {
            const delta = dayNumber(m.date) - dayNumber(on);
            return (
              <li key={m.label} class="flex min-w-0 items-baseline justify-between gap-2 border-b border-line py-1">
                <span class={m.passed ? 'text-ink-2' : 'text-ink'}>
                  {m.passed && <Icon name="check" size={12} class="mr-1 inline text-success" />}
                  {m.label}
                </span>
                <span class="shrink-0 text-xs text-ink-3" title={formatLong(m.date)}>
                  {toIso(m.date)} {m.passed ? '' : `· in ${fmt(delta)} d`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function DiffView({ res, useTime, inclusive, holidayCount, onCopy }: { res: DiffOk; useTime: boolean; inclusive: boolean; holidayCount: number; onCopy: (t: string) => void }) {
  const { r, a, b } = res;
  const time = useTime && (r.hms.h || r.hms.m || r.hms.s) ? `, ${r.hms.h} h ${r.hms.m} min` : '';
  const headline = `${formatYmd(r.ymd)}${time}`;
  return (
    <div class="space-y-4">
      <div>
        <div class="text-xs text-ink-3">
          From {formatLong(r.negative ? b : a)} to {formatLong(r.negative ? a : b)}
          {inclusive ? ', end date included' : ''}
        </div>
        <button type="button" class="mt-1 text-left font-display text-2xl font-bold leading-tight text-ink hover:text-brand-700 sm:text-3xl dark:hover:text-brand-300" onClick={() => onCopy(headline)} title="Copy">
          {headline}
        </button>
        {r.negative && <div class="mt-1 text-xs text-warning">The end date is before the start date; the span is shown going forward.</div>}
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="Days" value={fmt(r.totalDays)} />
        <Tile label="Weeks" value={fmt(r.weeks)} sub={r.weekRemainderDays ? `and ${r.weekRemainderDays} day${r.weekRemainderDays === 1 ? '' : 's'}` : undefined} />
        <Tile label="Months" value={fmt(r.totalMonths)} sub={r.ymd.days ? `and ${r.ymd.days} day${r.ymd.days === 1 ? '' : 's'}` : undefined} />
        <Tile label="Hours" value={fmt(r.totalHours)} />
        <Tile label="Minutes" value={fmt(r.totalMinutes)} />
        <Tile label="Seconds" value={fmt(r.totalSeconds)} />
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <Tile label={`Business days${holidayCount ? `, minus ${holidayCount} holiday${holidayCount === 1 ? '' : 's'}` : ''}`} value={fmt(r.businessDays)} sub="Monday to Friday" />
        <Tile label="Weekend days" value={fmt(r.weekendDays)} sub="Saturdays and Sundays" />
      </div>
    </div>
  );
}

function AddView({ res, onCopy }: { res: AddOk; onCopy: (t: string) => void }) {
  const { result, base, delta } = res;
  return (
    <div class="space-y-4">
      <div>
        <div class="text-xs text-ink-3">Result</div>
        <button type="button" class="mt-1 text-left font-display text-2xl font-bold leading-tight text-ink hover:text-brand-700 sm:text-3xl dark:hover:text-brand-300" onClick={() => onCopy(formatLong(result))} title="Copy">
          {formatLong(result)}
        </button>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Tile label="ISO date" value={toIso(result)} onCopy={() => onCopy(toIso(result))} />
        <Tile label="Weekday" value={WEEKDAYS[weekday(result)]!} />
        <Tile label={delta >= 0 ? 'Days after start' : 'Days before start'} value={fmt(Math.abs(delta))} sub={`from ${toIso(base)}`} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ small pieces

function Tile(p: { label: string; value: string; sub?: string; onCopy?: () => void }) {
  return (
    <div class="min-w-0 rounded-md border border-line bg-surface-2 p-2.5">
      <div class="truncate text-xs text-ink-3" title={p.label}>
        {p.label}
      </div>
      <div class="flex items-center gap-1">
        <div class="truncate font-mono text-lg font-semibold tabular-nums text-ink">{p.value}</div>
        {p.onCopy && (
          <button type="button" class="text-ink-3 hover:text-ink" onClick={p.onCopy} aria-label={`Copy ${p.label}`} title="Copy">
            <Icon name="copy" size={13} />
          </button>
        )}
      </div>
      {p.sub && <div class="truncate text-xs text-ink-3">{p.sub}</div>}
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p class="flex items-center gap-2 text-sm text-danger">
      <Icon name="alert-circle" size={15} /> {text}
    </p>
  );
}

function Field(p: { label: string; children: ComponentChildren }) {
  return (
    <div>
      <div class="mb-1 text-xs text-ink-2">{p.label}</div>
      {p.children}
    </div>
  );
}

function DateField(p: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label class="block min-w-0">
      <span class="mb-1 block text-xs text-ink-2">{p.label}</span>
      <input type="date" class="input h-9" value={p.value} min="0001-01-01" max="9999-12-31" onInput={(e) => p.onChange((e.currentTarget as HTMLInputElement).value)} aria-label={p.label} />
    </label>
  );
}

function TimeField(p: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label class="block">
      <span class="mb-1 block text-xs text-ink-2">{p.label}</span>
      <input type="time" class="input h-9 w-[7.5rem]" value={p.value} onInput={(e) => p.onChange((e.currentTarget as HTMLInputElement).value)} aria-label={p.label} />
    </label>
  );
}

function NumField(p: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label class="block min-w-0">
      <span class="mb-1 block truncate text-xs text-ink-2" title={p.label}>
        {p.label}
      </span>
      <input type="number" inputMode="numeric" min={0} step={1} class="input h-9 font-mono" value={p.value} onInput={(e) => p.onChange((e.currentTarget as HTMLInputElement).value)} aria-label={p.label} />
    </label>
  );
}

function HolidayEditor(p: { open: boolean; setOpen: (v: boolean) => void; value: string; onChange: (v: string) => void; invalid: string[]; count: number }) {
  return (
    <div class="rounded-md border border-line">
      <button type="button" class="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-xs font-medium text-ink-2 hover:text-ink" onClick={() => p.setOpen(!p.open)} aria-expanded={p.open}>
        <Icon name={p.open ? 'chevron-down' : 'chevron-right'} size={13} />
        Holidays to skip {p.count ? `(${p.count})` : '(optional)'}
      </button>
      {p.open && (
        <div class="border-t border-line p-2.5">
          <textarea
            class="h-24 w-full resize-y rounded-md border border-line-strong bg-surface px-2 py-1.5 font-mono text-xs text-ink placeholder:text-ink-3 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500"
            value={p.value}
            onInput={(e) => p.onChange((e.currentTarget as HTMLTextAreaElement).value)}
            placeholder={'One date per line, for example\n2026-12-25 Christmas Day\n2026-12-26'}
            aria-label="Holiday dates, one per line"
          />
          {p.invalid.length > 0 && <p class="mt-1 text-xs text-warning">Not read as dates: {p.invalid.slice(0, 3).join(', ')}{p.invalid.length > 3 ? ` and ${p.invalid.length - 3} more` : ''}</p>}
          <p class="mt-1 text-xs text-ink-3">Kept on this device only. Used for business day counts.</p>
        </div>
      )}
    </div>
  );
}
