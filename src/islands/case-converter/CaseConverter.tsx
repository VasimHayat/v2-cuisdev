/**
 * Case Converter workspace: text on the left, a card per case on the right (each with
 * its own copy button), and a main output editor for the case you pick, ready to copy
 * or download. Identifier cases can convert each line separately.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import { CASES, CaseConverterError, DEFAULT_OPTIONS, SAMPLE, convertAll, formatAll, isCaseId, textStats, type CaseId, type CaseResult, type ConvertOptions, type TitleStyle } from './logic';

const TOOL = 'case-converter';
const PREFS_KEY = 'cuis-case:prefs';
const DRAFT_KEY = 'cuis-case:draft';
const MAX_DRAFT = 100 * 1024;
const PREVIEW_CHARS = 160;

interface Prefs extends ConvertOptions {
  main: CaseId;
  wrap: boolean;
}

const DEFAULT_PREFS: Prefs = { ...DEFAULT_OPTIONS, main: 'title', wrap: true };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const p = { ...DEFAULT_PREFS };
    if (typeof raw.perLine === 'boolean') p.perLine = raw.perLine;
    if (typeof raw.keepAcronyms === 'boolean') p.keepAcronyms = raw.keepAcronyms;
    if (typeof raw.wrap === 'boolean') p.wrap = raw.wrap;
    if (raw.titleStyle === 'simple' || raw.titleStyle === 'ap' || raw.titleStyle === 'chicago') p.titleStyle = raw.titleStyle;
    if (isCaseId(raw.main)) p.main = raw.main;
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function CaseConverter() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(loadDraft);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [expanded, setExpanded] = useState<Set<CaseId>>(new Set());
  const [full, setFull] = useState(false);
  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (input.length <= MAX_DRAFT) localStorage.setItem(DRAFT_KEY, input);
        else localStorage.removeItem(DRAFT_KEY);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [input]);

  const { results, error } = useMemo(() => {
    if (input === '') return { results: [] as CaseResult[], error: null as string | null };
    try {
      return { results: convertAll(input, prefs), error: null };
    } catch (err) {
      return { results: [] as CaseResult[], error: err instanceof CaseConverterError ? err.message : String(err) };
    }
  }, [input, prefs.perLine, prefs.titleStyle, prefs.keepAcronyms]);

  const main = results.find((r) => r.id === prefs.main);
  const stats = textStats(input);

  // ------------------------------------------------------------------ actions

  const copy = async (value: string, label: string) => {
    if (!value) return;
    const ok = await copyText(value);
    toast(ok ? `${label} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', case: label });
  };

  const useAsInput = (value: string) => {
    setInput(value);
    toast('Result moved to the input');
  };

  const toggleExpanded = (id: CaseId) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        if (main) void copy(main.value, main.label);
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

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Chip on={prefs.perLine} onClick={() => update({ perLine: !prefs.perLine })} title="Identifier cases convert each line separately (a list of names becomes a list of identifiers)">
          Per line
        </Chip>
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">Title style</span>
          <select class="select h-8 w-auto text-[13px]" value={prefs.titleStyle} onChange={(e) => update({ titleStyle: (e.currentTarget as HTMLSelectElement).value as TitleStyle })} aria-label="Title case style">
            <option value="simple">Simple</option>
            <option value="ap">AP style</option>
            <option value="chicago">Chicago style</option>
          </select>
        </label>
        <Chip on={prefs.keepAcronyms} onClick={() => update({ keepAcronyms: !prefs.keepAcronyms })} title="Leave all-caps words such as NASA or API unchanged in Title Case">
          Keep acronyms
        </Chip>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={() => setInput(SAMPLE)} title="Load an example">
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

      {/* Main */}
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)]">
        <div class="flex min-h-0 min-w-0 flex-col gap-2">
          <section class="flex h-[260px] min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:flex-1" aria-label="Input text">
            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">Text</span>
              <span class="ml-2 text-ink-3">
                {stats.words.toLocaleString()} {stats.words === 1 ? 'word' : 'words'} · {stats.chars.toLocaleString()} chars · {stats.lines.toLocaleString()} {stats.lines === 1 ? 'line' : 'lines'}
              </span>
            </header>
            <CodeEditor value={input} onChange={setInput} wrap={prefs.wrap} placeholder="Type or paste text, a heading, or a list of names" ariaLabel="Text to convert" class="flex-1" />
          </section>

          <section class="flex h-[220px] min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:flex-1" aria-label="Main output">
            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <label class="flex items-center gap-2">
                <span class="font-semibold text-ink">Output</span>
                <select class="select h-7 w-auto text-[12px]" value={prefs.main} onChange={(e) => update({ main: (e.currentTarget as HTMLSelectElement).value as CaseId })} aria-label="Main output case">
                  {CASES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <span class="flex-1" />
              <HeaderButton icon="wrap-text" title={prefs.wrap ? 'Disable line wrap' : 'Wrap long lines'} active={prefs.wrap} onClick={() => update({ wrap: !prefs.wrap })} />
              <HeaderButton icon="arrow-left" title="Use this result as the input" onClick={() => main && useAsInput(main.value)} disabled={!main} />
              <HeaderButton icon="download" title="Download as a text file" onClick={() => main && downloadText(main.value, `${prefs.main}.txt`)} disabled={!main} />
              <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => main && void copy(main.value, main.label)} disabled={!main} title="Copy the output (Ctrl+Shift+C)">
                <Icon name="copy" size={13} /> Copy
              </button>
            </header>
            <CodeEditor value={main?.value ?? ''} readOnly wrap={prefs.wrap} placeholder="The selected case appears here" ariaLabel="Converted text" class="flex-1" />
          </section>
        </div>

        <section class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface max-lg:max-h-[620px]" aria-label="All cases">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">All cases</span>
            <span class="ml-2 text-ink-3">{CASES.length} conversions</span>
            <span class="flex-1" />
            <button type="button" class="btn-secondary btn-sm h-7" onClick={() => void copy(formatAll(results), 'All cases')} disabled={results.length === 0} title="Copy every conversion with its label">
              <Icon name="copy" size={13} /> Copy all
            </button>
          </header>
          {results.length === 0 ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-3">
              {error ? <p class="text-danger">{error}</p> : <p>Type on the left and every case appears here at once.</p>}
              {!error && (
                <button type="button" class="btn-secondary btn-sm" onClick={() => setInput(SAMPLE)}>
                  Try the sample
                </button>
              )}
            </div>
          ) : (
            <div class="scrollbar-thin grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto p-2 sm:grid-cols-2">
              {results.map((r) => {
                const isOpen = expanded.has(r.id);
                const long = r.value.length > PREVIEW_CHARS;
                const shown = long && !isOpen ? `${r.value.slice(0, PREVIEW_CHARS)}…` : r.value;
                const active = r.id === prefs.main;
                return (
                  <article
                    key={r.id}
                    class={'flex min-w-0 flex-col rounded-md border p-2.5 transition-colors ' + (active ? 'border-brand-400 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-900/20' : 'border-line hover:border-line-strong')}
                  >
                    <div class="flex items-center gap-2">
                      <button type="button" class="min-w-0 text-left" onClick={() => update({ main: r.id })} title="Show in the output editor">
                        <span class="block truncate font-mono text-[13px] font-semibold text-ink">{r.label}</span>
                        <span class="block truncate text-[11px] text-ink-3">{r.hint}</span>
                      </button>
                      <span class="flex-1" />
                      <HeaderButton icon="copy" title={`Copy ${r.label}`} onClick={() => void copy(r.value, r.label)} />
                    </div>
                    <pre class="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ink-2">{shown}</pre>
                    {long && (
                      <button type="button" class="mt-1 self-start text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400" onClick={() => toggleExpanded(r.id)}>
                        {isOpen ? 'Show less' : `Show all ${r.value.length.toLocaleString()} characters`}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <span class="min-w-0 truncate text-ink-3">
          {error ? (
            <span class="text-danger">{error}</span>
          ) : results.length ? (
            <>
              <Icon name="check" size={13} class="mr-1 inline text-success" />
              Converted to {CASES.length} cases{prefs.perLine ? ', identifiers line by line' : ''}. Nothing leaves your browser.
            </>
          ) : (
            'Conversions run in your browser as you type.'
          )}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy output
        </span>
      </div>
    </div>
  );
}
