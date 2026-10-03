/**
 * Tip Calculator: bill, tip percent, optional tax, split and rounding, with results per
 * person and a comparison table. State lives in the URL for sharing.
 */
import { CalcHeader, NumField, Panel, ROOT_CLASS, ResultCard, Working, useUrlState } from '../calc-kit/kit';
import { Chip, Segmented } from '../shared/controls';
import { Icon } from '../shared/icons';
import { formatNumber, parseNumber } from '../calc-kit/numbers';
import { CURRENCIES, DEFAULTS, TIP_PRESETS, calculateTip, comparisonTable, formatMoney, toInput } from './logic';

const TOOL = 'tip-calculator';

export default function TipCalculator() {
  const [s, set, reset, shareUrl] = useUrlState('cuis-tip:state', DEFAULTS);
  const input = toInput(s);
  const outcome = calculateTip(input);
  const r = outcome.ok ? outcome.result : null;
  const money = (n: number) => formatMoney(n, input.currency);
  const table = comparisonTable(input);
  const pct = parseNumber(s.tip);
  const people = Math.max(1, Math.round(parseNumber(s.people) || 1));
  const symbol = new Intl.NumberFormat(undefined, { style: 'currency', currency: input.currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? '';

  return (
    <div class={ROOT_CLASS}>
      <CalcHeader tool={TOOL} title="Tip calculator" subtitle="Enter the bill as printed; add tax only if you want to tip on the pre-tax amount." onReset={reset} shareUrl={shareUrl}>
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">Currency</span>
          <select class="select h-8 w-auto text-[13px]" value={input.currency} onChange={(e) => set({ currency: (e.currentTarget as HTMLSelectElement).value })} aria-label="Currency">
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.label}
              </option>
            ))}
          </select>
        </label>
      </CalcHeader>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <Panel title="Bill">
          <div class="space-y-3">
            <NumField label="Bill amount" size="lg" value={s.bill} onInput={(v) => set({ bill: v })} prefix={symbol} placeholder="0.00" invalid={s.bill.trim() !== '' && Number.isNaN(parseNumber(s.bill))} />
            <div>
              <span class="mb-1 block text-xs font-medium text-ink-2">Tip</span>
              <div class="flex flex-wrap items-center gap-1.5">
                {TIP_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    class={'h-9 rounded-md border px-3 text-sm font-medium tabular-nums transition-colors ' + (pct === p ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-3')}
                    onClick={() => set({ tip: String(p) })}
                    aria-pressed={pct === p}
                  >
                    {formatNumber(p, 1)}%
                  </button>
                ))}
                <NumField size="inline" value={s.tip} onInput={(v) => set({ tip: v })} suffix="%" ariaLabel="Custom tip percent" />
              </div>
            </div>
            <div>
              <span class="mb-1 block text-xs font-medium text-ink-2">Split between</span>
              <div class="flex items-center gap-1.5">
                <button type="button" class="btn-secondary btn-icon h-10 w-10" onClick={() => set({ people: String(Math.max(1, people - 1)) })} aria-label="One person fewer" disabled={people <= 1}>
                  <Icon name="minus" size={16} />
                </button>
                <NumField size="inline" value={s.people} onInput={(v) => set({ people: v })} suffix={people === 1 ? 'person' : 'people'} ariaLabel="Number of people" class="[&_input]:w-36" />
                <button type="button" class="btn-secondary btn-icon h-10 w-10" onClick={() => set({ people: String(Math.min(100, people + 1)) })} aria-label="One more person">
                  <Icon name="plus" size={16} />
                </button>
              </div>
            </div>
            <div>
              <span class="mb-1 block text-xs font-medium text-ink-2">Round up</span>
              <Segmented
                value={input.rounding}
                onChange={(v) => set({ rounding: v })}
                options={[
                  { value: 'none', label: 'Exact' },
                  { value: 'total', label: 'Total' },
                  { value: 'person', label: 'Each share' },
                ]}
                label="Rounding"
              />
            </div>
            <details class="rounded-md border border-line bg-surface-2 p-2" open={input.taxMode !== 'none'}>
              <summary class="cursor-pointer select-none text-xs font-medium text-ink-2">Tax (optional, to tip on the pre-tax amount)</summary>
              <div class="mt-2 space-y-2">
                <Segmented
                  value={input.taxMode}
                  onChange={(v) => set({ taxMode: v })}
                  options={[
                    { value: 'none', label: 'No tax' },
                    { value: 'amount', label: 'Amount' },
                    { value: 'percent', label: 'Percent' },
                  ]}
                  label="Tax entry"
                />
                {input.taxMode !== 'none' && (
                  <div class="flex flex-wrap items-center gap-2">
                    <NumField size="inline" value={s.tax} onInput={(v) => set({ tax: v })} prefix={input.taxMode === 'amount' ? symbol : undefined} suffix={input.taxMode === 'percent' ? '%' : undefined} ariaLabel="Tax" />
                    <Chip on={input.tipBase === 'pre'} onClick={() => set({ base: input.tipBase === 'pre' ? 'post' : 'pre' })} title="Calculate the tip on the amount before tax">
                      Tip on pre-tax amount
                    </Chip>
                  </div>
                )}
              </div>
            </details>
          </div>
        </Panel>

        <div class="flex min-w-0 flex-col gap-2">
          <div class="grid grid-cols-2 gap-2">
            <ResultCard label="Tip" value={r ? money(r.tip) : '–'} hint={r ? `${formatNumber(r.effectivePercent, 2)}% of ${money(r.tipBaseAmount)}` : undefined} copyValue={r ? String(r.tip) : undefined} />
            <ResultCard label="Total" value={r ? money(r.total) : '–'} hint={r && r.roundingExtra > 0 ? `Includes ${money(r.roundingExtra)} from rounding` : undefined} copyValue={r ? String(r.total) : undefined} />
            <ResultCard label="Tip per person" value={r ? money(r.perPersonTip) : '–'} tone="plain" />
            <ResultCard
              label={people > 1 ? 'Each person pays' : 'You pay'}
              value={r ? money(r.highCount ? r.shareHigh : r.perPersonTotal) : '–'}
              hint={r && r.highCount ? `${r.highCount} pay${r.highCount === 1 ? 's' : ''} ${money(r.shareHigh)}, ${people - r.highCount} pay${people - r.highCount === 1 ? 's' : ''} ${money(r.shareLow)} so the shares add up exactly` : undefined}
              tone="brand"
              large
              copyValue={r ? String(r.highCount ? r.shareHigh : r.perPersonTotal) : undefined}
            />
          </div>
          {!outcome.ok && outcome.error && <Working tone="error">{outcome.error}</Working>}
          {r && (
            <Working>
              {money(r.tipBaseAmount)} × {formatNumber(pct || 0, 2)}% = {money(r.tip)} tip; {money(r.bill)} + {money(r.tip)} = {money(r.total)}
              {people > 1 ? `; ÷ ${people} = ${formatNumber(r.perPersonTotal, 4)} each` : ''}
            </Working>
          )}
          <Panel title="Compare tips" class="p-0">
            <div class="overflow-x-auto">
              <table class="w-full text-sm tabular-nums">
                <thead>
                  <tr class="text-left text-xs text-ink-3">
                    <th class="px-3 py-1.5 font-medium">Tip</th>
                    <th class="px-3 py-1.5 text-right font-medium">Tip amount</th>
                    <th class="px-3 py-1.5 text-right font-medium">Total</th>
                    <th class="px-3 py-1.5 text-right font-medium">{people > 1 ? 'Per person' : 'You pay'}</th>
                  </tr>
                </thead>
                <tbody>
                  {table.map((row) => (
                    <tr
                      key={row.percent}
                      class={'cursor-pointer border-t border-line hover:bg-surface-3 ' + (row.percent === pct ? 'bg-brand-50 font-semibold dark:bg-brand-900/30' : '')}
                      onClick={() => set({ tip: String(row.percent) })}
                      title={`Use ${row.percent}%`}
                    >
                      <td class="px-3 py-1.5">{formatNumber(row.percent, 1)}%</td>
                      <td class="px-3 py-1.5 text-right">{money(row.tip)}</td>
                      <td class="px-3 py-1.5 text-right">{money(row.total)}</td>
                      <td class="px-3 py-1.5 text-right">{money(row.perPerson)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Worked out in whole cents (or yen). Uneven splits show who pays a cent more, so shares add up exactly.</span>
        <span class="hidden shrink-0 sm:inline">Click a row to use that tip</span>
      </div>
    </div>
  );
}
