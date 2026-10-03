/**
 * Loan & EMI Calculator: inputs on the left, results on the right (headline figures,
 * a principal/interest donut, a yearly breakdown chart with the remaining balance, and
 * the amortisation schedule). State round-trips through the URL so a calculation can be
 * shared, with localStorage as a fallback.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  CURRENCIES,
  DEFAULT_INPUT,
  FREQUENCY_LABELS,
  LIMITS,
  calculate,
  formatDuration,
  formatMoney,
  formatMoneyCompact,
  formatMonthYear,
  fromQuery,
  periodsToMonths,
  sanitize,
  scheduleCsv,
  toQuery,
  yearly,
  type CurrencyCode,
  type Frequency,
  type LoanInput,
  type ScheduleRow,
  type YearRow,
} from './logic';

const TOOL = 'loan-emi-calculator';
const PREFS_KEY = 'cuis-loan:prefs';

function loadInitial(): LoanInput {
  let stored: Partial<Record<keyof LoanInput, unknown>> = {};
  try {
    stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as typeof stored;
  } catch {}
  const fromStorage = sanitize(stored ?? {});
  try {
    const q = fromQuery(window.location.search);
    if (Object.keys(q).length) return sanitize(q, fromStorage);
  } catch {}
  return fromStorage;
}

export default function LoanCalculator() {
  const [input, setInput] = useState<LoanInput>(loadInitial);
  const [view, setView] = useState<'monthly' | 'yearly'>('yearly');
  const set = <K extends keyof LoanInput>(key: K, value: LoanInput[K]) => setInput((i) => sanitize({ ...i, [key]: value }, i));

  const result = useMemo(() => calculate(input), [input]);
  const years = useMemo(() => yearly(result.rows, input.frequency), [result.rows, input.frequency]);
  const money = (n: number, digits?: number) => formatMoney(n, input.currency, digits);
  const freqWord = input.frequency === 'monthly' ? 'Monthly' : input.frequency === 'weekly' ? 'Weekly' : 'Fortnightly';
  const hasPrepay = input.extraMonthly > 0 || input.lumpSum > 0;
  const principalTotal = Math.max(0, input.amount);

  // Persist to the URL and localStorage (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(input));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [input]);

  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}?${toQuery(input)}`;
    const ok = await copyText(url);
    toast(ok ? 'Link copied with your figures' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy_link' });
  };

  const reset = () => {
    setInput({ ...DEFAULT_INPUT, start: DEFAULT_INPUT.start, currency: input.currency });
    track('tool_action', { tool: TOOL, action: 'reset' });
  };

  const downloadCsv = () => {
    downloadText(scheduleCsv(result.rows), 'amortisation-schedule.csv', 'text/csv');
    track('tool_action', { tool: TOOL, action: 'download_csv' });
  };

  const amountMax = Math.max(1_000_000, Math.ceil((input.amount * 2) / 100_000) * 100_000);

  return (
    <div class="flex flex-col bg-surface-2 text-ink relative min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">Currency</span>
          <select class="select h-8 w-auto text-[13px]" value={input.currency} onChange={(e) => set('currency', (e.currentTarget as HTMLSelectElement).value as CurrencyCode)} aria-label="Currency">
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <span class="flex-1" />
        <button type="button" class="btn-secondary btn-sm" onClick={() => void copyLink()} title="Copy a link that reopens this calculation">
          <Icon name="link" size={14} /> Copy link
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Back to the example loan">
          <Icon name="eraser" size={14} /> Reset
        </button>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[21rem_minmax(0,1fr)]">
        {/* Inputs */}
        <section class="min-w-0 rounded-lg border border-line-strong bg-surface p-3" aria-label="Loan details">
          <div class="space-y-4">
            <SliderField label="Loan amount" value={input.amount} min={0} max={amountMax} step={amountMax >= 10_000_000 ? 50_000 : 1000} onChange={(v) => set('amount', v)} display={money(input.amount, 0)} />
            <SliderField label="Interest rate (per year)" value={input.rate} min={0} max={30} step={0.05} onChange={(v) => set('rate', v)} display={`${input.rate.toFixed(2)}%`} suffix="%" />
            <div>
              <div class="mb-1 flex items-center justify-between text-xs text-ink-2">
                <span>Loan term</span>
                <span class="font-mono text-ink">{formatDuration(input.years * 12 + input.months)}</span>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <NumberBox label="Years" value={input.years} min={0} max={LIMITS.years.max} step={1} onChange={(v) => set('years', v)} />
                <NumberBox label="Months" value={input.months} min={0} max={11} step={1} onChange={(v) => set('months', v)} />
              </div>
              <input type="range" class="mt-2 w-full accent-brand-600" min={0} max={40} step={1} value={input.years} onInput={(e) => set('years', Number((e.currentTarget as HTMLInputElement).value))} aria-label="Loan term in years" />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <label class="block">
                <span class="text-xs text-ink-2">First payment</span>
                <input type="month" class="input mt-0.5 h-8 text-xs" value={input.start} onInput={(e) => set('start', (e.currentTarget as HTMLInputElement).value)} aria-label="First payment month" />
              </label>
              <label class="block">
                <span class="text-xs text-ink-2">Payments</span>
                <select class="select mt-0.5 h-8 text-xs" value={input.frequency} onChange={(e) => set('frequency', (e.currentTarget as HTMLSelectElement).value as Frequency)} aria-label="Payment frequency">
                  {(Object.keys(FREQUENCY_LABELS) as Frequency[]).map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div class="border-t border-line pt-3">
              <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Prepayments (optional)</h3>
              <div class="space-y-3">
                <SliderField label="Extra each month" value={input.extraMonthly} min={0} max={Math.max(1000, Math.ceil(result.instalment / 100) * 100 * 2)} step={10} onChange={(v) => set('extraMonthly', v)} display={money(input.extraMonthly, 0)} />
                <div class="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2">
                  <NumberBox label="One-off lump sum" value={input.lumpSum} min={0} max={LIMITS.lumpSum.max} step={1000} onChange={(v) => set('lumpSum', v)} />
                  <NumberBox label="In loan month" value={input.lumpMonth} min={1} max={LIMITS.lumpMonth.max} step={1} onChange={(v) => set('lumpMonth', v)} />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Results */}
        <section class="flex min-w-0 flex-col gap-2" aria-label="Results">
          <div class="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <Tile label={`${freqWord} payment`} value={money(result.instalment)} strong />
            <Tile label="Total interest" value={money(result.totalInterest)} />
            <Tile label="Total paid" value={money(result.totalPaid)} />
            <Tile label="Paid off" value={formatMonthYear(result.payoffDate)} sub={result.rows.length ? formatDuration(periodsToMonths(result.rows.length, input.frequency)) : undefined} />
          </div>

          {hasPrepay && result.rows.length > 0 && (
            <p class="flex flex-wrap items-center gap-x-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-ink-2" role="status">
              <Icon name="check-circle" size={15} class="text-success" />
              Prepaying saves <strong class="text-ink">{money(result.interestSaved)}</strong> in interest and finishes
              <strong class="text-ink">{result.monthsSaved >= 1 ? formatDuration(result.monthsSaved) : 'less than a month'}</strong> earlier
              <span class="text-ink-3">(instead of {formatMonthYear(result.baseline.payoffDate)}).</span>
            </p>
          )}

          {result.rows.length === 0 ? (
            <div class="flex flex-1 items-center justify-center rounded-lg border border-line-strong bg-surface p-8 text-sm text-ink-3">Enter a loan amount and a term to see the repayments.</div>
          ) : (
            <>
              <div class="grid grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[13rem_minmax(0,1fr)]">
                <div class="min-w-0 rounded-lg border border-line-strong bg-surface p-3">
                  <h3 class="text-xs font-semibold text-ink-2">Where the money goes</h3>
                  <Donut principal={principalTotal} interest={result.totalInterest} format={money} />
                </div>
                <div class="min-w-0 rounded-lg border border-line-strong bg-surface p-3">
                  <h3 class="text-xs font-semibold text-ink-2">Paid each year and balance left</h3>
                  <YearChart years={years} amount={principalTotal} currency={input.currency} />
                </div>
              </div>

              <div class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface">
                <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
                  <span class="font-semibold text-ink">Amortisation schedule</span>
                  <span class="text-ink-3">{result.rows.length} payments</span>
                  <span class="flex-1" />
                  <Segmented
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'yearly', label: 'Yearly' },
                      { value: 'monthly', label: input.frequency === 'monthly' ? 'Monthly' : 'Each payment' },
                    ]}
                    label="Schedule view"
                  />
                  <button type="button" class="btn-ghost btn-sm h-7" onClick={downloadCsv} title="Download every payment as CSV">
                    <Icon name="download" size={13} /> CSV
                  </button>
                </header>
                <div class="scrollbar-thin max-h-[260px] overflow-auto">
                  {view === 'yearly' ? <YearTable rows={years} format={money} /> : <PaymentTable rows={result.rows} format={money} />}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      <div class="mt-2 flex min-h-5 flex-wrap items-center justify-between gap-x-3 px-1 text-xs text-ink-3">
        <span>Estimates for a fixed-rate loan. Your lender's figures may differ because of fees, rounding and day-count rules.</span>
        <span>Calculated in your browser</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ inputs

