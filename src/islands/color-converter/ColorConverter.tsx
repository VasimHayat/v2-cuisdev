/**
 * Color Converter: one smart input that accepts any CSS colour, every representation
 * with copy buttons, live sliders in RGB, HSL or OKLCH, alpha, a WCAG contrast check,
 * OKLCH tints and shades, and harmonies. State round-trips through the URL.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { HeaderButton, Segmented } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import {
  ColorParseError,
  SAMPLE,
  colorToHsl,
  colorToOklch,
  contrast,
  cssColor,
  formatAll,
  gamutMap,
  harmonies,
  hslToColor,
  inGamut,
  num,
  oklchToColor,
  parseColor,
  tintsAndShades,
  toHex,
  toHex8,
  toRgb255,
  type Color,
} from './logic';

const TOOL = 'color-converter';
const PREFS_KEY = 'cuis-color:prefs';
type Model = 'rgb' | 'hsl' | 'oklch';

interface Prefs {
  input: string;
  bg: string;
  model: Model;
}

const DEFAULTS: Prefs = { input: '#3b82f6', bg: '#ffffff', model: 'oklch' };

function loadPrefs(): Prefs {
  const p = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (raw) {
      if (typeof raw.input === 'string') p.input = raw.input;
      if (typeof raw.bg === 'string') p.bg = raw.bg;
      if (raw.model === 'rgb' || raw.model === 'hsl' || raw.model === 'oklch') p.model = raw.model;
    }
  } catch {}
  try {
    const q = new URLSearchParams(location.search);
    const c = q.get('c');
    const bg = q.get('bg');
    const m = q.get('m');
    if (c) p.input = c;
    if (bg) p.bg = bg;
    if (m === 'rgb' || m === 'hsl' || m === 'oklch') p.model = m;
  } catch {}
  return p;
}

function tryParse(text: string): Color | null {
  try {
    return parseColor(text);
  } catch {
    return null;
  }
}

const CHECKER = 'repeating-conic-gradient(#d4d4d8 0 25%, #ffffff 0 50%) 0 0 / 14px 14px';

export default function ColorConverter() {
  /** Query string for Copy link, rebuilt from state; never written to the address bar. */
  const shareQuery = useRef('');
  const initial = useMemo(loadPrefs, []);
  const [input, setInput] = useState(initial.input);
  const [color, setColor] = useState<Color>(() => tryParse(initial.input) ?? parseColor(DEFAULTS.input));
  const [error, setError] = useState<string | null>(null);
  const [bgInput, setBgInput] = useState(initial.bg);
  const [model, setModel] = useState<Model>(initial.model);
  const hueMemo = useRef({ hsl: 0, oklch: 0 });

  const bg = useMemo(() => tryParse(bgInput) ?? { r: 1, g: 1, b: 1, alpha: 1 }, [bgInput]);
  const rows = useMemo(() => formatAll(color), [color]);
  const outOfGamut = !inGamut(color);
  const swatch = cssColor(color);
  const steps = useMemo(() => tintsAndShades(color), [color]);
  const harm = useMemo(() => harmonies(color), [color]);
  const vsBg = contrast(color, bg);
  const vsWhite = contrast(color, { r: 1, g: 1, b: 1, alpha: 1 });
  const vsBlack = contrast(color, { r: 0, g: 0, b: 0, alpha: 1 });

  // Persist and mirror to the URL (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ input, bg: bgInput, model }));
      } catch {}
      try {
        // Not written to the address bar (GA4 history page views); Copy link uses it.
        const q = new URLSearchParams();
        q.set('c', input);
        q.set('bg', bgInput);
        q.set('m', model);
        shareQuery.current = q.toString();
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [input, bgInput, model]);

  const onInput = (text: string) => {
    setInput(text);
    try {
      setColor(parseColor(text));
      setError(null);
    } catch (err) {
      setError(err instanceof ColorParseError ? err.message : 'Not a colour.');
    }
  };

  /** Update the colour from sliders or swatches and write a matching input string. */
  const setFrom = (c: Color, text?: string) => {
    setColor(c);
    setError(null);
    setInput(text ?? (c.alpha < 1 ? toHex8(c) : toHex(c)));
  };

  // Slider values for the active model
  const rgb = toRgb255(color);
  const hsl = colorToHsl(gamutMap(color));
  const lch = colorToOklch(color);
  if (hsl.s > 0.001) hueMemo.current.hsl = hsl.h;
  if (lch.c > 0.001) hueMemo.current.oklch = lch.h;

  const sliders =
    model === 'rgb'
      ? [
          { label: 'Red', min: 0, max: 255, step: 1, value: rgb.r, set: (v: number) => setFrom({ ...color, r: v / 255, g: rgb.g / 255, b: rgb.b / 255 }) },
          { label: 'Green', min: 0, max: 255, step: 1, value: rgb.g, set: (v: number) => setFrom({ ...color, r: rgb.r / 255, g: v / 255, b: rgb.b / 255 }) },
          { label: 'Blue', min: 0, max: 255, step: 1, value: rgb.b, set: (v: number) => setFrom({ ...color, r: rgb.r / 255, g: rgb.g / 255, b: v / 255 }) },
        ]
      : model === 'hsl'
        ? [
            { label: 'Hue', min: 0, max: 360, step: 1, value: Math.round(hsl.s > 0.001 ? hsl.h : hueMemo.current.hsl), set: (v: number) => ((hueMemo.current.hsl = v), setFrom(hslToColor(v, hsl.s, hsl.l, color.alpha))) },
            { label: 'Saturation', min: 0, max: 100, step: 1, value: Math.round(hsl.s * 100), set: (v: number) => setFrom(hslToColor(hueMemo.current.hsl, v / 100, hsl.l, color.alpha)) },
            { label: 'Lightness', min: 0, max: 100, step: 1, value: Math.round(hsl.l * 100), set: (v: number) => setFrom(hslToColor(hueMemo.current.hsl, hsl.s, v / 100, color.alpha)) },
          ]
        : [
            { label: 'Lightness', min: 0, max: 100, step: 0.1, value: Number(num(lch.l * 100, 1)), set: (v: number) => setOklch(v / 100, lch.c, hueMemo.current.oklch) },
            { label: 'Chroma', min: 0, max: 0.4, step: 0.001, value: Number(num(lch.c, 3)), set: (v: number) => setOklch(lch.l, v, hueMemo.current.oklch) },
            { label: 'Hue', min: 0, max: 360, step: 0.5, value: Number(num(lch.c > 0.001 ? lch.h : hueMemo.current.oklch, 1)), set: (v: number) => ((hueMemo.current.oklch = v), setOklch(lch.l, lch.c, v)) },
          ];

  function setOklch(l: number, c: number, h: number) {
    const next = oklchToColor({ l, c, h }, color.alpha);
    const a = color.alpha < 1 ? ` / ${num(color.alpha * 100, 1)}%` : '';
    setFrom(next, `oklch(${num(l * 100, 1)}% ${num(c, 4)} ${num(h, 1)}${a})`);
  }

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', what });
  };

  const reset = () => {
    setModel(DEFAULTS.model);
    setBgInput(DEFAULTS.bg);
    onInput(DEFAULTS.input);
  };

  const swatchText = (c: Color) => (contrast(c, { r: 0, g: 0, b: 0, alpha: 1 }).ratio >= 4.5 ? '#000000' : '#ffffff');

  return (
    <div class="flex flex-col bg-surface-2 text-ink relative min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm">
      {/* Input row */}
      <div class="flex flex-wrap items-center gap-2 px-1 pb-2 pt-1">
        <label class="relative flex min-w-0 flex-1 items-center">
          <span class="absolute left-2 h-6 w-6 overflow-hidden rounded border border-line-strong" style={{ background: CHECKER }} aria-hidden="true">
            <span class="block h-full w-full" style={{ background: swatch }} />
          </span>
          <input
            class={'input h-10 pl-10 font-mono text-[15px] ' + (error ? 'border-danger' : '')}
            value={input}
            onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
            placeholder="#3b82f6, rgb(59 130 246), hsl(217 91% 60%), oklch(62% 0.19 260), rebeccapurple"
            spellcheck={false}
            autocomplete="off"
            aria-label="Colour in any CSS syntax"
            aria-invalid={!!error}
          />
        </label>
        <label class="btn-secondary btn-sm cursor-pointer" title="Pick with the system colour picker">
          <Icon name="eye" size={14} /> Pick
          <input type="color" class="sr-only" value={toHex(color)} onInput={(e) => setFrom({ ...parseColor((e.currentTarget as HTMLInputElement).value), alpha: color.alpha })} aria-label="System colour picker" />
        </label>
        <button type="button" class="btn-ghost btn-sm" onClick={() => onInput(SAMPLE)} title="Load an example">
          <Icon name="sparkles" size={14} /> Sample
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => void copy(`${location.origin}${location.pathname}?${shareQuery.current}`, 'Link')} title="Copy a link to this colour">
          <Icon name="link" size={14} /> Copy link
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Reset to defaults">
          <Icon name="eraser" size={14} /> Reset
        </button>
      </div>
      {error && (
        <p class="mx-1 mb-2 flex items-center gap-1.5 text-xs text-danger" role="alert">
          <Icon name="alert-circle" size={13} class="shrink-0" /> {error} Showing the last valid colour.
        </p>
      )}

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: swatch, sliders, contrast */}
        <div class="flex min-w-0 flex-col gap-2">
          <section class="overflow-hidden rounded-lg border border-line-strong" aria-label="Swatch" style={{ background: CHECKER }}>
            <div class="flex h-24 flex-col justify-between p-3" style={{ background: swatch, color: swatchText(gamutMap(color)) }}>
              <span class="font-mono text-sm font-semibold">{color.alpha < 1 ? toHex8(color) : toHex(color)}</span>
              <span class="text-xs opacity-80">{rows.find((r) => r.id === 'name')?.value}</span>
            </div>
          </section>
          {outOfGamut && (
            <p class="flex items-start gap-1.5 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-ink-2">
              <Icon name="alert-circle" size={13} class="mt-0.5 shrink-0 text-warning" />
              This colour is outside the sRGB gamut most screens show. HEX, RGB, HSL and the swatch use the closest displayable colour (CSS gamut mapping); Lab and OKLCH keep the exact value.
            </p>
          )}

          <section class="rounded-lg border border-line-strong bg-surface p-3" aria-label="Adjust">
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-ink-3">Adjust</span>
              <Segmented
                value={model}
                onChange={setModel}
                options={[
                  { value: 'rgb', label: 'RGB' },
                  { value: 'hsl', label: 'HSL' },
                  { value: 'oklch', label: 'OKLCH' },
                ]}
                label="Slider model"
              />
            </div>
            <div class="space-y-2">
              {sliders.map((s) => (
                <Slider key={`${model}-${s.label}`} {...s} />
              ))}
              <Slider label="Alpha" min={0} max={100} step={1} value={Math.round(color.alpha * 100)} set={(v) => setFrom({ ...color, alpha: v / 100 })} unit="%" />
            </div>
          </section>

          <section class="rounded-lg border border-line-strong bg-surface p-3" aria-label="Contrast">
            <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Contrast (WCAG 2)</div>
            <div class="flex items-center gap-2">
              <span class="h-8 w-8 shrink-0 rounded border border-line-strong" style={{ background: cssColor(bg) }} aria-hidden="true" />
              <input class="input h-8 flex-1 font-mono text-xs" value={bgInput} onInput={(e) => setBgInput((e.currentTarget as HTMLInputElement).value)} aria-label="Second colour" spellcheck={false} />
              <HeaderButton icon="arrow-left-right" title="Swap the two colours" onClick={() => {
                const a = input;
                onInput(bgInput);
                setBgInput(a);
              }} />
            </div>
            <div class="mt-2 rounded-md border border-line px-3 py-2" style={{ background: cssColor(bg), color: toHex(color) }}>
              <p class="text-base font-semibold">The quick brown fox <span class="text-sm font-normal">jumps over the lazy dog.</span></p>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
              <span class="font-mono text-sm font-semibold">{num(vsBg.ratio, 2)}:1</span>
              <Badge ok={vsBg.grade.aa} label="AA" />
              <Badge ok={vsBg.grade.aaLarge} label="AA large" />
              <Badge ok={vsBg.grade.aaa} label="AAA" />
              <Badge ok={vsBg.ratio >= 4.5} label="AAA large" />
            </div>
            <p class="mt-2 text-xs text-ink-3">
              On white {num(vsWhite.ratio, 2)}:1 · on black {num(vsBlack.ratio, 2)}:1. Alpha is ignored for contrast.
            </p>
          </section>
        </div>

        {/* Right: formats, palettes */}
        <div class="flex min-w-0 flex-col gap-2">
          <section class="overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Formats">
            <header class="flex h-9 items-center border-b border-line bg-surface-2 px-3 text-xs">
              <span class="font-semibold text-ink">Formats</span>
              <span class="flex-1" />
              <button type="button" class="btn-ghost btn-sm h-7 text-xs" onClick={() => void copy(rows.map((r) => `${r.label}: ${r.value}`).join('\n'), 'All formats')}>
                <Icon name="copy" size={13} /> Copy all
              </button>
            </header>
            <table class="w-full text-left text-[13px]">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} class="border-b border-line last:border-b-0">
                    <th scope="row" class="w-28 px-3 py-1 align-middle text-xs font-medium text-ink-2">
                      {r.note ? (
                        <abbr class="cursor-help no-underline decoration-dotted hover:underline" title={r.note}>
                          {r.label}
                        </abbr>
                      ) : (
                        r.label
                      )}
                    </th>
                    <td class="min-w-0 break-all py-1 pr-1 align-middle font-mono text-xs text-ink">{r.value}</td>
                    <td class="w-8 py-0.5 pr-1 align-middle">
                      <HeaderButton icon="copy" title={`Copy ${r.label}`} onClick={() => void copy(r.value, r.label)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section class="rounded-lg border border-line-strong bg-surface p-3" aria-label="Tints and shades">
            <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Tints and shades (OKLCH lightness)</div>
            <div class="grid grid-cols-10 gap-1">
              {steps.map((c, i) => (
                <Swatch key={i} color={c} onPick={() => setFrom(c)} label={`Step ${(i + 1) * 100 - 50}`} />
              ))}
            </div>
          </section>

          <section class="rounded-lg border border-line-strong bg-surface p-3" aria-label="Harmonies">
            <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Harmonies</div>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2 xl:grid-cols-4">
              {harm.map((h) => (
                <div key={h.name} class="min-w-0">
                  <div class="mb-1 text-xs text-ink-2">{h.name}</div>
                  <div class="flex gap-1">
                    {h.colors.map((c, i) => (
                      <Swatch key={i} color={c} onPick={() => setFrom(c)} label={`${h.name} ${i + 1}`} wide />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Click any swatch to make it the current colour. Conversions follow CSS Color 4 and run in your browser.</span>
        <button type="button" class="btn-ghost btn-sm h-7 shrink-0 text-xs" onClick={() => void copy(toHex(color), 'HEX')} title="Copy the HEX value">
          <Icon name="copy" size={13} /> Copy HEX
        </button>
      </div>
    </div>
  );
}

function Slider(p: { label: string; min: number; max: number; step: number; value: number; set: (v: number) => void; unit?: string }) {
  return (
    <label class="grid grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs text-ink-2">
      <span>{p.label}</span>
      <input type="range" class="w-full accent-brand-600" min={p.min} max={p.max} step={p.step} value={p.value} onInput={(e) => p.set(Number((e.currentTarget as HTMLInputElement).value))} aria-label={p.label} />
      <input
        type="number"
        class="input h-7 px-1.5 text-right font-mono text-xs"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onChange={(e) => {
          const v = Number((e.currentTarget as HTMLInputElement).value);
          if (Number.isFinite(v)) p.set(Math.min(p.max, Math.max(p.min, v)));
        }}
        aria-label={`${p.label} value${p.unit ? ` in ${p.unit}` : ''}`}
      />
    </label>
  );
}

function Swatch({ color, onPick, label, wide }: { color: Color; onPick: () => void; label: string; wide?: boolean }) {
  const hex = toHex(color);
  return (
    <button
      type="button"
      class={'h-9 rounded border border-line-strong transition-transform hover:scale-105 focus-visible:scale-105 ' + (wide ? 'flex-1' : 'w-full')}
      style={{ background: hex }}
      title={`${label}: ${hex}`}
      aria-label={`${label}, ${hex}`}
      onClick={onPick}
    />
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return <span class={'badge ' + (ok ? 'border-success/40 bg-success/10 text-success' : 'border-danger/40 bg-danger/10 text-danger')}>{ok ? '✓' : '✗'} {label}</span>;
}
