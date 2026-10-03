/**
 * Unit Converter: pick a category (or search any unit), type a value or an expression
 * such as "5 ft 11 in", and see the result, the rule in words and the value in every
 * unit of the category. State lives in the URL so a conversion can be shared.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { HeaderButton } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import {
  CATEGORIES,
  UnitError,
  convert,
  defaultState,
  describeFormula,
  formatNumber,
  getCategory,
  getUnit,
  groupDigits,
  parseQuantity,
  queryToState,
  sanitizeState,
  search,
  splitScientific,
  stateToQuery,
  type CategoryId,
  type ConverterState,
  type Precision,
  type SearchHit,
} from './logic';

const TOOL = 'unit-converter';
const PREFS_KEY = 'cuis-units:prefs';
const PRECISIONS: { value: Precision; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 3, label: '3 digits' },
  { value: 4, label: '4 digits' },
  { value: 6, label: '6 digits' },
  { value: 8, label: '8 digits' },
  { value: 12, label: '12 digits' },
  { value: 15, label: '15 digits' },
];

interface Stored {
  state: ConverterState;
  pairs: Partial<Record<CategoryId, [string, string]>>;
}

function loadStored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Stored> | null;
    if (raw && typeof raw === 'object') return { state: sanitizeState(raw.state ?? null), pairs: raw.pairs && typeof raw.pairs === 'object' ? raw.pairs : {} };
  } catch {}
  return { state: defaultState(), pairs: {} };
}

function initialState(): { state: ConverterState; pairs: Stored['pairs'] } {
  const stored = loadStored();
  try {
    const fromUrl = queryToState(window.location.search);
    if (fromUrl) return { state: fromUrl, pairs: stored.pairs };
  } catch {}
  return stored;
}

/** Display form: grouped digits, or mantissa × 10^exp for scientific values. */
function Num({ text, class: cls = '' }: { text: string; class?: string }) {
  const sci = splitScientific(text);
  if (sci)
    return (
      <span class={cls}>
        {sci.mantissa} × 10<sup class="text-[0.65em]">{sci.exponent}</sup>
      </span>
    );
  return <span class={cls}>{groupDigits(text)}</span>;
}