function SliderField(p: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string; suffix?: string }) {
  return (
    <div>
      <div class="mb-1 flex items-center justify-between gap-2 text-xs text-ink-2">
        <span>{p.label}</span>
        <span class="font-mono text-ink">{p.display}</span>
      </div>
      <div class="flex items-center gap-2">
        <input
          type="range"
          class="min-w-0 flex-1 accent-brand-600"
          min={p.min}
          max={p.max}
          step={p.step}
          value={Math.min(p.value, p.max)}
          onInput={(e) => p.onChange(Number((e.currentTarget as HTMLInputElement).value))}
          aria-label={`${p.label} slider`}
        />
        <input
          type="number"
          class="input h-8 w-28 font-mono text-xs"
          value={p.value}
          min={p.min}
          step={p.step}
          onInput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
            if (Number.isFinite(v)) p.onChange(v);
          }}
          aria-label={p.label}
        />
      </div>
    </div>
  );
}

function NumberBox(p: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label class="block min-w-0">
      <span class="text-xs text-ink-2">{p.label}</span>
      <input
        type="number"
        class="input mt-0.5 h-8 font-mono text-xs"
        value={p.value}
        min={p.min}
        max={p.max}
        step={p.step}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
          if (Number.isFinite(v)) p.onChange(v);
        }}
        aria-label={p.label}
      />
    </label>
  );
}

