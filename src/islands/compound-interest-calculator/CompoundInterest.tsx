/**
 * Compound Interest Calculator: initial deposit, regular contributions (optionally rising
 * each year), compounding frequency and inflation, with headline results, a yearly
 * stacked chart and a yearly table with CSV export. Inputs stay in localStorage; Copy
 * link builds a share URL on demand (see calc-kit).
 */
import { useMemo, useState } from 'preact/hooks';
import { CalcHeader, NumField, Panel, ROOT_CLASS, ResultCard, Working, useUrlState } from '../calc-kit/kit';
import { formatNumber, formatPercent } from '../calc-kit/numbers';
import { Segmented } from '../shared/controls';
import { Icon } from '../shared/icons';
import { downloadText, track } from '../shared/toast';
import {
  COMPOUNDING,
  CONTRIBUTION_FREQUENCIES,
  CURRENCIES,
  DEFAULTS,
  MAX_YEARS,
  calculate,
  compactMoney,
  formatMoney,
  niceMax,
  parseInputs,
  rowsToCsv,
  type Currency,
  type Result,
} from './logic';

const TOOL = 'compound-interest-calculator';

export default function CompoundInterest() {
  const [s, set, reset, shareUrl] = useUrlState('cuis-compound:state', DEFAULTS);
  const { inputs, errors } = parseInputs(s);
  const result = useMemo(() => calculate(inputs), [JSON.stringify(inputs)]);
  const money = (n: number) => formatMoney(n, inputs.currency);
  const whole = (n: number) => formatMoney(n, inputs.currency, { decimals: false });
  const symbol = currencySymbol(inputs.currency);
  const freqLabel = CONTRIBUTION_FREQUENCIES.find((f) => f.id === inputs.frequency)!.label.toLowerCase();
  const compLabel = COMPOUNDING.find((c) => c.id === inputs.compounding)!.label.toLowerCase();
  const growth = result.principal + result.totalContributions > 0 ? result.finalBalance / (result.principal + result.totalContributions) : 0;

  return (
    <div class={ROOT_CLASS}>
      <CalcHeader tool={TOOL} title="Compound interest" subtitle="Growth of a deposit and regular contributions over time." onReset={reset} shareUrl={shareUrl}>
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">Currency</span>
          <select class="select h-8 w-auto text-[13px]" value={inputs.currency} onChange={(e) => set({ currency: (e.currentTarget as HTMLSelectElement).value })} aria-label="Currency">
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.label}
              </option>
            ))}
          </select>
        </label>
      </CalcHeader>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        {/* Inputs */}
        <Panel title="Your savings">
          <div class="space-y-3">
            <NumField label="Initial deposit" size="lg" prefix={symbol} value={s.principal} onInput={(v) => set({ principal: v })} invalid={!!errors.principal} />
            <div class="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <NumField label="Regular contribution" prefix={symbol} value={s.contribution} onInput={(v) => set({ contribution: v })} invalid={!!errors.contribution} />
              <div class="min-w-0">
                <span class="mb-1 block text-xs font-medium text-ink-2">Every</span>
                <Segmented value={inputs.frequency} onChange={(v) => set({ freq: v })} options={CONTRIBUTION_FREQUENCIES.map((f) => ({ value: f.id, label: f.id === 'monthly' ? 'Month' : f.id === 'quarterly' ? 'Quarter' : 'Year' }))} label="Contribution frequency" />
              </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs text-ink-2">
              <span>Paid at the</span>
              <Segmented value={inputs.timing} onChange={(v) => set({ timing: v })} options={[{ value: 'start', label: 'Start' }, { value: 'end', label: 'End' }]} label="Contribution timing" />
              <span>of each period</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <NumField label="Interest rate (yearly)" suffix="%" value={s.rate} onInput={(v) => set({ rate: v })} invalid={!!errors.rate} />
              <label class="block min-w-0">
                <span class="mb-1 block text-xs font-medium text-ink-2">Compounded</span>
                <select class="select h-10 text-sm" value={inputs.compounding} onChange={(e) => set({ compound: (e.currentTarget as HTMLSelectElement).value })} aria-label="Compounding frequency">
                  {COMPOUNDING.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <div class="grid grid-cols-2 items-end gap-2">
                <NumField label="Years" value={s.years} onInput={(v) => set({ years: v })} invalid={!!errors.years} />
                <input
                  type="range"
                  min={1}
                  max={MAX_YEARS}
                  value={inputs.years}
                  class="mb-3 w-full accent-brand-600"
                  onInput={(e) => set({ years: (e.currentTarget as HTMLInputElement).value })}
                  aria-label="Years slider"
                />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <NumField label="Raise contribution yearly" suffix="%" value={s.increase} onInput={(v) => set({ increase: v })} invalid={!!errors.increase} />
              <NumField label="Inflation (optional)" suffix="%" value={s.inflation} onInput={(v) => set({ inflation: v })} invalid={!!errors.inflation} />
            </div>
            {Object.values(errors).length > 0 && (
              <ul class="space-y-0.5 text-xs text-danger" role="alert">
                {Object.values(errors).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        {/* Results */}
        <div class="flex min-w-0 flex-col gap-2">
          <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <div class="col-span-2">
              <ResultCard label={`Balance after ${inputs.years} ${inputs.years === 1 ? 'year' : 'years'}`} value={money(result.finalBalance)} tone="brand" large copyValue={result.finalBalance.toFixed(2)} hint={growth ? `${formatNumber(growth, 2)}× what you put in` : undefined} />
            </div>
            <ResultCard label="Total interest" value={whole(result.totalInterest)} tone="success" />
            <ResultCard label="You paid in" value={whole(result.principal + result.totalContributions)} hint={`${whole(result.principal)} + ${whole(result.totalContributions)} contributions`} />
          </div>
          <div class="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <ResultCard label="In today's money" value={inputs.inflation > 0 ? whole(result.realFinalBalance) : '–'} hint={inputs.inflation > 0 ? `at ${formatPercent(inputs.inflation * 100)} inflation a year` : 'Enter an inflation rate'} />
            <ResultCard label="Effective yearly rate" value={formatPercent(result.apy * 100, 3)} hint={`APY, compounded ${compLabel}`} />
            <div class="col-span-2 lg:col-span-1">
              <ResultCard
                label="Time to double"
                value={result.doubling ? `${formatNumber(result.doubling.exact, 1)} years` : '–'}
                hint={result.doubling ? `rule of 72 says ${formatNumber(result.doubling.rule72, 1)}` : 'Needs a rate above 0%'}
              />
            </div>
          </div>
          <Working>
            {whole(result.principal)} plus {whole(inputs.contribution)} every {freqLabel === 'yearly' ? 'year' : freqLabel === 'quarterly' ? 'quarter' : 'month'}
            {inputs.increase > 0 ? `, rising ${formatPercent(inputs.increase * 100)} a year` : ''}, at {formatPercent(inputs.rate * 100)} compounded {compLabel}, for {inputs.years} {inputs.years === 1 ? 'year' : 'years'}.
          </Working>
          <Chart result={result} currency={inputs.currency} />
          <YearTable result={result} currency={inputs.currency} inflation={inputs.inflation > 0} />
        </div>
      </div>
      <p class="mt-2 px-1 text-xs text-ink-3">Estimates for planning only, not financial advice. Real returns vary, and taxes and fees are not included.</p>
    </div>
  );
}

function currencySymbol(code: Currency): string {
  try {
    return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '';
  } catch {
    return '';
  }
}

/** Stacked bars per year: money paid in (brand) and interest earned so far (success). */
function Chart({ result, currency }: { result: Result; currency: Currency }) {
  const rows = result.rows;
  const W = 640;
  const H = 160;
  const pad = { l: 44, r: 8, t: 22, b: 22 };
  const max = niceMax(Math.max(...rows.map((r) => r.balance)));
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / rows.length;
  const gap = Math.min(4, bw * 0.25);
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(rows.length / 10);
  const last = rows[rows.length - 1]!;
  const summary = `Stacked bars by year. After ${rows.length} years: ${formatMoney(last.totalDeposited, currency, { decimals: false })} paid in and ${formatMoney(last.totalInterest, currency, { decimals: false })} interest, balance ${formatMoney(last.balance, currency, { decimals: false })}.`;
  return (
    <section class="min-w-0 rounded-lg border border-line-strong bg-surface p-3" aria-label="Growth by year">
      <div class="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span class="font-semibold uppercase tracking-wide text-ink-3">Growth by year</span>
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-brand-500)' }} /> Paid in
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-success)' }} /> Interest
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} class="h-auto w-full" role="img" aria-label={summary}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" stroke-width="1" />
            <text x={pad.l - 6} y={y(t) + 3.5} text-anchor="end" font-size="10" fill="var(--color-ink-3)">
              {compactMoney(t, currency)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = pad.l + i * bw + gap / 2;
          const w = Math.max(1, bw - gap);
          const yDep = y(r.totalDeposited);
          const yTop = y(r.balance);
          return (
            <g key={r.year}>
              <rect x={x} y={yDep} width={w} height={pad.t + ih - yDep} fill="var(--color-brand-500)" rx="1.5">
                <title>{`Year ${r.year}: paid in ${formatMoney(r.totalDeposited, currency, { decimals: false })}`}</title>
              </rect>
              <rect x={x} y={yTop} width={w} height={Math.max(0, yDep - yTop)} fill="var(--color-success)" rx="1.5">
                <title>{`Year ${r.year}: interest ${formatMoney(r.totalInterest, currency, { decimals: false })}, balance ${formatMoney(r.balance, currency, { decimals: false })}`}</title>
              </rect>
              {(r.year % labelEvery === 0 || r.year === 1) && (
                <text x={x + w / 2} y={H - 6} text-anchor="middle" font-size="10" fill="var(--color-ink-3)">
                  {r.year}
                </text>
              )}
            </g>
          );
        })}
        <text x={W - pad.r} y={Math.max(12, y(last.balance) - 6)} text-anchor="end" font-size="11" font-weight="600" fill="var(--color-ink)">
          {compactMoney(last.balance, currency)}
        </text>
      </svg>
    </section>
  );
}

