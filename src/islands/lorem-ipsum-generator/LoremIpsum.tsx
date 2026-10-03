/**
 * Lorem Ipsum Generator workspace: options on the left, generated text on the right.
 * Output is reproducible from the visible seed; Reroll picks a new one.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  DEFAULT_OPTIONS,
  FLAVOURS,
  FORMAT_EXTENSIONS,
  FORMAT_MIME_TYPES,
  LOREM_FORMATS,
  LOREM_UNITS,
  LoremError,
  MAX_COUNT,
  VOCABULARIES,
  generateLorem,
  randomSeed,
  type Flavour,
  type LoremFormat,
  type LoremOptions,
  type LoremUnit,
} from './logic';

const TOOL = 'lorem-ipsum-generator';
const PREFS_KEY = 'cuis-lorem:prefs';
const UNIT_LABELS: Record<LoremUnit, string> = { paragraphs: 'Paragraphs', sentences: 'Sentences', words: 'Words', list: 'List items' };
const FORMAT_LABELS: Record<LoremFormat, string> = { plain: 'Plain text', html: 'HTML', markdown: 'Markdown' };

function loadOptions(): LoremOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<LoremOptions> | null;
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_OPTIONS, seed: randomSeed() };
    const o: LoremOptions = { ...DEFAULT_OPTIONS, seed: randomSeed() };
    if (LOREM_UNITS.includes(raw.unit as LoremUnit)) o.unit = raw.unit as LoremUnit;
    if (LOREM_FORMATS.includes(raw.format as LoremFormat)) o.format = raw.format as LoremFormat;
    if (FLAVOURS.includes(raw.flavour as Flavour)) o.flavour = raw.flavour as Flavour;
    if (typeof raw.count === 'number' && raw.count >= 1 && raw.count <= MAX_COUNT) o.count = Math.round(raw.count);
    if (typeof raw.startWithLorem === 'boolean') o.startWithLorem = raw.startWithLorem;
    if (raw.sentenceLength && typeof raw.sentenceLength.min === 'number' && typeof raw.sentenceLength.max === 'number') o.sentenceLength = { ...raw.sentenceLength };
    if (raw.paragraphLength && typeof raw.paragraphLength.min === 'number' && typeof raw.paragraphLength.max === 'number') o.paragraphLength = { ...raw.paragraphLength };
    if (typeof raw.seed === 'number' && Number.isFinite(raw.seed)) o.seed = raw.seed;
    return o;
  } catch {
    return { ...DEFAULT_OPTIONS, seed: randomSeed() };
  }
}

export default function LoremIpsum() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [opts, setOpts] = useState<LoremOptions>(loadOptions);
  const [wrap, setWrap] = useState(true);
  const [full, setFull] = useState(false);
  const update = (patch: Partial<LoremOptions>) => setOpts((o) => ({ ...o, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(opts));
    } catch {}
  }, [opts]);

  const result = useMemo(() => {
    try {
      return { ok: true as const, value: generateLorem(opts) };
    } catch (err) {
      return { ok: false as const, error: err instanceof LoremError ? err.message : String(err) };
    }
  }, [opts]);

  const output = result.ok ? result.value.output : '';

  const reroll = () => {
    update({ seed: randomSeed() });
    track('tool_action', { tool: TOOL, action: 'reroll' });
  };
  const copy = async () => {
    if (!output) return;
    const ok = await copyText(output);
    toast(ok ? 'Text copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', unit: opts.unit, format: opts.format });
  };
  const download = () => {
    if (!output) return;
    downloadText(output, `lorem-ipsum.${FORMAT_EXTENSIONS[opts.format]}`, FORMAT_MIME_TYPES[opts.format]);
    track('tool_action', { tool: TOOL, action: 'download' });
  };
  const reset = () => setOpts({ ...DEFAULT_OPTIONS, seed: randomSeed() });

  // Keyboard: Ctrl/Cmd+Enter rerolls, Ctrl/Cmd+Shift+C copies, Escape leaves full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        reroll();
      } else if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copy();
      } else if (e.key === 'Escape' && full) setFull(false);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    document.body.style.overflow = full ? 'hidden' : '';
    const el = rootRef.current;
    if (full && el && document.fullscreenEnabled && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    else if (!full && el && document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    return () => {
      document.body.style.overflow = '';
    };
  }, [full]);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const showSentenceRange = opts.unit !== 'words';
  const showParagraphRange = opts.unit === 'paragraphs';

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      class={
        'flex flex-col bg-surface-2 text-ink outline-none ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented value={opts.unit} onChange={(unit) => update({ unit })} options={LOREM_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }))} label="Generate" />
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-primary btn-sm" onClick={reroll} title="Generate new text with a fresh seed (Ctrl+Enter)">
            <Icon name="sparkles" size={14} /> Generate
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Reset every option">
            <Icon name="eraser" size={14} /> Reset
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* Options */}
        <aside class="scrollbar-thin flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3 text-sm max-lg:max-h-[300px]" aria-label="Options">
          <Field label={`How many ${UNIT_LABELS[opts.unit].toLowerCase()}`}>
            <div class="flex items-center gap-2">
              <input
                type="number"
                class="input h-8 w-20 font-mono text-xs"
                min={1}
                max={MAX_COUNT}
                value={opts.count}
                onInput={(e) => {
                  const n = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(n)) update({ count: Math.max(1, Math.min(MAX_COUNT, Math.round(n))) });
                }}
                aria-label="Count"
              />
              <input type="range" class="flex-1 accent-brand-600" min={1} max={opts.unit === 'words' ? MAX_COUNT : 30} value={Math.min(opts.count, opts.unit === 'words' ? MAX_COUNT : 30)} onInput={(e) => update({ count: Number((e.currentTarget as HTMLInputElement).value) })} aria-label="Count slider" />
            </div>
          </Field>

          <Field label="Flavour">
            <select class="select h-8 text-[13px]" value={opts.flavour} onChange={(e) => update({ flavour: (e.currentTarget as HTMLSelectElement).value as Flavour })} aria-label="Flavour">
              {FLAVOURS.map((f) => (
                <option key={f} value={f}>
                  {VOCABULARIES[f].label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Output format">
            <Segmented value={opts.format} onChange={(format) => update({ format })} options={LOREM_FORMATS.map((f) => ({ value: f, label: FORMAT_LABELS[f] }))} label="Output format" />
          </Field>

          <Chip on={opts.startWithLorem} onClick={() => update({ startWithLorem: !opts.startWithLorem })} title='Begin with "Lorem ipsum dolor sit amet"'>
            Start with "Lorem ipsum"
          </Chip>

          {showSentenceRange && (
            <RangeField label={opts.unit === 'list' ? 'Words per item (max)' : 'Words per sentence'} value={opts.sentenceLength} floor={2} ceil={40} onChange={(sentenceLength) => update({ sentenceLength })} />
          )}
          {showParagraphRange && <RangeField label="Sentences per paragraph" value={opts.paragraphLength} floor={1} ceil={20} onChange={(paragraphLength) => update({ paragraphLength })} />}

          <Field label="Seed (same seed, same text)">
            <div class="flex items-center gap-1">
              <input
                type="number"
                class="input h-8 flex-1 font-mono text-xs"
                value={opts.seed}
                onInput={(e) => {
                  const n = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(n)) update({ seed: n });
                }}
                aria-label="Seed"
              />
              <button type="button" class="btn-secondary btn-sm" onClick={reroll} title="Pick a new random seed">
                <Icon name="redo" size={13} /> Reroll
              </button>
            </div>
          </Field>
        </aside>

        {/* Output */}
        <section class="flex h-[340px] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto" aria-label="Generated text">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{FORMAT_LABELS[opts.format]}</span>
            {result.ok && (
              <span class="ml-2 text-ink-3">
                {result.value.words.toLocaleString()} words · {result.value.characters.toLocaleString()} characters
              </span>
            )}
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={wrap ? 'Disable line wrap' : 'Wrap long lines'} active={wrap} onClick={() => setWrap((w) => !w)} />
            <HeaderButton icon="download" title={`Download lorem-ipsum.${FORMAT_EXTENSIONS[opts.format]}`} onClick={download} disabled={!output} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copy()} disabled={!output} title="Copy text (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy
            </button>
          </header>
          <CodeEditor value={output} readOnly wrap={wrap} placeholder="Generated text appears here" ariaLabel="Generated text" class="flex-1" />
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        {result.ok ? (
          <span class="flex min-w-0 items-center gap-1.5 text-ink-3">
            <Icon name="check" size={13} class="text-success" />
            <span class="truncate">
              {opts.count} {UNIT_LABELS[opts.unit].toLowerCase()} of {VOCABULARIES[opts.flavour].label.toLowerCase()} · seed {opts.seed}
            </span>
          </span>
        ) : (
          <span class="flex min-w-0 items-center gap-1.5 text-danger">
            <Icon name="alert-circle" size={13} class="shrink-0" />
            <span class="truncate">{result.error}</span>
          </span>
        )}
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> generate
        </span>
      </div>
    </div>
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

function RangeField(p: { label: string; value: { min: number; max: number }; floor: number; ceil: number; onChange: (v: { min: number; max: number }) => void }) {
  const set = (key: 'min' | 'max', raw: string) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(p.floor, Math.min(p.ceil, n));
    const next = { ...p.value, [key]: clamped };
    if (next.min > next.max) {
      if (key === 'min') next.max = next.min;
      else next.min = next.max;
    }
    p.onChange(next);
  };
  return (
    <Field label={p.label}>
      <div class="flex items-center gap-2 text-xs text-ink-3">
        <input type="number" class="input h-8 w-16 font-mono text-xs" min={p.floor} max={p.ceil} value={p.value.min} onInput={(e) => set('min', (e.currentTarget as HTMLInputElement).value)} aria-label={`${p.label} minimum`} />
        to
        <input type="number" class="input h-8 w-16 font-mono text-xs" min={p.floor} max={p.ceil} value={p.value.max} onInput={(e) => set('max', (e.currentTarget as HTMLInputElement).value)} aria-label={`${p.label} maximum`} />
      </div>
    </Field>
  );
}