function Tile(p: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div class={'min-w-0 rounded-lg border p-3 ' + (p.strong ? 'border-brand-300 bg-brand-50 dark:border-brand-700 dark:bg-brand-900/30' : 'border-line-strong bg-surface')}>
      <div class="text-xs text-ink-2">{p.label}</div>
      <div class={'mt-0.5 truncate font-mono font-semibold tabular-nums ' + (p.strong ? 'text-xl text-brand-700 dark:text-brand-200' : 'text-lg text-ink')} title={p.value}>
        {p.value}
      </div>
      {p.sub && <div class="text-xs text-ink-3">{p.sub}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ charts

function Donut(p: { principal: number; interest: number; format: (n: number, d?: number) => string }) {
  const total = p.principal + p.interest;
  const R = 52;
  const C = 2 * Math.PI * R;
  const share = total > 0 ? p.principal / total : 1;
  const principalLen = C * share;
  const pct = (n: number) => (total > 0 ? `${Math.round((n / total) * 100)}%` : '0%');
  const label = `Principal ${p.format(p.principal, 0)} (${pct(p.principal)}) and interest ${p.format(p.interest, 0)} (${pct(p.interest)}) of ${p.format(total, 0)} paid in total.`;
  return (
    <div class="mt-2 flex items-center gap-3 md:flex-col md:items-stretch">
      <svg viewBox="0 0 140 140" class="h-28 w-28 shrink-0 md:mx-auto" role="img" aria-label={label}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--color-warning)" stroke-width="20" />
        <circle
          cx="70"
          cy="70"
          r={R}
          fill="none"
          stroke="var(--color-brand-500)"
          stroke-width="20"
          stroke-dasharray={`${principalLen} ${C - principalLen}`}
          transform="rotate(-90 70 70)"
          stroke-linecap="butt"
        />
        <text x="70" y="66" text-anchor="middle" class="fill-ink-3" style={{ fontSize: '10px' }}>
          interest
        </text>
        <text x="70" y="82" text-anchor="middle" class="fill-ink" style={{ fontSize: '15px', fontWeight: 600 }}>
          {pct(p.interest)}
        </text>
      </svg>
      <dl class="min-w-0 space-y-1.5 text-xs">
        <LegendRow color="var(--color-brand-500)" label="Principal" value={p.format(p.principal, 0)} />
        <LegendRow color="var(--color-warning)" label="Interest" value={p.format(p.interest, 0)} />
      </dl>
    </div>
  );
}

function LegendRow(p: { color: string; label: string; value: string }) {
  return (
    <div class="flex min-w-0 items-center gap-2">
      <span class="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
      <dt class="text-ink-2">{p.label}</dt>
      <dd class="ml-auto truncate font-mono text-ink">{p.value}</dd>
    </div>
  );
}

function YearChart(p: { years: YearRow[]; amount: number; currency: CurrencyCode }) {
  const W = 520;
  const H = 190;
  const padL = 46;
  const padR = 46;
  const padT = 10;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const n = p.years.length;
  // Bars stack principal (regular plus prepayments) under interest: everything paid that year.
  const repaid = (y: YearRow) => y.principal + y.extra;
  const maxPaid = Math.max(1, ...p.years.map((y) => repaid(y) + y.interest));
  const maxBal = Math.max(1, p.amount);
  const slot = plotW / Math.max(1, n);
  const barW = Math.max(2, Math.min(28, slot * 0.7));
  const x = (i: number) => padL + slot * i + (slot - barW) / 2;
  const yPaid = (v: number) => padT + plotH - (v / maxPaid) * plotH;
  const yBal = (v: number) => padT + plotH - (v / maxBal) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / 10));
  const compact = (v: number) => formatMoneyCompact(v, p.currency);
  // Balance at the start of each year (the principal for year 1) and the end of the last year
  const balancePoints = [p.amount, ...p.years.map((y) => y.balance)].map((b, i) => `${padL + slot * i},${yBal(b)}`).join(' ');
  const first = p.years[0];
  const last = p.years.at(-1);
  const label = first && last
    ? `Yearly payments over ${n} ${n === 1 ? 'year' : 'years'}. Year 1 pays ${compact(first.principal + first.extra)} principal and ${compact(first.interest)} interest; year ${n} pays ${compact(last.principal + last.extra)} principal and ${compact(last.interest)} interest. The balance falls from ${compact(p.amount)} to zero. The schedule table below has every figure.`
    : 'No payments';

  return (
    <div class="mt-1">
      <svg viewBox={`0 0 ${W} ${H}`} class="h-auto w-full" role="img" aria-label={label}>
        {/* grid lines */}
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={padL} x2={W - padR} y1={padT + plotH * (1 - f)} y2={padT + plotH * (1 - f)} stroke="var(--color-line)" stroke-width="1" />
        ))}
        {/* left axis: paid per year */}
        <text x={padL - 6} y={padT + 4} text-anchor="end" class="fill-ink-3" style={{ fontSize: '10px' }}>
          {compact(maxPaid)}
        </text>
        <text x={padL - 6} y={padT + plotH + 3} text-anchor="end" class="fill-ink-3" style={{ fontSize: '10px' }}>
          0
        </text>
        {/* right axis: balance */}
        <text x={W - padR + 6} y={padT + 4} class="fill-ink-3" style={{ fontSize: '10px' }}>
          {compact(maxBal)}
        </text>
        {/* bars */}
        {p.years.map((y, i) => {
          const top = yPaid(repaid(y) + y.interest);
          const mid = yPaid(repaid(y));
          return (
            <g key={y.year}>
              <title>{`Year ${y.year}: principal ${compact(repaid(y))}${y.extra ? ` (including ${compact(y.extra)} extra)` : ''}, interest ${compact(y.interest)}, balance left ${compact(y.balance)}`}</title>
              <rect x={x(i)} y={mid} width={barW} height={Math.max(0, padT + plotH - mid)} fill="var(--color-brand-500)" rx="1.5" />
              <rect x={x(i)} y={top} width={barW} height={Math.max(0, mid - top)} fill="var(--color-warning)" rx="1.5" />
              {(i % labelEvery === 0 || i === n - 1) && (
                <text x={x(i) + barW / 2} y={H - 6} text-anchor="middle" class="fill-ink-3" style={{ fontSize: '10px' }}>
                  {y.year}
                </text>
              )}
            </g>
          );
        })}
        {/* balance line */}
        <polyline points={balancePoints} fill="none" stroke="var(--color-ink-2)" stroke-width="2" stroke-linejoin="round" />
        <circle cx={padL} cy={yBal(p.amount)} r="3" fill="var(--color-ink-2)" />
      </svg>
      <div class="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-hidden="true">
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-brand-500)' }} /> Principal
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-warning)' }} /> Interest
        </span>
        <span class="flex items-center gap-1.5">
          <span class="h-0.5 w-4 rounded" style={{ background: 'var(--color-ink-2)' }} /> Balance left (right scale)
        </span>
        <span class="ml-auto text-ink-3">Loan year</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tables

