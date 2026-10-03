/**
 * Code Formatter workspace: input on the left, formatted or minified output on the
 * right, options in the toolbar, live as you type. Prettier / terser / csso /
 * sql-formatter are loaded on first use (see logic.ts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Extension } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, formatBytes, toast, track } from '../shared/toast';
import {
  LANGUAGES,
  LANGUAGE_IDS,
  SAMPLES,
  SQL_DIALECTS,
  beautify,
  byteLength,
  canMinify,
  detectLanguage,
  fileNameFor,
  isLanguageId,
  isReady,
  isSqlDialect,
  languageFromFileName,
  minify,
  minifyUnavailableMessage,
  savingsPercent,
  CodeFormatError,
  type BeautifyOptions,
  type IndentOption,
  type KeywordCase,
  type LanguageId,
  type Mode,
  type PrintWidth,
} from './logic';

interface Props {
  /** Pre-select a language (used when one island serves several pages). */
  language?: LanguageId;
  /** Hide the language select and keep the page on one language. */
  lockLanguage?: boolean;
}

type LangSel = 'auto' | LanguageId;

interface Prefs {
  lang: LangSel;
  mode: Mode;
  indent: IndentOption;
  printWidth: PrintWidth;
  singleQuote: boolean;
  semicolons: boolean;
  trailingCommas: boolean;
  dialect: BeautifyOptions['dialect'];
  keywordCase: KeywordCase;
  wrap: boolean;
}

const PREFS_KEY = 'cuis-cf:prefs';
const DRAFT_KEY = 'cuis-cf:draft';
const MAX_DRAFT = 200 * 1024;
const MAX_FILE = 10 * 1024 * 1024;
const TOOL = 'code-formatter';

const DEFAULT_PREFS: Prefs = {
  lang: 'auto',
  mode: 'beautify',
  indent: 2,
  printWidth: 80,
  singleQuote: false,
  semicolons: true,
  trailingCommas: true,
  dialect: 'sql',
  keywordCase: 'upper',
  wrap: false,
};

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
    const p: Prefs = { ...DEFAULT_PREFS };
    if (raw.lang === 'auto' || isLanguageId(raw.lang)) p.lang = raw.lang;
    if (raw.mode === 'beautify' || raw.mode === 'minify') p.mode = raw.mode;
    if (raw.indent === 2 || raw.indent === 4 || raw.indent === 'tab') p.indent = raw.indent;
    if (raw.printWidth === 80 || raw.printWidth === 100 || raw.printWidth === 120) p.printWidth = raw.printWidth;
    if (typeof raw.singleQuote === 'boolean') p.singleQuote = raw.singleQuote;
    if (typeof raw.semicolons === 'boolean') p.semicolons = raw.semicolons;
    if (typeof raw.trailingCommas === 'boolean') p.trailingCommas = raw.trailingCommas;
    if (isSqlDialect(raw.dialect)) p.dialect = raw.dialect;
    if (raw.keywordCase === 'upper' || raw.keywordCase === 'lower' || raw.keywordCase === 'preserve') p.keywordCase = raw.keywordCase;
    if (typeof raw.wrap === 'boolean') p.wrap = raw.wrap;
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

function languageExtension(language: LanguageId): Extension {
  switch (language) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'html':
      return html();
    case 'css':
    case 'scss':
      return css();
    case 'json':
      return json();
    case 'sql':
      return sql();
    case 'xml':
      return xml();
  }
}