export default function UnitConverter() {
  const init = useMemo(initialState, []);
  const [state, setState] = useState<ConverterState>(init.state);
  const [pairs, setPairs] = useState<Stored['pairs']>(init.pairs);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [hitIndex, setHitIndex] = useState(0);
  const valueRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const category = getCategory(state.category) ?? CATEGORIES[0]!;
  const from = getUnit(category, state.from) ?? category.units[0]!;
  const to = getUnit(category, state.to) ?? category.units[1]!;

  const update = (patch: Partial<ConverterState>) => setState((s) => sanitizeState({ ...s, ...patch }));

  // Inputs never go into the address bar while editing: GA4's history-change page views
  // would record them. Copy link builds a share URL from state on demand.
  useEffect(() => {
    const nextPairs = { ...pairs, [state.category]: [state.from, state.to] as [string, string] };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ state, pairs: nextPairs }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Parse and convert
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, ...parseQuantity(state.input, category, from) };
    } catch (err) {
      return { ok: false as const, error: err instanceof UnitError ? err.message : 'Could not read that value.' };
    }
  }, [state.input, category, from]);

  const result = parsed.ok ? convert(parsed.value, from, to) : NaN;
  const resultText = formatNumber(result, state.precision);
  const formula = describeFormula(category, from, to);
  const hits: SearchHit[] = useMemo(() => search(query), [query]);

  // ------------------------------------------------------------------ actions

  const chooseCategory = (id: CategoryId) => {
    if (id === state.category) return;
    const c = getCategory(id)!;
    setPairs((p) => ({ ...p, [state.category]: [state.from, state.to] }));
    const pair = pairs[id] ?? c.defaults;
    update({ category: id, from: pair[0], to: pair[1] });
  };

  const pickHit = (hit: SearchHit | undefined) => {
    if (!hit) return;
    setPairs((p) => ({ ...p, [state.category]: [state.from, state.to] }));
    if (hit.unit) {
      const pair = hit.category.id === state.category ? [state.from, state.to] : (pairs[hit.category.id] ?? hit.category.defaults);
      const newFrom = hit.unit.id;
      let newTo = pair[1]!;
      if (newTo === newFrom) newTo = pair[0] !== newFrom ? pair[0]! : (hit.category.units.find((x) => x.id !== newFrom)?.id ?? newTo);
      update({ category: hit.category.id, from: newFrom, to: newTo });
    } else {
      const pair = pairs[hit.category.id] ?? hit.category.defaults;
      update({ category: hit.category.id, from: pair[0], to: pair[1] });
    }
    setQuery('');
    setSearchOpen(false);
    track('tool_action', { tool: TOOL, action: 'search_pick', category: hit.category.id });
    requestAnimationFrame(() => valueRef.current?.focus());
  };

  const swap = () => {
    update({ from: state.to, to: state.from, input: parsed.ok && !Number.isNaN(result) && Number.isFinite(result) ? formatNumber(result, 'auto') : state.input });
    track('tool_action', { tool: TOOL, action: 'swap' });
  };

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', what });
  };

  const copyLink = () => void copy(`${window.location.origin}${window.location.pathname}${stateToQuery(state)}`, 'Link');

  // "/" focuses the search box, like many sites
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !t.matches?.('input, select, textarea, [contenteditable]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div class={'flex flex-col bg-surface-2 text-ink ' + 'relative min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm'}>
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-2 px-1 pb-2 pt-1">
        <div class="relative min-w-0 flex-1 sm:max-w-sm">
          <Icon name="search" size={15} class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            ref={searchRef}
            class="input h-9 pl-8"
            placeholder="Search units, e.g. psi, cups, mph"
            value={query}
            onInput={(e) => {
              setQuery((e.currentTarget as HTMLInputElement).value);
              setSearchOpen(true);
              setHitIndex(0);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHitIndex((i) => Math.min(hits.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHitIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                pickHit(hits[hitIndex]);
              } else if (e.key === 'Escape') {
                setQuery('');
                setSearchOpen(false);
              }
            }}
            role="combobox"
            aria-expanded={searchOpen && hits.length > 0}
            aria-controls="unit-search-results"
            aria-label="Search units"
            autocomplete="off"
            spellcheck={false}
          />
          {searchOpen && query.trim() !== '' && (
            <ul id="unit-search-results" role="listbox" class="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border border-line-strong bg-surface p-1 shadow-float">
              {hits.length === 0 ? (
                <li class="px-2 py-1.5 text-xs text-ink-3">No unit matches "{query}".</li>
              ) : (
                hits.map((h, i) => (
                  <li
                    key={`${h.category.id}-${h.unit?.id ?? 'cat'}`}
                    role="option"
                    aria-selected={i === hitIndex}
                    class={'flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-sm ' + (i === hitIndex ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200' : 'hover:bg-surface-3')}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickHit(h);
                    }}
                    onMouseEnter={() => setHitIndex(i)}
                  >
                    <span class="min-w-0 truncate">{h.unit ? `${h.unit.name} (${h.unit.symbol})` : h.category.name}</span>
                    <span class="shrink-0 text-xs text-ink-3">{h.unit ? h.category.name : 'Category'}</span>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
        <span class="flex-1" />
        <button type="button" class="btn-secondary btn-sm" onClick={copyLink} title="Copy a link to this conversion">
          <Icon name="link" size={14} /> Copy link
        </button>
      </div>

      {/* Categories */}
      <div class="flex flex-wrap gap-1 px-1 pb-2" role="radiogroup" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={c.id === category.id}
            class={
              'h-7 rounded-md border px-2.5 text-xs font-medium transition-colors ' +
              (c.id === category.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink')
            }
            onClick={() => chooseCategory(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* Main */}
      <div class="grid flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section class="flex min-w-0 flex-col gap-3 rounded-lg border border-line-strong bg-surface p-3" aria-label="Convert">
          <div>
            <label class="text-xs font-medium text-ink-2" for="unit-from-value">
              From
            </label>
            <div class="mt-1 flex gap-2">
              <input
                id="unit-from-value"
                ref={valueRef}
                class={'input h-11 min-w-0 flex-1 font-mono text-lg ' + (!parsed.ok ? 'border-danger' : '')}
                value={state.input}
                inputMode="decimal"
                onInput={(e) => update({ input: (e.currentTarget as HTMLInputElement).value })}
                aria-invalid={!parsed.ok}
                aria-describedby="unit-parse-note"
                spellcheck={false}
                autocomplete="off"
              />
              <select class="select h-11 w-[42%] min-w-0 text-sm" value={from.id} onChange={(e) => update({ from: (e.currentTarget as HTMLSelectElement).value })} aria-label="From unit">
                {category.units.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.symbol})
                  </option>
                ))}
              </select>
            </div>
            <p id="unit-parse-note" class={'mt-1 min-h-4 text-xs ' + (parsed.ok ? 'text-ink-3' : 'text-danger')}>
              {!parsed.ok
                ? parsed.error
                : parsed.parts.length > 0
                  ? `Read as ${parsed.parts.map((p) => `${groupDigits(formatNumber(p.value))} ${p.unit.symbol}`).join(' + ')} = ${groupDigits(formatNumber(parsed.value))} ${from.symbol}`
                  : 'Type a number, or an expression such as 5 ft 11 in or 1 h 30 min.'}
            </p>
          </div>

          <div class="flex items-center gap-2">
            <span class="h-px flex-1 bg-line" />
            <button type="button" class="btn-secondary btn-sm" onClick={swap} title="Swap From and To">
              <Icon name="arrow-down" size={14} />
              <Icon name="arrow-up" size={14} class="-ml-2" /> Swap
            </button>
            <span class="h-px flex-1 bg-line" />
          </div>

          <div>
            <label class="text-xs font-medium text-ink-2" for="unit-to">
              To
            </label>
            <select id="unit-to" class="select mt-1 h-11 text-sm" value={to.id} onChange={(e) => update({ to: (e.currentTarget as HTMLSelectElement).value })}>
              {category.units.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} ({x.symbol})
                </option>
              ))}
            </select>
          </div>

          <div class="rounded-lg border border-brand-200 bg-brand-50/60 p-3 dark:border-brand-800 dark:bg-brand-900/20" aria-live="polite">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-xs text-ink-2">
                  {parsed.ok ? (
                    <>
                      <Num text={formatNumber(parsed.value, state.precision)} /> {from.symbol} =
                    </>
                  ) : (
                    'Result'
                  )}
                </div>
                <div class="mt-0.5 break-all font-mono text-2xl font-semibold text-ink">
                  {parsed.ok ? (
                    <>
                      <Num text={resultText} /> <span class="text-lg font-medium text-ink-2">{to.symbol}</span>
                    </>
                  ) : (
                    <span class="text-ink-3">–</span>
                  )}
                </div>
              </div>
              <HeaderButton icon="copy" title="Copy the result" onClick={() => void copy(resultText, 'Result')} disabled={!parsed.ok || resultText === ''} />
            </div>
            <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p class="min-w-0 text-xs text-ink-2">
                {formula.split(/(-?\d+(?:\.\d+)?e[-+]?\d+)/).map((part, i) => (i % 2 === 1 ? <Num key={i} text={part.replace('e+', 'e')} /> : part))}
              </p>
              <label class="flex shrink-0 items-center gap-1.5 text-xs text-ink-2">
                Precision
                <select
                  class="select h-7 w-auto py-0 text-xs"
                  value={String(state.precision)}
                  onChange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    update({ precision: v === 'auto' ? 'auto' : Number(v) });
                  }}
                  aria-label="Precision"
                >
                  {PRECISIONS.map((p) => (
                    <option key={String(p.value)} value={String(p.value)}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label={`${category.name} in every unit`}>
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 text-xs">
            <span class="font-semibold text-ink">{category.name} in every unit</span>
            <span class="text-ink-3">{category.units.length} units</span>
          </header>
          <div class="scrollbar-thin max-h-[420px] min-h-0 overflow-y-auto lg:max-h-[440px]">
            <table class="w-full text-left text-sm">
              <tbody>
                {category.units.map((x) => {
                  const v = parsed.ok ? convert(parsed.value, from, x) : NaN;
                  const text = formatNumber(v, state.precision);
                  const isTo = x.id === to.id;
                  const isFrom = x.id === from.id;
                  return (
                    <tr
                      key={x.id}
                      class={'group cursor-pointer border-b border-line last:border-b-0 ' + (isTo ? 'bg-brand-50/70 dark:bg-brand-900/25' : 'hover:bg-surface-2')}
                      onClick={() => !isFrom && update({ to: x.id })}
                      title={isFrom ? 'This is the From unit' : `Convert to ${x.name}`}
                    >
                      <td class="w-[46%] px-3 py-1.5">
                        <div class="truncate text-ink">{x.name}</div>
                        <div class="text-xs text-ink-3">
                          {x.symbol}
                          {isFrom && <span class="ml-1.5 badge border-line-strong text-ink-3">from</span>}
                        </div>
                      </td>
                      <td class="px-2 py-1.5 text-right font-mono text-[13px] text-ink">{parsed.ok ? <Num text={text} /> : '–'}</td>
                      <td class="w-9 pr-1.5 text-right">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <HeaderButton icon="copy" title={`Copy the value in ${x.name}`} onClick={() => void copy(text, x.name)} disabled={!parsed.ok || text === ''} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Exact definitions: 1 in = 2.54 cm, 1 lb = 0.45359237 kg, 1 US gal = 3.785411784 L. Calculated in your browser.</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">/</span> search units
        </span>
      </div>
    </div>
  );
}