function YearTable({ result, currency, inflation }: { result: Result; currency: Currency; inflation: boolean }) {
  const [open, setOpen] = useState(true);
  const m = (n: number) => formatMoney(n, currency, { decimals: false });
  return (
    <section class="min-w-0 overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Year by year">
      <header class="flex h-9 items-center gap-2 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
        <button type="button" class="flex items-center gap-1 font-semibold text-ink" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} /> Year by year
        </button>
        <span class="flex-1" />
        <button
          type="button"
          class="btn-ghost btn-sm h-7"
          onClick={() => {
            downloadText(rowsToCsv(result.rows), 'compound-interest.csv', 'text/csv');
            track('tool_action', { tool: TOOL, action: 'download_csv' });
          }}
        >
          <Icon name="download" size={13} /> CSV
        </button>
      </header>
      {open && (
        <div class="scrollbar-thin max-h-[180px] overflow-auto">
          <table class="w-full min-w-[520px] text-right text-[13px] tabular-nums">
            <thead class="sticky top-0 bg-surface text-xs text-ink-3">
              <tr class="border-b border-line">
                <th scope="col" class="px-3 py-1.5 text-left font-medium">Year</th>
                <th scope="col" class="px-3 py-1.5 font-medium">Contributions</th>
                <th scope="col" class="px-3 py-1.5 font-medium">Interest</th>
                <th scope="col" class="px-3 py-1.5 font-medium">End balance</th>
                {inflation && <th scope="col" class="px-3 py-1.5 font-medium">Today's money</th>}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.year} class="border-b border-line last:border-b-0">
                  <th scope="row" class="px-3 py-1.5 text-left font-medium text-ink-2">{r.year}</th>
                  <td class="px-3 py-1.5 text-ink-2">{m(r.contributions)}</td>
                  <td class="px-3 py-1.5 text-success">{m(r.interest)}</td>
                  <td class="px-3 py-1.5 font-medium text-ink">{m(r.balance)}</td>
                  {inflation && <td class="px-3 py-1.5 text-ink-2">{m(r.realBalance)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
