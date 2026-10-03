/**
 * BMI Calculator: metric or imperial input with live mirroring between them, the WHO
 * category on a colour scale, healthy weight range in both units and BMI Prime.
 */
import { CalcHeader, NumField, Panel, ROOT_CLASS, ResultCard, Working, useUrlState } from '../calc-kit/kit';
import { Segmented } from '../shared/controls';
import { Icon } from '../shared/icons';
import { formatNumber, round } from '../calc-kit/numbers';
import { CATEGORIES, DEFAULTS, bmi, bmiPrime, categoryFor, healthyRangeKg, kgToLb, kgToStoneLb, notesFor, readMeasurements, scalePosition, syncUnits, type BmiState } from './logic';

const TOOL = 'bmi-calculator';

const BAND_COLOURS: Record<string, string> = {
  under: 'bg-warning/70',
  healthy: 'bg-success/70',
  over: 'bg-warning/70',
  obese: 'bg-danger/70',
};

export default function BmiCalculator() {
  const [s, setRaw, reset, shareUrl] = useUrlState('cuis-bmi:state', DEFAULTS);
  const read = readMeasurements(s);

  /** Edit a field and mirror the measurement into the other system so switching is seamless. */
  const set = (patch: Partial<BmiState>) => {
    const next = { ...s, ...patch };
    const r = readMeasurements(next);
    if (r.ok && !('units' in patch)) {
      const mirror = syncUnits(next, r.m);
      // Keep the fields the user is typing in untouched.
      for (const k of Object.keys(patch)) delete (mirror as Record<string, string>)[k];
      if (next.units === 'metric') {
        delete mirror.cm;
        delete mirror.kg;
      } else {
        delete mirror.ft;
        delete mirror.in;
        delete mirror.lb;
        delete mirror.st;
        delete mirror.stlb;
      }
      setRaw({ ...patch, ...mirror });
    } else setRaw(patch);
  };

  const m = read.ok ? read.m : null;
  const value = m ? bmi(m.weightKg, m.heightCm) : NaN;
  const cat = m ? categoryFor(value) : null;
  const range = m ? healthyRangeKg(m.heightCm) : null;
  const notes = notesFor(s.age, s.sex);
  const fmtW = (kg: number) => {
    if (s.units === 'imperial') {
      if (s.wunit === 'st') {
        const sl = kgToStoneLb(kg);
        return `${sl.st} st ${formatNumber(sl.lb, 1)} lb`;
      }
      return `${formatNumber(kgToLb(kg), 1)} lb`;
    }
    return `${formatNumber(kg, 1)} kg`;
  };
  const otherW = (kg: number) => (s.units === 'imperial' ? `${formatNumber(kg, 1)} kg` : `${formatNumber(kgToLb(kg), 1)} lb`);
  const diffToRange = m && range ? (m.weightKg < range[0] ? range[0] - m.weightKg : m.weightKg > range[1] ? m.weightKg - range[1] : 0) : 0;

  return (
    <div class={ROOT_CLASS}>
      <CalcHeader tool={TOOL} title="BMI calculator" subtitle="For adults aged 20 and over." onReset={reset} shareUrl={shareUrl}>
        <Segmented
          value={s.units === 'imperial' ? 'imperial' : 'metric'}
          onChange={(v) => setRaw({ units: v })}
          options={[
            { value: 'metric', label: 'Metric (cm, kg)' },
            { value: 'imperial', label: 'Imperial (ft, lb)' },
          ]}
          label="Units"
        />
      </CalcHeader>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <Panel title="Your measurements">
          <div class="space-y-3">
            {s.units === 'imperial' ? (
              <>
                <div>
                  <span class="mb-1 block text-xs font-medium text-ink-2">Height</span>
                  <div class="grid grid-cols-2 gap-2">
                    <NumField size="lg" value={s.ft} onInput={(v) => set({ ft: v })} suffix="ft" ariaLabel="Height feet" />
                    <NumField size="lg" value={s.in} onInput={(v) => set({ in: v })} suffix="in" ariaLabel="Height inches" />
                  </div>
                </div>
                <div>
                  <div class="mb-1 flex items-center justify-between">
                    <span class="text-xs font-medium text-ink-2">Weight</span>
                    <Segmented
                      value={s.wunit === 'st' ? 'st' : 'lb'}
                      onChange={(v) => setRaw({ wunit: v })}
                      options={[
                        { value: 'lb', label: 'lb' },
                        { value: 'st', label: 'st + lb' },
                      ]}
                      label="Weight unit"
                    />
                  </div>
                  {s.wunit === 'st' ? (
                    <div class="grid grid-cols-2 gap-2">
                      <NumField size="lg" value={s.st} onInput={(v) => set({ st: v })} suffix="st" ariaLabel="Weight stones" />
                      <NumField size="lg" value={s.stlb} onInput={(v) => set({ stlb: v })} suffix="lb" ariaLabel="Weight pounds" />
                    </div>
                  ) : (
                    <NumField size="lg" value={s.lb} onInput={(v) => set({ lb: v })} suffix="lb" ariaLabel="Weight pounds" />
                  )}
                </div>
              </>
            ) : (
              <>
                <NumField label="Height" size="lg" value={s.cm} onInput={(v) => set({ cm: v })} suffix="cm" />
                <NumField label="Weight" size="lg" value={s.kg} onInput={(v) => set({ kg: v })} suffix="kg" />
              </>
            )}
            <div class="grid grid-cols-2 gap-2 border-t border-line pt-3">
              <NumField label="Age (optional)" value={s.age} onInput={(v) => setRaw({ age: v })} suffix="yrs" />
              <label class="block min-w-0">
                <span class="mb-1 block text-xs font-medium text-ink-2">Sex (optional)</span>
                <select class="select h-10" value={s.sex} onChange={(e) => setRaw({ sex: (e.currentTarget as HTMLSelectElement).value })} aria-label="Sex">
                  <option value="">Prefer not to say</option>
                  <option value="f">Female</option>
                  <option value="m">Male</option>
                </select>
              </label>
            </div>
            <p class="text-xs leading-5 text-ink-3">Age and sex do not change the result; they only add notes on how to read it.</p>
          </div>
        </Panel>

        <div class="flex min-w-0 flex-col gap-2">
          <div class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <ResultCard
              label="Your BMI"
              value={m ? formatNumber(round(value, 1), 1) : '–'}
              hint={cat ? `${cat.label} (${cat.range})` : undefined}
              tone={cat ? cat.tone : 'plain'}
              large
              copyValue={m ? String(round(value, 1)) : undefined}
            />
            <ResultCard label="BMI Prime" value={m ? formatNumber(bmiPrime(value), 2) : '–'} hint="BMI ÷ 25. Below 1.00 is within the upper limit." />
          </div>
          {!read.ok && read.error && <Working tone="error">{read.error}</Working>}
          {m && (
            <Working>
              {formatNumber(m.weightKg, 2)} kg ÷ ({formatNumber(m.heightCm / 100, 3)} m)² = {formatNumber(value, 2)}
            </Working>
          )}

          <Panel title="Where you are on the scale">
            <div class="relative pt-6" aria-hidden={!m}>
              <div class="flex h-3 overflow-hidden rounded-full">
                <div class={BAND_COLOURS.under} style={{ width: `${scalePosition(18.5)}%` }} />
                <div class={BAND_COLOURS.healthy} style={{ width: `${scalePosition(25) - scalePosition(18.5)}%` }} />
                <div class={BAND_COLOURS.over} style={{ width: `${scalePosition(30) - scalePosition(25)}%` }} />
                <div class={BAND_COLOURS.obese + ' flex-1'} />
              </div>
              {m && (
                <div class="absolute top-0 -translate-x-1/2 transition-[left] duration-300" style={{ left: `${scalePosition(value)}%` }}>
                  <div class="rounded bg-ink px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-surface">{formatNumber(round(value, 1), 1)}</div>
                  <div class="mx-auto h-0 w-0 border-x-4 border-t-4 border-x-transparent border-t-ink" />
                </div>
              )}
              <div class="relative mt-1 h-4 text-[11px] tabular-nums text-ink-3">
                {[15, 18.5, 25, 30, 35, 40].map((t) => (
                  <span key={t} class="absolute -translate-x-1/2" style={{ left: `${scalePosition(t)}%` }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <ul class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
              {CATEGORIES.map((c) => (
                <li key={c.id} class={'flex items-center gap-1.5 ' + (cat?.id === c.id ? 'font-semibold text-ink' : 'text-ink-3')}>
                  <span class={'h-2 w-2 shrink-0 rounded-full ' + (c.tone === 'success' ? 'bg-success' : c.tone === 'warning' ? 'bg-warning' : 'bg-danger')} />
                  {c.label} <span class="tabular-nums">{c.range}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Healthy weight for your height">
            {range ? (
              <div class="text-sm text-ink-2">
                <span class="font-display text-xl font-semibold tabular-nums text-ink">
                  {fmtW(range[0])} to {fmtW(range[1])}
                </span>
                <span class="ml-2 text-xs text-ink-3">
                  ({otherW(range[0])} to {otherW(range[1])})
                </span>
                {m && (
                  <p class="mt-1 text-xs">
                    {diffToRange === 0 ? 'Your weight is inside this range.' : m.weightKg < range[0] ? `About ${fmtW(diffToRange)} below the range.` : `About ${fmtW(diffToRange)} above the range.`}
                  </p>
                )}
              </div>
            ) : (
              <p class="text-sm text-ink-3">Enter your height to see the range.</p>
            )}
          </Panel>

          <div class="flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-xs leading-5 text-ink-2">
            <Icon name="alert-circle" size={14} class="mt-0.5 shrink-0 text-ink-3" />
            <div>
              BMI is a quick screening measure, not a diagnosis. It cannot tell muscle from fat, so it overstates fat in athletes and can understate it in older adults. Children and teenagers under 20 are assessed with age and sex percentiles, which this calculator does not support.
              {notes.map((n) => (
                <p key={n} class="mt-1 font-medium text-ink">
                  {n}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Calculated in your browser. Nothing you enter is sent anywhere.</span>
        <span class="hidden shrink-0 sm:inline">WHO adult categories</span>
      </div>
    </div>
  );
}
