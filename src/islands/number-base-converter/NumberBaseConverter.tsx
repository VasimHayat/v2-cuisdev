/**
 * Number Base Converter: binary, octal, decimal, hexadecimal and a custom base 2 to 36,
 * all editable and kept in sync with BigInt precision. Signed mode shows two's
 * complement at 8 to 128 bits; a bit grid toggles individual bits; fractions convert
 * exactly with repeating digits marked. State round-trips through the URL.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import {
  BIT_WIDTHS,
  BaseError,
  SAMPLE,
  ZERO,
  baseName,
  bitLength,
  bitsOf,
  byteLength,
  deserialize,
  isInteger,
  rangeWarning,
  readInput,
  renderField,
  serialize,
  signedRange,
  toggleBit,
  unsignedMax,
  type BitWidth,
  type ConvertOptions,
  type Value,
} from './logic';

const TOOL = 'number-base-converter';
const PREFS_KEY = 'cuis-base:prefs';

interface Prefs {
  value: string;
  custom: number;
  signed: boolean;
  width: BitWidth;
  group: boolean;
  uppercase: boolean;
  prefix: boolean;
}

const DEFAULTS: Prefs = { value: SAMPLE, custom: 36, signed: false, width: 32, group: true, uppercase: true, prefix: false };

function loadPrefs(): Prefs {
  const p = { ...DEFAULTS };
  const apply = (raw: Record<string, unknown>) => {
    if (typeof raw.value === 'string' && deserialize(raw.value)) p.value = raw.value;
    const custom = Number(raw.custom);
    if (Number.isInteger(custom) && custom >= 2 && custom <= 36) p.custom = custom;
    const width = Number(raw.width);
    if ((BIT_WIDTHS as readonly number[]).includes(width)) p.width = width as BitWidth;
    for (const k of ['signed', 'group', 'uppercase', 'prefix'] as const) {
      const v = raw[k];
      if (typeof v === 'boolean') p[k] = v;
      else if (v === '1' || v === '0') p[k] = v === '1';
    }
  };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Record<string, unknown> | null;
    if (raw) apply(raw);
  } catch {}
  try {
    const q = new URLSearchParams(location.search);
    const fromUrl: Record<string, unknown> = {};
    const map: Record<string, string> = { v: 'value', b: 'custom', w: 'width', signed: 'signed', g: 'group', u: 'uppercase', p: 'prefix' };
    for (const [k, name] of Object.entries(map)) {
      const val = q.get(k);
      if (val !== null) fromUrl[name] = val;
    }
    apply(fromUrl);
  } catch {}
  return p;
}

type FieldId = 'bin' | 'oct' | 'dec' | 'hex' | 'custom';

interface FieldError {
  id: FieldId;
  message: string;
  position?: number;
}

export default function NumberBaseConverter() {
  /** Query string for Copy link, rebuilt from state; never written to the address bar. */
  const shareQuery = useRef('');
  const initial = useMemo(loadPrefs, []);
  const [value, setValue] = useState<Value>(() => deserialize(initial.value) ?? ZERO);
  const [custom, setCustom] = useState(initial.custom);
  const [signed, setSigned] = useState(initial.signed);
  const [width, setWidth] = useState<BitWidth>(initial.width);
  const [group, setGroup] = useState(initial.group);
  const [uppercase, setUppercase] = useState(initial.uppercase);
  const [prefix, setPrefix] = useState(initial.prefix);
  /** The field being typed in keeps its raw text so the caret and formatting are not disturbed. */
  const [editing, setEditing] = useState<{ id: FieldId; text: string } | null>(null);
  const [error, setError] = useState<FieldError | null>(null);

  const options: ConvertOptions = { signed, width, group, uppercase, prefix };
  const fields: { id: FieldId; base: number; rows: number }[] = [
    { id: 'bin', base: 2, rows: 2 },
    { id: 'oct', base: 8, rows: 1 },
    { id: 'dec', base: 10, rows: 1 },
    { id: 'hex', base: 16, rows: 1 },
    { id: 'custom', base: custom, rows: 1 },
  ];

  // Persist and mirror to the URL (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const prefs = { value: serialize(value), custom, signed, width, group, uppercase, prefix };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      } catch {}
      try {
        // Not written to the address bar (GA4 history page views); Copy link uses it.
        const q = new URLSearchParams();
        q.set('v', prefs.value);
        q.set('b', String(custom));
        q.set('w', String(width));
        q.set('signed', signed ? '1' : '0');
        q.set('g', group ? '1' : '0');
        q.set('u', uppercase ? '1' : '0');
        q.set('p', prefix ? '1' : '0');
        shareQuery.current = q.toString();
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [value, custom, signed, width, group, uppercase, prefix]);

  const display = (id: FieldId, base: number): { text: string; repeats: boolean; truncated: boolean } => {
    if (editing?.id === id) return { text: editing.text, repeats: false, truncated: false };
    try {
      return renderField(value, base, options);
    } catch {
      // Signed rendering failed (value out of range): fall back to a plain signed value.
      return renderField(value, base, { ...options, signed: false });
    }
  };

  const onType = (id: FieldId, base: number, text: string) => {
    setEditing({ id, text });
    if (text.trim() === '' || text.trim() === '-') {
      setError(null);
      return;
    }
    try {
      setValue(readInput(text, base, { signed, width }));
      setError(null);
    } catch (err) {
      setError({ id, message: err instanceof Error ? err.message : String(err), position: err instanceof BaseError ? err.position : undefined });
    }
  };

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', what });
  };

  const reset = () => {
    setValue(deserialize(DEFAULTS.value)!);
    setCustom(DEFAULTS.custom);
    setSigned(DEFAULTS.signed);
    setWidth(DEFAULTS.width);
    setGroup(DEFAULTS.group);
    setUppercase(DEFAULTS.uppercase);
    setPrefix(DEFAULTS.prefix);
    setEditing(null);
    setError(null);
  };

  const warning = rangeWarning(value, { signed, width });
  const gridWidth = Math.min(width, 64);
  const bits = bitsOf(value, gridWidth, signed);
  const intValue = isInteger(value) ? value.num : value.num / value.den;
  const range = signed ? signedRange(width) : { min: 0n, max: unsignedMax(width) };
  const fraction = !isInteger(value);
  const repeating = fields.map((f) => display(f.id, f.base)).find((d) => d.repeats);

  return (
    <div class="flex flex-col bg-surface-2 text-ink relative min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2 pt-1">
        <Chip on={signed} onClick={() => setSigned((s) => !s)} title="Interpret binary, octal and hex as two's complement at the chosen width">
          Signed
        </Chip>
        <Segmented value={String(width) as `${BitWidth}`} onChange={(v) => setWidth(Number(v) as BitWidth)} options={BIT_WIDTHS.map((w) => ({ value: String(w) as `${BitWidth}`, label: `${w}` }))} label="Bit width" />
        <Chip on={group} onClick={() => setGroup((g) => !g)} title="Group digits: 4 for binary and hex, 3 for octal and decimal">
          Group
        </Chip>
        <Chip on={uppercase} onClick={() => setUppercase((u) => !u)} title="Uppercase hex letters">
          Uppercase
        </Chip>
        <Chip on={prefix} onClick={() => setPrefix((p) => !p)} title="Show 0b, 0o and 0x prefixes">
          Prefixes
        </Chip>
        <span class="flex-1" />
        <button type="button" class="btn-ghost btn-sm" onClick={() => (setEditing(null), setError(null), setValue(deserialize(SAMPLE)!))} title="Load an example">
          <Icon name="sparkles" size={14} /> Sample
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => void copy(`${location.origin}${location.pathname}?${shareQuery.current}`, 'Link')} title="Copy a link to this number">
          <Icon name="link" size={14} /> Copy link
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Reset to defaults">
          <Icon name="eraser" size={14} /> Reset
        </button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Fields */}
        <div class="flex min-w-0 flex-col gap-2">
          {fields.map((f) => {
            const d = display(f.id, f.base);
            const err = error?.id === f.id ? error : null;
            return (
              <section key={f.id} class={'rounded-lg border bg-surface ' + (err ? 'border-danger/60' : 'border-line-strong')} aria-label={baseName(f.base)}>
                <header class="flex h-9 items-center gap-2 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
                  {f.id === 'custom' ? (
                    <label class="flex items-center gap-1.5 font-semibold text-ink">
                      Base
                      <select
                        class="select h-7 w-auto py-0 text-xs"
                        value={String(custom)}
                        onChange={(e) => {
                          setCustom(Number((e.currentTarget as HTMLSelectElement).value));
                          if (editing?.id === 'custom') setEditing(null);
                        }}
                        aria-label="Custom base"
                      >
                        {Array.from({ length: 35 }, (_, i) => i + 2).map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span class="font-semibold text-ink">
                      {baseName(f.base)} <span class="font-normal text-ink-3">base {f.base}</span>
                    </span>
                  )}
                  {d.repeats && <span class="badge border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-200">repeats</span>}
                  {d.truncated && <span class="badge border-line-strong text-ink-3">rounded</span>}
                  <span class="flex-1" />
                  <HeaderButton icon="copy" title={`Copy ${baseName(f.base).toLowerCase()}`} onClick={() => void copy(display(f.id, f.base).text, baseName(f.base))} />
                </header>
                <textarea
                  class="block w-full resize-none bg-transparent px-3 py-2 font-mono text-[15px] leading-6 text-ink outline-none [overflow-wrap:anywhere] focus-visible:ring-0"
                  rows={f.rows}
                  value={d.text}
                  spellcheck={false}
                  autocomplete="off"
                  onFocus={() => setEditing({ id: f.id, text: display(f.id, f.base).text })}
                  onBlur={() => !error && setEditing(null)}
                  onInput={(e) => onType(f.id, f.base, (e.currentTarget as HTMLTextAreaElement).value)}
                  onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                  aria-label={`${baseName(f.base)} value`}
                  aria-invalid={!!err}
                />
                {err && (
                  <div class="border-t border-danger/30 px-3 py-1.5 text-xs text-danger" role="alert">
                    {err.position !== undefined && editing?.id === f.id && (
                      <div class="mb-0.5 break-all font-mono text-ink-2">
                        {editing.text.slice(0, err.position)}
                        <mark class="rounded-sm bg-danger/30 px-px text-danger">{editing.text[err.position]}</mark>
                        {editing.text.slice(err.position + 1)}
                      </div>
                    )}
                    {err.message}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Bits and facts */}
        <div class="flex min-w-0 flex-col gap-2">
          <section class="rounded-lg border border-line-strong bg-surface p-3" aria-label="Bits">
            <div class="mb-2 flex items-center justify-between text-xs">
              <span class="font-semibold uppercase tracking-wide text-ink-3">Bits ({gridWidth}{width > 64 ? ' of 128 shown' : ''})</span>
              <span class="text-ink-3">Click a bit to flip it</span>
            </div>
            {bits ? (
              <div class="grid grid-cols-8 gap-x-1 gap-y-2 font-mono text-xs">
                {bits.map((b, i) => (
                  <button
                    key={i}
                    type="button"
                    class={
                      'flex h-8 flex-col items-center justify-center rounded border transition-colors ' +
                      (b ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink-3 hover:bg-surface-3') +
                      (i % 8 === 0 ? ' ' : '')
                    }
                    onClick={() => {
                      setEditing(null);
                      setError(null);
                      setValue(toggleBit(value, i, gridWidth, signed));
                    }}
                    aria-pressed={b}
                    aria-label={`Bit ${gridWidth - 1 - i}, ${b ? 'on' : 'off'}`}
                    title={`Bit ${gridWidth - 1 - i}${signed && i === 0 ? ' (sign bit)' : ''}`}
                  >
                    <span class="text-[13px] leading-none">{b ? 1 : 0}</span>
                    <span class={'text-[9px] leading-none ' + (b ? 'text-white/70' : 'text-ink-3/70')}>{gridWidth - 1 - i}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p class="text-xs text-ink-3">
                {fraction
                  ? 'The bit view shows whole numbers only.'
                  : value.num < 0n && !signed
                    ? 'Negative numbers need Signed mode to show a bit pattern.'
                    : `The value needs more than ${gridWidth} bits. Choose a wider width.`}
              </p>
            )}
          </section>

          <section class="rounded-lg border border-line-strong bg-surface p-3 text-xs" aria-label="Details">
            <div class="mb-2 font-semibold uppercase tracking-wide text-ink-3">Details</div>
            <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              <dt class="text-ink-3">Bit length</dt>
              <dd class="font-mono text-ink">{bitLength(intValue)} {bitLength(intValue) === 1 ? 'bit' : 'bits'}</dd>
              <dt class="text-ink-3">Byte length</dt>
              <dd class="font-mono text-ink">{byteLength(intValue)} {byteLength(intValue) === 1 ? 'byte' : 'bytes'}</dd>
              <dt class="text-ink-3">{signed ? `Signed ${width}-bit range` : `Unsigned ${width}-bit range`}</dt>
              <dd class="break-all font-mono text-ink">
                {range.min.toString()} to {range.max.toString()}
              </dd>
              {fraction && (
                <>
                  <dt class="text-ink-3">Exact value</dt>
                  <dd class="break-all font-mono text-ink">
                    {value.num.toString()} / {value.den.toString()}
                  </dd>
                </>
              )}
            </dl>
            {warning && (
              <p class="mt-2 flex items-start gap-1.5 rounded-md border border-warning/50 bg-warning/10 p-2 text-ink-2">
                <Icon name="alert-circle" size={13} class="mt-0.5 shrink-0 text-warning" /> {warning}
              </p>
            )}
            {repeating && (
              <p class="mt-2 text-ink-2">
                Digits in parentheses repeat forever. For example 0.1 in decimal is 0.0(0011) in binary, which is why 0.1 + 0.2 is not exactly 0.3 in floating point.
              </p>
            )}
          </section>
        </div>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Type in any field. Underscores, spaces and 0b, 0o or 0x prefixes are accepted. Exact for numbers of any size.</span>
      </div>
    </div>
  );
}