function Th(p: { children: ComponentChildren; left?: boolean }) {
  return <th class={'sticky top-0 z-10 bg-surface-2 px-3 py-1.5 font-medium text-ink-2 ' + (p.left ? 'text-left' : 'text-right')}>{p.children}</th>;
}

function YearTable(p: { rows: YearRow[]; format: (n: number, d?: number) => string }) {
  return (
    <table class="w-full min-w-[34rem] text-xs">
      <thead>
        <tr>
          <Th left>Year</Th>
          <Th>Paid</Th>
          <Th>Principal</Th>
          <Th>Interest</Th>
          <Th>Extra</Th>
          <Th>Balance</Th>
        </tr>
      </thead>
      <tbody class="font-mono tabular-nums">
        {p.rows.map((y) => (
          <tr key={y.year} class="border-t border-line">
            <td class="px-3 py-1 text-left font-sans text-ink-2">
              {y.year} <span class="text-ink-3">({formatMonthYear(y.from)} to {formatMonthYear(y.to)})</span>
            </td>
            <td class="px-3 py-1 text-right">{p.format(y.payment + y.extra)}</td>
            <td class="px-3 py-1 text-right">{p.format(y.principal)}</td>
            <td class="px-3 py-1 text-right">{p.format(y.interest)}</td>
            <td class="px-3 py-1 text-right text-ink-2">{y.extra ? p.format(y.extra) : '–'}</td>
            <td class="px-3 py-1 text-right">{p.format(y.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PaymentTable(p: { rows: ScheduleRow[]; format: (n: number, d?: number) => string }) {
  return (
    <table class="w-full min-w-[36rem] text-xs">
      <thead>
        <tr>
          <Th left>#</Th>
          <Th left>Date</Th>
          <Th>Payment</Th>
          <Th>Principal</Th>
          <Th>Interest</Th>
          <Th>Extra</Th>
          <Th>Balance</Th>
        </tr>
      </thead>
      <tbody class="font-mono tabular-nums">
        {p.rows.map((r) => (
          <tr key={r.period} class="border-t border-line">
            <td class="px-3 py-1 text-left text-ink-3">{r.period}</td>
            <td class="px-3 py-1 text-left font-sans text-ink-2">{r.date}</td>
            <td class="px-3 py-1 text-right">{p.format(r.payment)}</td>
            <td class="px-3 py-1 text-right">{p.format(r.principal)}</td>
            <td class="px-3 py-1 text-right">{p.format(r.interest)}</td>
            <td class="px-3 py-1 text-right text-ink-2">{r.extra ? p.format(r.extra) : '–'}</td>
            <td class="px-3 py-1 text-right">{p.format(r.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