export default function CodeFormatter({ language: fixedLanguage, lockLanguage = false }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = typeof window === 'undefined' ? DEFAULT_PREFS : loadPrefs();
    return fixedLanguage ? { ...p, lang: fixedLanguage } : p;
  });
  const [input, setInput] = useState(() => (typeof window === 'undefined' ? '' : loadDraft()));
  const [output, setOutput] = useState('');
  const [error, setError] = useState<CodeFormatError | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingLib, setLoadingLib] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const seq = useRef(0);

  const detected = useMemo(() => (prefs.lang === 'auto' ? detectLanguage(input) : null), [prefs.lang, input]);
  const language: LanguageId = prefs.lang === 'auto' ? (detected ?? 'javascript') : prefs.lang;
  const info = LANGUAGES[language];
  const mode: Mode = prefs.mode === 'minify' && !canMinify(language) ? 'beautify' : prefs.mode;
  const langExt = useMemo(() => languageExtension(language), [language]);

  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  // Persist preferences and draft
  useEffect(() => {
    try {
      // A page with a locked language must not overwrite the language chosen on the general formatter.
      const stored = fixedLanguage ? { ...prefs, lang: loadPrefs().lang } : prefs;
      localStorage.setItem(PREFS_KEY, JSON.stringify(stored));
    } catch {}
  }, [prefs, fixedLanguage]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (input.length <= MAX_DRAFT) localStorage.setItem(DRAFT_KEY, input);
        else localStorage.removeItem(DRAFT_KEY);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [input]);

  // Run the formatter
  const run = useCallback(async () => {
    const id = ++seq.current;
    const source = input;
    if (source.trim() === '') {
      setOutput('');
      setError(null);
      setElapsed(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const ready = isReady(language, mode);
    if (!ready) setLoadingLib(true);
    const t0 = performance.now();
    try {
      const result =
        mode === 'minify'
          ? await minify(source, language)
          : await beautify(source, language, {
              indent: prefs.indent,
              printWidth: prefs.printWidth,
              singleQuote: prefs.singleQuote,
              semicolons: prefs.semicolons,
              trailingCommas: prefs.trailingCommas,
              dialect: prefs.dialect,
              keywordCase: prefs.keywordCase,
            });
      if (id !== seq.current) return;
      setOutput(result);
      setError(null);
      setElapsed(performance.now() - t0);
    } catch (err) {
      if (id !== seq.current) return;
      setError(err instanceof CodeFormatError ? err : new CodeFormatError(err instanceof Error ? err.message : String(err)));
      setElapsed(null);
    } finally {
      if (id === seq.current) {
        setBusy(false);
        setLoadingLib(false);
      }
    }
  }, [input, language, mode, prefs.indent, prefs.printWidth, prefs.singleQuote, prefs.semicolons, prefs.trailingCommas, prefs.dialect, prefs.keywordCase]);

  useEffect(() => {
    const t = setTimeout(() => void run(), 220);
    return () => clearTimeout(t);
  }, [run]);

  // Keyboard: Ctrl/Cmd+Enter runs now, Ctrl/Cmd+Shift+C copies the output
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        void run();
      } else if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copyOutput();
      } else if (e.key === 'Escape' && full) {
        setFull(false);
      }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  // Full screen (native API with fixed-overlay fallback)
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

  // ------------------------------------------------------------------ actions

  const copyOutput = async () => {
    if (!output) return;
    const ok = await copyText(output);
    toast(ok ? 'Output copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', language, mode });
  };

  const download = () => {
    if (!output) return;
    downloadText(output, fileNameFor(language, mode), info.mime);
    track('tool_action', { tool: TOOL, action: 'download', language, mode });
  };

  const useAsInput = () => {
    if (!output) return;
    setInput(output);
    toast('Output moved to input');
  };

  const loadSample = () => {
    const lang = prefs.lang === 'auto' ? 'javascript' : prefs.lang;
    setInput(SAMPLES[lang]);
    track('tool_action', { tool: TOOL, action: 'sample', language: lang });
  };

  const clear = () => {
    setInput('');
    setOutput('');
    setError(null);
    seq.current++;
    setBusy(false);
  };

  const openFile = async (file: File) => {
    if (file.size > MAX_FILE) {
      toast(`File is larger than ${formatBytes(MAX_FILE)}`, 'error');
      return;
    }
    const text = await file.text();
    setInput(text);
    const byName = languageFromFileName(file.name);
    if (byName && !lockLanguage && prefs.lang !== byName) {
      update({ lang: byName });
      toast(`Opened ${file.name} as ${LANGUAGES[byName].label}`);
    } else toast(`Opened ${file.name}`);
    track('tool_action', { tool: TOOL, action: 'open_file', language: byName ?? language });
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast('Clipboard is empty', 'error');
        return;
      }
      setInput(text);
    } catch {
      toast('Clipboard access blocked. Press Ctrl+V in the editor instead.', 'error');
    }
  };

  const inBytes = useMemo(() => byteLength(input), [input]);
  const outBytes = useMemo(() => byteLength(output), [output]);
  const savings = savingsPercent(inBytes, outBytes);
  const minifyNote = minifyUnavailableMessage(language);
  const showPrettierOptions = mode === 'beautify' && language !== 'sql' && language !== 'xml';
  const showIndent = mode === 'beautify';
  const showScriptOptions = showPrettierOptions && info.script;
  const showSqlOptions = mode === 'beautify' && language === 'sql';

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".js,.mjs,.cjs,.jsx,.ts,.tsx,.html,.htm,.css,.scss,.json,.sql,.txt,text/*,application/json"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void openFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        {!lockLanguage && (
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <span class="hidden sm:inline">Language</span>
            <select
              class="select h-8 w-auto min-w-[8.5rem] text-[13px]"
              value={prefs.lang}
              onChange={(e) => update({ lang: (e.currentTarget as HTMLSelectElement).value as LangSel })}
              aria-label="Language"
            >
              <option value="auto">Auto{detected ? ` (${LANGUAGES[detected].label})` : ''}</option>
              {LANGUAGE_IDS.map((id) => (
                <option value={id}>{LANGUAGES[id].label}</option>
              ))}
            </select>
          </label>
        )}

        <Segmented
          value={mode}
          onChange={(m) => update({ mode: m })}
          options={[
            { value: 'beautify', label: 'Beautify', icon: 'align-left' },
            { value: 'minify', label: 'Minify', icon: 'chevrons-down-up', disabled: !canMinify(language), title: minifyNote },
          ]}
        />

        {showIndent && (
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <span class="hidden sm:inline">Indent</span>
            <select
              class="select h-8 w-auto text-[13px]"
              value={String(prefs.indent)}
              onChange={(e) => {
                const v = (e.currentTarget as HTMLSelectElement).value;
                update({ indent: v === 'tab' ? 'tab' : (Number(v) as IndentOption) });
              }}
              aria-label="Indentation"
            >
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
              <option value="tab">Tabs</option>
            </select>
          </label>
        )}

        {showPrettierOptions && (
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <span class="hidden sm:inline">Width</span>
            <select
              class="select h-8 w-auto text-[13px]"
              value={String(prefs.printWidth)}
              onChange={(e) => update({ printWidth: Number((e.currentTarget as HTMLSelectElement).value) as PrintWidth })}
              aria-label="Print width"
            >
              <option value="80">80 cols</option>
              <option value="100">100 cols</option>
              <option value="120">120 cols</option>
            </select>
          </label>
        )}

        {showScriptOptions && (
          <div class="flex items-center gap-1.5" role="group" aria-label="Style options">
            <Chip on={prefs.singleQuote} onClick={() => update({ singleQuote: !prefs.singleQuote })} title="Use single quotes for strings">
              Single quotes
            </Chip>
            <Chip on={prefs.semicolons} onClick={() => update({ semicolons: !prefs.semicolons })} title="End statements with semicolons">
              Semicolons
            </Chip>
            <Chip on={prefs.trailingCommas} onClick={() => update({ trailingCommas: !prefs.trailingCommas })} title="Add trailing commas in multi-line lists">
              Trailing commas
            </Chip>
          </div>
        )}

        {showSqlOptions && (
          <>
            <label class="flex items-center gap-2 text-xs text-ink-2">
              <span class="hidden sm:inline">Dialect</span>
              <select
                class="select h-8 w-auto text-[13px]"
                value={prefs.dialect}
                onChange={(e) => {
                  const v = (e.currentTarget as HTMLSelectElement).value;
                  if (isSqlDialect(v)) update({ dialect: v });
                }}
                aria-label="SQL dialect"
              >
                {SQL_DIALECTS.map((d) => (
                  <option value={d.id}>{d.label}</option>
                ))}
              </select>
            </label>
            <label class="flex items-center gap-2 text-xs text-ink-2">
              <span class="hidden sm:inline">Keywords</span>
              <select
                class="select h-8 w-auto text-[13px]"
                value={prefs.keywordCase}
                onChange={(e) => update({ keywordCase: (e.currentTarget as HTMLSelectElement).value as KeywordCase })}
                aria-label="Keyword case"
              >
                <option value="upper">UPPERCASE</option>
                <option value="lower">lowercase</option>
                <option value="preserve">Preserve</option>
              </select>
            </label>
          </>
        )}

        <span class="flex-1" />

        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={clear} disabled={!input && !output} title="Clear both panes">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button
            type="button"
            class="btn-ghost btn-sm btn-icon h-8 w-8"
            onClick={() => setFull((f) => !f)}
            title={full ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
          >
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Panes */}
      <div class="grid min-h-0 flex-1 gap-2 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-2 md:grid-rows-1">
        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Input code">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Input</span>
            <span class="ml-2 text-ink-3">{info.label} · {formatBytes(inBytes)}</span>
            <span class="flex-1" />
            <HeaderButton icon="folder-open" title="Open a file" onClick={() => fileRef.current?.click()} />
            <HeaderButton icon="clipboard-paste" title="Paste from clipboard" onClick={() => void pasteFromClipboard()} />
          </header>
          <CodeEditor
            value={input}
            onChange={setInput}
            language={langExt}
            wrap={prefs.wrap}
            placeholder={`Paste ${info.label} here, drop a file, or load the sample`}
            error={error?.position ? { offset: error.position.offset, message: error.message } : null}
            ariaLabel="Code to format"
            class="flex-1"
            onDropFile={(f) => void openFile(f)}
          />
        </section>

        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Formatted output">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{mode === 'minify' ? 'Minified' : 'Formatted'}</span>
            <span class="ml-2 text-ink-3">
              {output ? formatBytes(outBytes) : ''}
              {output && mode === 'minify' && savings !== 0 && (
                <span class={'ml-1 ' + (savings > 0 ? 'text-success' : 'text-ink-3')}>
                  ({savings > 0 ? '−' : '+'}
                  {Math.abs(savings)}%)
                </span>
              )}
            </span>
            {busy && <Icon name="loader" size={13} class="ml-2 animate-spin text-ink-3" />}
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={prefs.wrap ? 'Disable line wrap' : 'Wrap long lines'} active={prefs.wrap} onClick={() => update({ wrap: !prefs.wrap })} />
            <HeaderButton icon="arrow-left" title="Use output as input" onClick={useAsInput} disabled={!output} />
            <HeaderButton icon="download" title={`Download ${fileNameFor(language, mode)}`} onClick={download} disabled={!output} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copyOutput()} disabled={!output} title="Copy output (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy
            </button>
          </header>
          <CodeEditor value={output} readOnly language={langExt} wrap={prefs.wrap} placeholder="Output appears here as you type" ariaLabel="Formatted code" class="flex-1" />
        </section>
      </div>

      {/* Status bar */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <div class="flex min-w-0 items-center gap-2">
          {error ? (
            <span class="flex min-w-0 items-center gap-1.5 text-danger">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate">{error.message}</span>
            </span>
          ) : loadingLib ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="loader" size={13} class="animate-spin" /> Loading {language === 'sql' ? 'SQL formatter' : mode === 'minify' ? 'minifier' : 'Prettier'} (first use only)
            </span>
          ) : output ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="check" size={13} class="text-success" />
              {mode === 'minify' ? 'Minified' : 'Formatted'} {info.label}
              {elapsed !== null && ` in ${elapsed < 1 ? '<1' : Math.round(elapsed)} ms`} · {formatBytes(inBytes)} → {formatBytes(outBytes)}
            </span>
          ) : (
            <span class="text-ink-3">Paste code to format it. Nothing leaves your browser.</span>
          )}
        </div>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> format now
        </span>
      </div>
    </div>
  );
}
