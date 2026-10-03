/**
 * Line tools workspace shared by the Remove Duplicate Lines and Sort Lines pages. Input on
 * the left, result on the right, a pipeline of cleanup, dedupe and sort steps in the
 * options panel. `kind` only decides which panel opens first and the page defaults.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import { DEFAULT_OPTIONS, SAMPLE_DEDUPE, SAMPLE_SORT, joinLines, processLines, type DedupeMode, type KeepWhich, type LineOptions, type SortMode } from './logic';

type Kind = 'dedupe' | 'sort';
type Panel = 'dedupe' | 'sort' | 'cleanup';

interface Props {
  kind?: Kind;
}

const PREFS_KEY = 'cuis-lines:prefs';
const DRAFT_KEY = 'cuis-lines:draft';

const SORT_MODES: { value: SortMode; label: string }[] = [
  { value: 'off', label: 'Keep order' },
  { value: 'az', label: 'A to Z' },
  { value: 'za', label: 'Z to A' },
  { value: 'natural', label: 'Natural (1, 2, 10)' },
  { value: 'natural-desc', label: 'Natural, descending' },
  { value: 'length', label: 'Shortest first' },
  { value: 'length-desc', label: 'Longest first' },
  { value: 'reverse', label: 'Reverse order' },
  { value: 'shuffle', label: 'Shuffle' },
];

function defaultsFor(kind: Kind): LineOptions {
  return kind === 'sort' ? { ...DEFAULT_OPTIONS, dedupe: 'off', sort: 'az' } : { ...DEFAULT_OPTIONS, dedupe: 'unique', sort: 'off' };
}

function loadOptions(kind: Kind): LineOptions {
  const base = defaultsFor(kind);
  try {
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Record<string, Partial<LineOptions>> | null;
    const saved = all?.[kind];
    if (!saved || typeof saved !== 'object') return base;
    const o = { ...base };
    for (const k of Object.keys(base) as (keyof LineOptions)[]) {
      const v = saved[k];
      if (v !== undefined && typeof v === typeof base[k]) (o as Record<string, unknown>)[k] = v;
    }
    return o;
  } catch {
    return base;
  }
}

function loadDraft(kind: Kind): string {
  try {
    return localStorage.getItem(`${DRAFT_KEY}:${kind}`) ?? '';
  } catch {
    return '';
  }
}

export default function LineTools({ kind = 'dedupe' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tool = kind === 'sort' ? 'sort-lines' : 'remove-duplicate-lines';
  const [input, setInput] = useState(() => loadDraft(kind));
  const [o, setO] = useState<LineOptions>(() => loadOptions(kind));
  const [panel, setPanel] = useState<Panel>(kind);
  const [wrap, setWrap] = useState(false);
  const [full, setFull] = useState(false);
  const update = (patch: Partial<LineOptions>) => setO((p) => ({ ...p, ...patch }));

  useEffect(() => {
    try {
      const all = (JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Record<string, LineOptions> | null) ?? {};
      all[kind] = o;
      localStorage.setItem(PREFS_KEY, JSON.stringify(all));
    } catch {}
  }, [o, kind]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (input.length <= 200 * 1024) localStorage.setItem(`${DRAFT_KEY}:${kind}`, input);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [input, kind]);

  const t0 = useRef(0);
  const result = useMemo(() => {
    t0.current = performance.now();
    const r = processLines(input, o);
    t0.current = performance.now() - t0.current;
    return r;
  }, [input, o]);
  const output = joinLines(result.lines);

  // ------------------------------------------------------------------ actions

  const copy = async () => {
    if (!output) return;
    const ok = await copyText(output);
    toast(ok ? 'Result copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool, action: 'copy' });
  };
  const download = () => {
    if (!output) return;
    downloadText(output, kind === 'sort' ? 'sorted.txt' : 'unique.txt');
    track('tool_action', { tool, action: 'download' });
  };
  const useOutput = () => {
    if (!output) return;
    setInput(output);
    toast('Result moved to the input');
    track('tool_action', { tool, action: 'use_output' });
  };
  const loadSample = () => {
    setInput(kind === 'sort' ? SAMPLE_SORT : SAMPLE_DEDUPE);
    track('tool_action', { tool, action: 'sample' });
  };
  const reset = () => {
    setO(defaultsFor(kind));
    toast('Options reset');
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
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

  const steps: string[] = [];
  if (o.trim) steps.push('trim');
  if (o.removeEmpty) steps.push('drop empty');
  if (o.dedupe !== 'off') steps.push(o.dedupe === 'unique' ? 'dedupe' : o.dedupe === 'count' ? 'count' : 'duplicates only');
  if (o.sort !== 'off' && o.dedupe !== 'count') steps.push(SORT_MODES.find((s) => s.value === o.sort)?.label.toLowerCase() ?? 'sort');
  if (o.prefix || o.suffix) steps.push('wrap');
  if (o.lineNumbers) steps.push('number');

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={panel}
          onChange={setPanel}
          options={[
            { value: 'dedupe', label: 'Duplicates', icon: 'layers' },
            { value: 'sort', label: 'Sort', icon: 'arrow-down-az' },
            { value: 'cleanup', label: 'Clean up', icon: 'wand' },
          ]}
          label="Options panel"
        />
        <span class="hidden text-xs text-ink-3 md:inline">Pipeline: {steps.length ? steps.join(' → ') : 'no changes'}</span>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example list">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input} title="Clear the input">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Reset options to this page's defaults">
            <Icon name="undo" size={14} /> Reset
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Options */}
      <div class="mb-2 flex min-h-[44px] flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs" aria-label="Options">
        {panel === 'dedupe' && (
          <>
            <Field label="Mode">
              <select class="select h-8 w-auto text-[13px]" value={o.dedupe} onChange={(e) => update({ dedupe: (e.currentTarget as HTMLSelectElement).value as DedupeMode })} aria-label="Duplicate mode">
                <option value="unique">Remove duplicates</option>
                <option value="duplicates-only">Show only duplicates</option>
                <option value="count">Count occurrences</option>
                <option value="off">Keep duplicates</option>
              </select>
            </Field>
            {o.dedupe === 'unique' && (
              <Field label="Keep">
                <Segmented
                  value={o.keep}
                  onChange={(keep: KeepWhich) => update({ keep })}
                  options={[
                    { value: 'first', label: 'First' },
                    { value: 'last', label: 'Last' },
                  ]}
                  label="Which occurrence to keep"
                />
              </Field>
            )}
            <Chip on={o.ignoreCase} onClick={() => update({ ignoreCase: !o.ignoreCase })} title="Treat Apple and apple as the same line">
              Ignore case
            </Chip>
            <Chip on={o.trimCompare} onClick={() => update({ trimCompare: !o.trimCompare })} title="Ignore leading and trailing spaces when comparing">
              Ignore surrounding spaces
            </Chip>
            <Chip on={o.removeEmpty} onClick={() => update({ removeEmpty: !o.removeEmpty })} title="Drop blank lines">
              Remove empty lines
            </Chip>
          </>
        )}
        {panel === 'sort' && (
          <>
            <Field label="Order">
              <select class="select h-8 w-auto text-[13px]" value={o.sort} onChange={(e) => update({ sort: (e.currentTarget as HTMLSelectElement).value as SortMode })} aria-label="Sort order">
                {SORT_MODES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            {o.sort === 'shuffle' ? (
              <button type="button" class="btn-secondary btn-sm" onClick={() => update({ seed: Math.floor(Math.random() * 1e9) })} title="Shuffle again">
                <Icon name="redo" size={13} /> Reshuffle
              </button>
            ) : (
              o.sort !== 'off' &&
              o.sort !== 'reverse' && (
                <>
                  <Chip on={o.sortIgnoreCase} onClick={() => update({ sortIgnoreCase: !o.sortIgnoreCase })} title="Sort apple and Apple together">
                    Ignore case
                  </Chip>
                  <Chip on={o.locale} onClick={() => update({ locale: !o.locale })} title="Order accented letters as people expect in your language (Äpfel next to apple)">
                    Language-aware
                  </Chip>
                  <Field label="By column">
                    <input
                      type="number"
                      min={0}
                      class="input h-8 w-16 text-[13px]"
                      value={o.column}
                      onInput={(e) => update({ column: Math.max(0, Math.floor(Number((e.currentTarget as HTMLInputElement).value) || 0)) })}
                      aria-label="Column to sort by, 0 for the whole line"
                      title="0 sorts by the whole line"
                    />
                  </Field>
                  {o.column > 0 && (
                    <Field label="Delimiter">
                      <select class="select h-8 w-auto text-[13px]" value={o.delimiter} onChange={(e) => update({ delimiter: (e.currentTarget as HTMLSelectElement).value })} aria-label="Column delimiter">
                        <option value=",">Comma</option>
                        <option value=";">Semicolon</option>
                        <option value="\t">Tab</option>
                        <option value="|">Pipe</option>
                        <option value=" ">Space</option>
                      </select>
                    </Field>
                  )}
                </>
              )
            )}
            {o.dedupe === 'count' && <span class="text-warning">Count mode orders by count; switch Duplicates to another mode to sort.</span>}
          </>
        )}
        {panel === 'cleanup' && (
          <>
            <Chip on={o.trim} onClick={() => update({ trim: !o.trim })} title="Remove leading and trailing spaces from every line">
              Trim lines
            </Chip>
            <Chip on={o.removeEmpty} onClick={() => update({ removeEmpty: !o.removeEmpty })} title="Drop blank lines">
              Remove empty lines
            </Chip>
            <Chip on={o.lineNumbers} onClick={() => update({ lineNumbers: !o.lineNumbers })} title="Number the output lines">
              Number lines
            </Chip>
            <Field label="Prefix">
              <input class="input h-8 w-24 font-mono text-[13px]" value={o.prefix} onInput={(e) => update({ prefix: (e.currentTarget as HTMLInputElement).value })} aria-label="Prefix" placeholder="e.g. '" />
            </Field>
            <Field label="Suffix">
              <input class="input h-8 w-24 font-mono text-[13px]" value={o.suffix} onInput={(e) => update({ suffix: (e.currentTarget as HTMLInputElement).value })} aria-label="Suffix" placeholder="e.g. '," />
            </Field>
          </>
        )}
      </div>

      {/* Panes */}
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <section class="flex h-[340px] min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:min-h-0" aria-label="Input lines">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Input</span>
            <span class="ml-2 text-ink-3">{result.inputCount.toLocaleString()} lines</span>
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={wrap ? 'Disable line wrap' : 'Wrap long lines'} active={wrap} onClick={() => setWrap((w) => !w)} />
          </header>
          <CodeEditor value={input} onChange={setInput} wrap={wrap} placeholder="Paste a list, one item per line" ariaLabel="Lines to process" class="flex-1" />
        </section>
        <section class="flex h-[340px] min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:min-h-0" aria-label="Result">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Result</span>
            <span class="ml-2 text-ink-3">{result.outputCount.toLocaleString()} lines</span>
            <span class="flex-1" />
            <HeaderButton icon="arrow-left" title="Use the result as input" onClick={useOutput} disabled={!output} />
            <HeaderButton icon="download" title="Download as a text file" onClick={download} disabled={!output} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copy()} disabled={!output} title="Copy the result (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy
            </button>
          </header>
          <CodeEditor value={output} readOnly wrap={wrap} placeholder="The result appears here as you type" ariaLabel="Processed lines" class="flex-1" />
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">
          {result.inputCount ? (
            <>
              <Icon name="check" size={13} class="mr-1 inline text-success" />
              {result.inputCount.toLocaleString()} lines in → {result.outputCount.toLocaleString()} out
              {result.duplicatesRemoved > 0 && ` · ${result.duplicatesRemoved.toLocaleString()} duplicate${result.duplicatesRemoved === 1 ? '' : 's'} removed`}
              {result.duplicateGroups > 0 && o.dedupe !== 'off' && ` · ${result.duplicateGroups.toLocaleString()} repeated value${result.duplicateGroups === 1 ? '' : 's'}`}
              {result.emptyRemoved > 0 && ` · ${result.emptyRemoved.toLocaleString()} empty removed`}
              {` · ${t0.current < 1 ? '<1' : Math.round(t0.current)} ms`}
            </>
          ) : (
            'Paste a list to begin. Nothing leaves your browser.'
          )}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy result
        </span>
      </div>
    </div>
  );
}

function Field(p: { label: string; children: ComponentChildren }) {
  return (
    <div class="flex items-center gap-2 text-ink-2">
      <span>{p.label}</span>
      {p.children}
    </div>
  );
}
