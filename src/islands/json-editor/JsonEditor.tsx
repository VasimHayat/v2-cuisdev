import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, dropCursor, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { json as jsonLang } from '@codemirror/lang-json';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { parseJson, formatJson, minifyJson, statsOf, SAMPLE_JSON, type Indent, type JsonError } from './json';
import { toast, track, copyText, downloadText, formatBytes } from '../shared/toast';

export type Mode = 'editor' | 'formatter' | 'validator' | 'minifier';

interface Props {
  mode?: Mode;
}

const STORAGE_KEY = 'cuis-json-editor';

export default function JsonEditor({ mode = 'editor' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const indentComp = useRef(new Compartment());
  const [indent, setIndent] = useState<Indent>(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [error, setError] = useState<JsonError | null>(null);
  const [text, setText] = useState('');
  const [output, setOutput] = useState('');
  const [full, setFull] = useState(false);

  const twoPane = mode === 'formatter' || mode === 'minifier';

  // ----- CodeMirror setup -----
  useEffect(() => {
    if (!hostRef.current) return;
    let initial = '';
    try {
      initial = sessionStorage.getItem(STORAGE_KEY) ?? '';
    } catch {}

    const jsonLinter = linter((view) => {
      const doc = view.state.doc.toString();
      if (!doc.trim()) {
        setError(null);
        return [];
      }
      const res = parseJson(doc);
      if (res.ok) {
        setError(null);
        return [];
      }
      setError(res.error);
      const from = Math.min(res.error.offset, doc.length);
      const d: Diagnostic = {
        from,
        to: Math.min(from + 1, doc.length),
        severity: 'error',
        message: res.error.message + (res.error.hint ? `\n${res.error.hint}` : ''),
      };
      return [d];
    }, { delay: 250 });

    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        dropCursor(),
        history(),
        foldGutter(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        jsonLang(),
        jsonLinter,
        lintGutter(),
        indentComp.current.of(EditorState.tabSize.of(2)),
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
        cmPlaceholder('Paste or type JSON here, or drop a .json file'),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const t = u.state.doc.toString();
            setText(t);
            try {
              sessionStorage.setItem(STORAGE_KEY, t);
            } catch {}
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    setText(initial);
    return () => view.destroy();
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: indentComp.current.reconfigure(EditorState.tabSize.of(indent === 'tab' ? 4 : indent)),
    });
  }, [indent]);

  // Auto-produce output in two-pane modes.
  useEffect(() => {
    if (!twoPane) return;
    const res = parseJson(text);
    if (!res.ok) {
      setOutput('');
      return;
    }
    setOutput(mode === 'minifier' ? minifyJson(res.value) : formatJson(res.value, indent, sortKeys));
  }, [text, indent, sortKeys, mode, twoPane]);

  const parsed = useMemo(() => parseJson(text), [text]);
  const stats = useMemo(() => (parsed.ok ? statsOf(text, parsed.value) : null), [parsed, text]);
  const outBytes = useMemo(() => new TextEncoder().encode(output).length, [output]);

  // ----- Actions -----
  const setDoc = (t: string) => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
  };
  const requireValid = () => {
    if (!parsed.ok) {
      toast(parsed.error.message, 'error');
      jumpToError();
      return null;
    }
    return parsed.value;
  };
  const doFormat = () => {
    const v = requireValid();
    if (v === null) return;
    setDoc(formatJson(v, indent, sortKeys));
    toast('Formatted');
    track('tool_action', { tool: 'json-editor', action: 'format', indent });
  };
  const doMinify = () => {
    const v = requireValid();
    if (v === null) return;
    const before = new TextEncoder().encode(text).length;
    const out = minifyJson(v);
    setDoc(out);
    const after = new TextEncoder().encode(out).length;
    toast(`Minified: ${formatBytes(before)} to ${formatBytes(after)}`);
    track('tool_action', { tool: 'json-editor', action: 'minify' });
  };
  const doValidate = () => {
    if (parsed.ok) toast('Valid JSON');
    else {
      toast(`Line ${parsed.error.line}: ${parsed.error.message}`, 'error');
      jumpToError();
    }
    track('tool_action', { tool: 'json-editor', action: 'validate', valid: parsed.ok });
  };
  const doCopy = async () => {
    const src = twoPane ? output : text;
    if (!src) return toast('Nothing to copy', 'error');
    (await copyText(src)) ? toast('Copied to clipboard') : toast('Copy failed', 'error');
    track('tool_action', { tool: 'json-editor', action: 'copy' });
  };
  const doDownload = () => {
    const src = twoPane ? output : text;
    if (!src) return toast('Nothing to download', 'error');
    downloadText(src, mode === 'minifier' ? 'data.min.json' : 'data.json', 'application/json');
    track('tool_action', { tool: 'json-editor', action: 'download' });
  };
  const doClear = () => {
    setDoc('');
    viewRef.current?.focus();
  };
  const doSample = () => {
    setDoc(SAMPLE_JSON);
    track('tool_action', { tool: 'json-editor', action: 'sample' });
  };
  const jumpToError = () => {
    const v = viewRef.current;
    if (!v || !error) return;
    const pos = Math.min(error.offset, v.state.doc.length);
    v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    v.focus();
  };

  // Drag & drop / paste file
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return toast('File is larger than 25 MB', 'error');
    setDoc(await f.text());
    toast(`Loaded ${f.name}`);
    track('tool_action', { tool: 'json-editor', action: 'drop_file' });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'Enter') { e.preventDefault(); mode === 'minifier' ? doMinify() : doFormat(); }
      else if (e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); doCopy(); }
      else if (e.shiftKey && e.key.toLowerCase() === 'm') { e.preventDefault(); doMinify(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  useEffect(() => {
    document.body.style.overflow = full ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [full]);

  const status = !text.trim()
    ? { tone: 'muted', label: 'Waiting for input' }
    : parsed.ok
      ? { tone: 'ok', label: 'Valid JSON' }
      : { tone: 'error', label: `Error on line ${parsed.error.line}, column ${parsed.error.column}` };

  return (
    <div
      class={
        'flex flex-col overflow-hidden rounded-xl border border-line-strong bg-surface ' +
        (full ? 'fixed inset-0 z-[60] rounded-none' : 'h-[min(72vh,760px)] min-h-[480px]')
      }
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-2.5 py-2">
        {mode !== 'minifier' && (
          <button type="button" class="btn-primary btn-sm" onClick={doFormat} title="Ctrl+Enter">
            Format
          </button>
        )}
        {(mode === 'editor' || mode === 'minifier') && (
          <button type="button" class={mode === 'minifier' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={doMinify} title="Ctrl+Shift+M">
            Minify
          </button>
        )}
        <button type="button" class={mode === 'validator' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={doValidate}>
          Validate
        </button>
        {mode !== 'minifier' && (
          <>
            <label class="ml-1 flex items-center gap-1.5 text-xs text-ink-2">
              Indent
              <select
                class="select h-8 w-24 py-0 text-xs"
                value={String(indent)}
                onChange={(e) => {
                  const v = (e.target as HTMLSelectElement).value;
                  setIndent(v === 'tab' ? 'tab' : (Number(v) as Indent));
                }}
              >
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
                <option value="tab">Tabs</option>
              </select>
            </label>
            <label class="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" class="accent-brand-600" checked={sortKeys} onChange={(e) => setSortKeys((e.target as HTMLInputElement).checked)} />
              Sort keys
            </label>
          </>
        )}
        <span class="flex-1" />
        <button type="button" class="btn-ghost btn-sm" onClick={doSample}>Sample</button>
        <button type="button" class="btn-ghost btn-sm" onClick={doClear}>Clear</button>
        <button type="button" class="btn-secondary btn-sm" onClick={doCopy} title="Ctrl+Shift+C">Copy</button>
        <button type="button" class="btn-secondary btn-sm" onClick={doDownload}>Download</button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => setFull(!full)} aria-pressed={full}>
          {full ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>

      {/* Panes */}
      <div class={'grid min-h-0 flex-1 ' + (twoPane ? 'grid-rows-2 md:grid-cols-2 md:grid-rows-1' : '')}>
        <div class="relative min-h-0 overflow-hidden" ref={hostRef} />
        {twoPane && (
          <div class="relative min-h-0 border-t border-line md:border-l md:border-t-0">
            <div class="absolute left-3 top-2 z-10 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-3">
              {mode === 'minifier' ? 'Minified' : 'Formatted'} output
            </div>
            <textarea
              class="h-full w-full resize-none bg-surface p-3 pt-8 font-mono text-[13px] leading-5 text-ink outline-none"
              readOnly
              value={output}
              placeholder={parsed.ok ? '' : 'Output appears here once the input is valid JSON'}
              spellcheck={false}
            />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface-2 px-3 py-1.5 text-xs">
        <span class="flex items-center gap-1.5">
          <span
            class={
              'inline-block h-2 w-2 rounded-full ' +
              (status.tone === 'ok' ? 'bg-success' : status.tone === 'error' ? 'bg-danger' : 'bg-line-strong')
            }
          />
          {status.tone === 'error' ? (
            <button type="button" class="text-danger underline-offset-2 hover:underline" onClick={jumpToError}>
              {status.label}
            </button>
          ) : (
            <span class={status.tone === 'ok' ? 'text-ink-2' : 'text-ink-3'}>{status.label}</span>
          )}
        </span>
        {error && <span class="text-ink-2">{error.message}{error.hint ? ` - ${error.hint}` : ''}</span>}
        <span class="flex-1" />
        {stats && (
          <span class="flex flex-wrap gap-x-3 text-ink-3">
            <span>{formatBytes(stats.bytes)}</span>
            <span>{stats.lines} lines</span>
            <span>{stats.keys} keys</span>
            <span>depth {stats.depth}</span>
            {twoPane && output && (
              <span class="text-ink-2">
                output {formatBytes(outBytes)}
                {mode === 'minifier' && stats.bytes > 0 && ` (${Math.round((1 - outBytes / stats.bytes) * 100)}% smaller)`}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
