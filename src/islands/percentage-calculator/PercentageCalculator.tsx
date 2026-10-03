/**
 * Percentage Calculator: a stack of independent sentence-style calculators, each with
 * inline inputs, an instant answer and a one-line working. State lives in the URL.
 */
import type { ComponentChildren } from 'preact';
import { CalcHeader, NumField, ROOT_CLASS, Working, useUrlState } from '../calc-kit/kit';
import { copyText, toast } from '../shared/toast';
import { Icon } from '../shared/icons';
import { DEFAULTS, decreaseBy, increaseBy, percentChange, percentDifference, percentOf, pointsVsPercent, wholeFromPart, whatPercent, type Outcome } from './logic';

const TOOL = 'percentage-calculator';

export default function PercentageCalculator() {
  const [s, set, reset, shareUrl] = useUrlState('cuis-pct:state', DEFAULTS);
  const change = percentChange(s.d1, s.d2);
  const pts = pointsVsPercent(s.h1, s.h2);

  return (
    <div class={ROOT_CLASS}>
      <CalcHeader tool={TOOL} title="Percentage calculators" subtitle="Every answer updates as you type. Commas or dots both work as decimals." onReset={reset} shareUrl={shareUrl} />
      <div class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2">
        <Row result={percentOf(s.a1, s.a2)}>
          What is <NumField size="inline" value={s.a1} onInput={(v) => set({ a1: v })} suffix="%" ariaLabel="Percent" /> of <NumField size="inline" value={s.a2} onInput={(v) => set({ a2: v })} ariaLabel="Number" />?
        </Row>
        <Row result={whatPercent(s.b1, s.b2)}>
          <NumField size="inline" value={s.b1} onInput={(v) => set({ b1: v })} ariaLabel="Part" /> is what percent of <NumField size="inline" value={s.b2} onInput={(v) => set({ b2: v })} ariaLabel="Whole" />?
        </Row>
        <Row result={wholeFromPart(s.c1, s.c2)}>
          <NumField size="inline" value={s.c1} onInput={(v) => set({ c1: v })} ariaLabel="Part" /> is <NumField size="inline" value={s.c2} onInput={(v) => set({ c2: v })} suffix="%" ariaLabel="Percent" /> of what?
        </Row>
        <Row result={change.outcome} tone={change.direction === 'increase' ? 'up' : change.direction === 'decrease' ? 'down' : undefined}>
          Change from <NumField size="inline" value={s.d1} onInput={(v) => set({ d1: v })} ariaLabel="From" /> to <NumField size="inline" value={s.d2} onInput={(v) => set({ d2: v })} ariaLabel="To" />
        </Row>
        <Row result={increaseBy(s.e1, s.e2)}>
          Increase <NumField size="inline" value={s.e1} onInput={(v) => set({ e1: v })} ariaLabel="Number" /> by <NumField size="inline" value={s.e2} onInput={(v) => set({ e2: v })} suffix="%" ariaLabel="Percent" />
        </Row>
        <Row result={decreaseBy(s.f1, s.f2)}>
          Decrease <NumField size="inline" value={s.f1} onInput={(v) => set({ f1: v })} ariaLabel="Number" /> by <NumField size="inline" value={s.f2} onInput={(v) => set({ f2: v })} suffix="%" ariaLabel="Percent" />
        </Row>
        <Row result={percentDifference(s.g1, s.g2)}>
          Percentage difference between <NumField size="inline" value={s.g1} onInput={(v) => set({ g1: v })} ariaLabel="First value" /> and <NumField size="inline" value={s.g2} onInput={(v) => set({ g2: v })} ariaLabel="Second value" />
        </Row>
        <Row result={pts.points} extra={pts.relative.ok ? `That is a relative change of ${pts.relative.display}.` : undefined}>
          From <NumField size="inline" value={s.h1} onInput={(v) => set({ h1: v })} suffix="%" ariaLabel="First rate" /> to <NumField size="inline" value={s.h2} onInput={(v) => set({ h2: v })} suffix="%" ariaLabel="Second rate" /> in points
        </Row>
      </div>
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Calculated in your browser. Copy link shares these exact numbers.</span>
        <span class="hidden shrink-0 sm:inline">Click an answer to copy it</span>
      </div>
    </div>
  );
}

function Row(p: { result: Outcome; children: ComponentChildren; tone?: 'up' | 'down'; extra?: string }) {
  const r = p.result;
  const color = p.tone === 'up' ? 'text-success' : p.tone === 'down' ? 'text-danger' : 'text-ink';
  return (
    <section class="min-w-0 rounded-lg border border-line-strong bg-surface p-3">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 text-[15px] text-ink-2">{p.children}</div>
      <div class="mt-2 flex min-h-9 items-center gap-2">
        <span class="text-ink-3">=</span>
        {r.ok ? (
          <button
            type="button"
            class={`group inline-flex min-w-0 items-center gap-1.5 rounded px-1 text-left font-display text-2xl font-semibold tabular-nums hover:bg-surface-3 ${color}`}
            title="Copy the answer"
            onClick={async () => {
              const ok = await copyText(String(Math.round(r.value * 1e8) / 1e8));
              toast(ok ? 'Answer copied' : 'Copy failed', ok ? 'ok' : 'error');
            }}
          >
            <span class="break-all">{r.display}</span>
            <Icon name="copy" size={14} class="shrink-0 text-ink-3 opacity-0 group-hover:opacity-100" />
          </button>
        ) : (
          <span class="text-2xl text-ink-3">–</span>
        )}
      </div>
      {r.ok ? <Working>{r.working}</Working> : r.error ? <Working tone="error">{r.error}</Working> : <Working>Fill in both numbers.</Working>}
      {p.extra && <p class="mt-1 text-xs text-ink-2">{p.extra}</p>}
    </section>
  );
}
