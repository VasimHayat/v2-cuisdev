/**
 * Data converter workspace shared by the JSON <-> CSV and JSON <-> YAML pages. Input on
 * the left, output on the right, direction switchable in the toolbar, live as you type.
 * The page passes `from` and `to` as island props; the user can flip them.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Extension } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  CONVERTERS,
  ConvertError,
  DEFAULT_OPTIONS,
  DELIMITERS,
  FORMAT_EXT,
  FORMAT_LABELS,
  FORMAT_MIME,
  SAMPLES,
  convert,
  delimiterName,
  describe,
  detectFormat,
  type ConvertOptions,
  type ConvertResult,
  type Delimiter,
  type Format,
  type Indent,
} from './logic';

interface Props {
  from?: Format;
  to?: Format;
}

const PREFS_KEY = 'cuis-convert:options';
const MAX_FILE = 25 * 1024 * 1024;

function loadOptions(): ConvertOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<ConvertOptions> | null;
    if (!raw) return DEFAULT_OPTIONS;
    const o = { ...DEFAULT_OPTIONS };
    if (raw.indent === 2 || raw.indent === 4) o.indent = raw.indent;
    if (raw.yamlIndent === 2 || raw.yamlIndent === 4) o.yamlIndent = raw.yamlIndent;
    if (typeof raw.minify === 'boolean') o.minify = raw.minify;
    if (raw.delimiter === 'auto' || DELIMITERS.includes(raw.delimiter as Delimiter)) o.delimiter = raw.delimiter as Delimiter | 'auto';
    if (typeof raw.header === 'boolean') o.header = raw.header;
    if (typeof raw.quoteAll === 'boolean') o.quoteAll = raw.quoteAll;
    if (typeof raw.dynamicTyping === 'boolean') o.dynamicTyping = raw.dynamicTyping;
    return o;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function extensionFor(format: Format): Extension | null {
  if (format === 'json') return json();
  if (format === 'yaml') return yaml();
  return null;
}

export default function Converter({ from: initialFrom = 'json', to: initialTo = 'yaml' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [from, setFrom] = useState<Format>(initialFrom);
  const [to, setTo] = useState<Format>(initialTo);
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<ConvertOptions>(() => (typeof window === 'undefined' ? DEFAULT_OPTIONS : loadOptions()));
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [error, setError] = useState<ConvertError | null>(null);
  const [wrap, setWrap] = useState(false);
  const [full, setFull] = useState(false);
  const tool = `${initialFrom}-to-${initialTo}`;
  const canFlip = !!CONVERTERS[`${to}-to-${from}`];

  const update = (patch: Partial<ConvertOptions>) => setOptions((o) => ({ ...o, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(options));
    } catch {}
  }, [options]);

  // Convert live, debounced
  useEffect(() => {
    const t = setTimeout(() => {
      if (input.trim() === '') {
        setResult(null);
        setError(null);
        return;
      }
      try {
        setResult(convert(from, to, input, options));
        setError(null);
      } catch (err) {
        setResult(null);
        setError(err instanceof ConvertError ? err : new ConvertError(err instanceof Error ? err.message : String(err)));
      }
    }, 180);
    return () => clearTimeout(t);
  }, [input, from, to, options]);

  const output = result?.output ?? '';
  const inExt = useMemo(() => extensionFor(from), [from]);
  const outExt = useMemo(() => extensionFor(to), [to]);

  // ------------------------------------------------------------------ actions

  const flip = () => {
    if (!canFlip) return;
    const nextInput = output || '';
    setFrom(to);
    setTo(from);
    if (nextInput) setInput(nextInput);
    track('tool_action', { tool, action: 'flip', from: to, to: from });
  };

  const copy = async () => {
    if (!output) return;
    const ok = await copyText(output);
    toast(ok ? `${FORMAT_LABELS[to]} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool, action: 'copy' });
  };

  const download = () => {
    if (!output) return;
    downloadText(output, `converted.${FORMAT_EXT[to]}`, FORMAT_MIME[to]);
    track('tool_action', { tool, action: 'download' });
  };

  const loadSample = () => {
    setInput(SAMPLES[from]);
    track('tool_action', { tool, action: 'sample' });
  };

  const openFile = async (file: File) => {
    if (file.size > MAX_FILE) {
      toast(`File is larger than 25 MB`, 'error');
      return;
    }
    const text = await file.text();
    const ext = file.name.toLowerCase().split('.').pop();
    const byExt: Format | null = ext === 'json' ? 'json' : ext === 'csv' || ext === 'tsv' ? 'csv' : ext === 'yaml' || ext === 'yml' ? 'yaml' : null;
    const detected = byExt ?? detectFormat(text);
    if (detected && detected !== from && CONVERTERS[`${detected}-to-${to}`]) {
      setFrom(detected);
      toast(`Opened ${file.name} as ${FORMAT_LABELS[detected]}`);
    } else if (detected && detected !== from && CONVERTERS[`${detected}-to-${from}`]) {
      setTo(from);
      setFrom(detected);
      toast(`Opened ${file.name}: converting ${FORMAT_LABELS[detected]} to ${FORMAT_LABELS[from]}`);
    } else toast(`Opened ${file.name}`);
    setInput(text);
    if (ext === 'tsv') update({ delimiter: '\t' });
    track('tool_action', { tool, action: 'open_file' });
  };

  const onPaste = (text: string) => {
    const detected = detectFormat(text);
    if (detected && detected !== from && detected === to && canFlip && input.trim() === '') {
      // Pasted the other format into an empty input: flip so it converts the right way.
      setFrom(to);
      setTo(from);
      toast(`Looks like ${FORMAT_LABELS[detected]}, switched to ${FORMAT_LABELS[detected]} to ${FORMAT_LABELS[from]}`);
    }
  };

  // Keyboard and full screen
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

  const csvIn = from === 'csv';
  const csvOut = to === 'csv';
  const jsonOut = to === 'json';
  const yamlOut = to === 'yaml';

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(76vh,820px)] min-h-[540px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".json,.csv,.tsv,.yaml,.yml,.txt,text/*,application/json"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void openFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <div class="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface text-[13px] font-medium" aria-label="Conversion direction">
          <span class="px-2.5 text-ink">{FORMAT_LABELS[from]}</span>
          <button type="button" class="inline-flex h-full items-center border-x border-line-strong px-2 text-ink-2 hover:bg-surface-3 hover:text-ink disabled:opacity-40" onClick={flip} disabled={!canFlip} title="Swap direction (uses the output as the new input)" aria-label="Swap direction">
            <Icon name="arrow-left-right" size={14} />
          </button>
          <span class="px-2.5 text-ink">{FORMAT_LABELS[to]}</span>
        </div>

        {(csvIn || csvOut) && (
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <span class="hidden sm:inline">Delimiter</span>
            <select
              class="select h-8 w-auto text-[13px]"
              value={options.delimiter}
              onChange={(e) => update({ delimiter: (e.currentTarget as HTMLSelectElement).value as Delimiter | 'auto' })}
              aria-label="Delimiter"
            >
              {csvIn && <option value="auto">Auto-detect</option>}
              {DELIMITERS.map((d) => (
                <option key={d} value={d}>
                  {delimiterName(d)[0]!.toUpperCase() + delimiterName(d).slice(1)}
                </option>
              ))}
            </select>
          </label>
        )}
        {(csvIn || csvOut) && (
          <Chip on={options.header} onClick={() => update({ header: !options.header })} title={csvIn ? 'Treat the first row as column names' : 'Write the column names as the first row'}>
            {csvIn ? 'First row is header' : 'Header row'}
          </Chip>
        )}
        {csvIn && (
          <Chip on={options.dynamicTyping} onClick={() => update({ dynamicTyping: !options.dynamicTyping })} title="Turn values that look like numbers or true/false into JSON numbers and booleans">
            Detect numbers
          </Chip>
        )}
        {csvOut && (
          <Chip on={options.quoteAll} onClick={() => update({ quoteAll: !options.quoteAll })} title="Wrap every field in double quotes">
            Quote all
          </Chip>
        )}
        {(jsonOut || yamlOut) && (
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <span class="hidden sm:inline">Indent</span>
            <select
              class="select h-8 w-auto text-[13px]"
              value={String(jsonOut ? options.indent : options.yamlIndent)}
              onChange={(e) => {
                const v = Number((e.currentTarget as HTMLSelectElement).value) as Indent;
                update(jsonOut ? { indent: v } : { yamlIndent: v });
              }}
              aria-label="Indentation"
              disabled={jsonOut && options.minify}
            >
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
            </select>
          </label>
        )}
        {jsonOut && (
          <Chip on={options.minify} onClick={() => update({ minify: !options.minify })} title="Single-line JSON with no whitespace">
            Minify
          </Chip>
        )}

        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title={`Load a ${FORMAT_LABELS[from]} example`}>
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input} title="Clear the input">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Panes */}
      <div class="grid min-h-0 flex-1 gap-2 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-2 md:grid-rows-1">
        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label={`${FORMAT_LABELS[from]} input`}>
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{FORMAT_LABELS[from]}</span>
            <span class="ml-2 text-ink-3">{describe(input)}</span>
            <span class="flex-1" />
            <HeaderButton icon="folder-open" title="Open a file" onClick={() => fileRef.current?.click()} />
          </header>
          <CodeEditor
            value={input}
            onChange={setInput}
            language={inExt}
            wrap={wrap}
            placeholder={`Paste ${FORMAT_LABELS[from]} here, drop a file, or load the sample`}
            error={error && error.offset !== undefined ? { offset: error.offset, message: error.message } : null}
            ariaLabel={`${FORMAT_LABELS[from]} input`}
            class="flex-1"
            onDropFile={(f) => void openFile(f)}
            onPaste={onPaste}
          />
        </section>

        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label={`${FORMAT_LABELS[to]} output`}>
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{FORMAT_LABELS[to]}</span>
            <span class="ml-2 text-ink-3">{result ? result.summary : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={wrap ? 'Disable line wrap' : 'Wrap long lines'} active={wrap} onClick={() => setWrap((w) => !w)} />
            <HeaderButton icon="download" title={`Download converted.${FORMAT_EXT[to]}`} onClick={download} disabled={!output} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copy()} disabled={!output} title="Copy output (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy
            </button>
          </header>
          <CodeEditor value={output} readOnly language={outExt} wrap={wrap} placeholder={`${FORMAT_LABELS[to]} appears here as you type`} ariaLabel={`${FORMAT_LABELS[to]} output`} class="flex-1" />
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <div class="min-w-0">
          {error ? (
            <span class="flex min-w-0 items-center gap-1.5 text-danger">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate">{error.message}</span>
            </span>
          ) : result?.warnings.length ? (
            <span class="flex min-w-0 items-center gap-1.5 text-warning">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate" title={result.warnings.join('\n')}>
                {result.warnings[0]}
                {result.warnings.length > 1 && ` (+${result.warnings.length - 1} more)`}
              </span>
            </span>
          ) : result ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="check" size={13} class="text-success" /> Converted {FORMAT_LABELS[from]} to {FORMAT_LABELS[to]} · {describe(output)}
            </span>
          ) : (
            <span class="text-ink-3">Paste {FORMAT_LABELS[from]} to convert it. Nothing leaves your browser.</span>
          )}
        </div>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy output
        </span>
      </div>
    </div>
  );
}
