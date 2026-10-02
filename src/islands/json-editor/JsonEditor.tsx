import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from '@codemirror/commands';
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search';
import { json as jsonLang } from '@codemirror/lang-json';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';

import { Icon } from '../shared/icons';
import { copyText, downloadText, formatBytes, toast, track } from '../shared/toast';
import { Tree, type ExpandSignal } from './Tree';
import {
  SAMPLE_JSON,
  byteLength,
  canRepair,
  deleteAtPath,
  formatJson,
  minifyJson,
  parseJson,
  pathToString,
  repairJson,
  setAtPath,
  sortKeysDeep,
  statsOf,
  type Indent,
  type JsonValue,
  type Path,
} from './json';
import { canShare, clearShareHash, decodeShare, encodeShare, shareUrl } from './share';
import { AiError, GEMINI_MODELS, PROMPTS, generate, loadKey, loadModel, saveKey, saveModel, type GeminiModel } from './ai';

export type Mode = 'editor' | 'formatter' | 'validator' | 'minifier';
type View = 'code' | 'tree' | 'split' | 'output';

interface Props {
  mode?: Mode;
}

const DRAFT_KEY = 'cuis-json-doc:v2';
const PREFS_KEY = 'cuis-json-prefs:v2';
const MAX_FILE = 25 * 1024 * 1024;

interface Prefs {
  indent: Indent;
  wrap: boolean;
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { indent: p.indent === 4 || p.indent === 'tab' ? p.indent : 2, wrap: p.wrap !== false };
  } catch {
    return { indent: 2, wrap: true };
  }
}

const DEFAULT_VIEW: Record<Mode, View> = { editor: 'split', formatter: 'output', validator: 'code', minifier: 'output' };

export default function JsonEditor({ mode = 'editor' }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const outHostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const outViewRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const tabComp = useRef(new Compartment());
  const wrapComp = useRef(new Compartment());
  const prefs0 = useRef(loadPrefs());

  const [text, setText] = useState('');
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 768 && DEFAULT_VIEW[mode] === 'split' ? 'code' : DEFAULT_VIEW[mode]));
  const [indent, setIndent] = useState<Indent>(prefs0.current.indent);
  const [wrap, setWrap] = useState(prefs0.current.wrap);
  const [outputCompact, setOutputCompact] = useState(mode === 'minifier');
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<Path | null>(null);
  const [treeSearch, setTreeSearch] = useState('');
  const [expandSignal, setExpandSignal] = useState<ExpandSignal>({ kind: 'default', n: 0 });
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [saved, setSaved] = useState(false);
  const [modal, setModal] = useState<null | 'url' | 'shortcuts'>(null);
  const [aiOpen, setAiOpen] = useState(false);

  const parsed = useMemo(() => parseJson(text), [text]);
  const stats = useMemo(() => (parsed.ok ? statsOf(text, parsed.value) : null), [parsed, text]);
  const repairable = useMemo(() => !parsed.ok && text.trim().length > 0 && text.length < 2_000_000 && canRepair(text), [parsed, text]);
  const output = useMemo(() => {
    if (!parsed.ok) return '';
    return outputCompact ? minifyJson(parsed.value) : formatJson(parsed.value, indent);
  }, [parsed, indent, outputCompact]);

  // ---------------------------------------------------------------- editor mount
  useEffect(() => {
    if (!hostRef.current) return;
    const jsonLinter = linter(
      (v) => {
        const doc = v.state.doc.toString();
        if (!doc.trim()) return [];
        const res = parseJson(doc);
        if (res.ok) return [];
        const from = Math.min(res.error.offset, doc.length);
        const d: Diagnostic = {
          from,
          to: Math.min(from + 1, doc.length),
          severity: 'error',
          message: res.error.message + (res.error.hint ? `\n${res.error.hint}` : ''),
        };
        return [d];
      },
      { delay: 200 },
    );

    const state = EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        EditorState.allowMultipleSelections.of(true),
        history(),
        foldGutter(),
        bracketMatching(),
        indentOnInput(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        jsonLang(),
        jsonLinter,
        lintGutter(),
        tabComp.current.of(EditorState.tabSize.of(prefs0.current.indent === 'tab' ? 4 : prefs0.current.indent)),
        wrapComp.current.of(prefs0.current.wrap ? EditorView.lineWrapping : []),
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
        cmPlaceholder('Paste JSON, drop a .json file, or press Sample'),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) setText(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            setCursor({ line: line.number, col: head - line.from + 1 });
          }
        }),
      ],
    });
    const v = new EditorView({ state, parent: hostRef.current });
    viewRef.current = v;

    // Initial document: shared link > saved draft > empty
    (async () => {
      const fromLink = await decodeShare(location.hash);
      if (fromLink !== null) {
        setDoc(fromLink);
        clearShareHash();
        toast('Loaded JSON from the shared link');
        return;
      }
      try {
        const draft = localStorage.getItem(DRAFT_KEY);
        if (draft) {
          setDoc(draft);
          toast('Draft restored from your last visit');
        }
      } catch {}
    })();

    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Output pane: a read-only CodeMirror, mounted only while visible
  useEffect(() => {
    if (view !== 'output' || !outHostRef.current) return;
    const v = new EditorView({
      state: EditorState.create({
        doc: output,
        extensions: [
          lineNumbers(),
          foldGutter(),
          highlightSpecialChars(),
          drawSelection(),
          bracketMatching(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          jsonLang(),
          EditorView.lineWrapping,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          cmPlaceholder('Output appears here once the input is valid JSON'),
        ],
      }),
      parent: outHostRef.current,
    });
    outViewRef.current = v;
    return () => {
      v.destroy();
      outViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    const v = outViewRef.current;
    if (v && v.state.doc.toString() !== output) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: output } });
  }, [output]);

  // Prefs
  useEffect(() => {
    viewRef.current?.dispatch({ effects: tabComp.current.reconfigure(EditorState.tabSize.of(indent === 'tab' ? 4 : indent)) });
    viewRef.current?.dispatch({ effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ indent, wrap }));
    } catch {}
  }, [indent, wrap]);

  // Autosave draft
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      try {
        text ? localStorage.setItem(DRAFT_KEY, text) : localStorage.removeItem(DRAFT_KEY);
        setSaved(true);
      } catch {}
    }, 500);
    return () => clearTimeout(t);
  }, [text]);

  // Full screen body lock + Escape
  useEffect(() => {
    document.body.style.overflow = full ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [full]);

  // ---------------------------------------------------------------- doc helpers
  const setDoc = useCallback((t: string) => {
    const v = viewRef.current;
    if (!v) return;
    if (v.state.doc.toString() === t) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: t } });
  }, []);

  const requireValid = (): JsonValue | null => {
    if (!parsed.ok) {
      if (text.trim()) {
        toast(parsed.error.message, 'error');
        jumpToError();
      } else toast('Nothing to do yet. Paste some JSON first.', 'error');
      return null;
    }
    return parsed.value;
  };

  const jumpToError = () => {
    const v = viewRef.current;
    if (!v || parsed.ok) return;
    const pos = Math.min(parsed.error.offset, v.state.doc.length);
    v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    v.focus();
  };

  // ---------------------------------------------------------------- actions
  const act = {
    format() {
      const v = requireValid();
      if (v === null) return;
      setDoc(formatJson(v, indent));
      track('tool_action', { tool: 'json-editor', action: 'format', indent });
    },
    compact() {
      const v = requireValid();
      if (v === null) return;
      const before = byteLength(text);
      const out = minifyJson(v);
      setDoc(out);
      toast(`Compacted: ${formatBytes(before)} to ${formatBytes(byteLength(out))}`);
      track('tool_action', { tool: 'json-editor', action: 'minify' });
    },
    sort() {
      const v = requireValid();
      if (v === null) return;
      setDoc(formatJson(sortKeysDeep(v), indent));
      toast('Keys sorted A to Z at every level');
      track('tool_action', { tool: 'json-editor', action: 'sort' });
    },
    fix() {
      const fixed = repairJson(text);
      if (!parseJson(fixed).ok) return toast('Automatic fix could not make this valid. Try Fix with AI.', 'error');
      setDoc(fixed);
      toast('Fixed common mistakes. Ctrl+Z to undo.');
      track('tool_action', { tool: 'json-editor', action: 'repair' });
    },
    validate() {
      if (parsed.ok) toast('Valid JSON');
      else {
        toast(`Line ${parsed.error.line}, col ${parsed.error.column}: ${parsed.error.message}`, 'error');
        jumpToError();
      }
      track('tool_action', { tool: 'json-editor', action: 'validate', valid: parsed.ok });
    },
    newDoc() {
      if (!text) return;
      setDoc('');
      setSelected(null);
      viewRef.current?.focus();
      toast('Editor cleared. Ctrl+Z to undo.');
    },
    sample() {
      setDoc(SAMPLE_JSON);
      setSelected(null);
      track('tool_action', { tool: 'json-editor', action: 'sample' });
    },
    openFile() {
      fileRef.current?.click();
    },
    async loadFile(f: File) {
      if (f.size > MAX_FILE) return toast('File is larger than 25 MB', 'error');
      setDoc(await f.text());
      toast(`Loaded ${f.name} (${formatBytes(f.size)})`);
      track('tool_action', { tool: 'json-editor', action: 'open_file' });
    },
    async openUrl(url: string) {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        setDoc(body);
        setModal(null);
        toast('Loaded JSON from URL');
        track('tool_action', { tool: 'json-editor', action: 'open_url' });
      } catch (e) {
        toast(`Could not load that URL (${(e as Error).message}). The server must allow CORS.`, 'error', 4000);
      }
    },
    save() {
      const src = view === 'output' ? output : text;
      if (!src) return toast('Nothing to save yet', 'error');
      downloadText(src, view === 'output' && outputCompact ? 'data.min.json' : 'data.json', 'application/json');
      track('tool_action', { tool: 'json-editor', action: 'download' });
    },
    async copy() {
      const src = view === 'output' ? output : text;
      if (!src) return toast('Nothing to copy yet', 'error');
      (await copyText(src)) ? toast(view === 'output' ? 'Output copied' : 'JSON copied') : toast('Copy failed', 'error');
      track('tool_action', { tool: 'json-editor', action: 'copy' });
    },
    async share() {
      if (!text.trim()) return toast('Nothing to share yet', 'error');
      if (!canShare()) return toast('Your browser does not support share links', 'error');
      const enc = await encodeShare(text);
      if (!enc) return toast('Document is too large for a link (about 12 KB compressed). Download it instead.', 'error', 4000);
      (await copyText(shareUrl(enc))) ? toast('Share link copied. The data lives in the link, not on our servers.', 'ok', 3500) : toast('Copy failed', 'error');
      track('tool_action', { tool: 'json-editor', action: 'share' });
    },
    undo() {
      viewRef.current && undo(viewRef.current);
    },
    redo() {
      viewRef.current && redo(viewRef.current);
    },
    search() {
      viewRef.current && (openSearchPanel(viewRef.current), viewRef.current.focus());
    },
    expandAll: () => setExpandSignal((s) => ({ kind: 'all', n: s.n + 1 })),
    collapseAll: () => setExpandSignal((s) => ({ kind: 'none', n: s.n + 1 })),
    treeEdit(path: Path, value: JsonValue) {
      if (!parsed.ok) return;
      setDoc(formatJson(setAtPath(parsed.value, path, value), indent));
      toast('Value updated');
      track('tool_action', { tool: 'json-editor', action: 'tree_edit' });
    },
    treeDelete(path: Path) {
      if (!parsed.ok) return;
      setDoc(formatJson(deleteAtPath(parsed.value, path), indent));
      setSelected(null);
      toast(`Removed ${pathToString(path)}. Ctrl+Z to undo.`);
    },
  };

  // ---------------------------------------------------------------- shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (e.key === 'Escape') {
        if (modal) return setModal(null);
        if (aiOpen && !typing) return setAiOpen(false);
        if (full) return setFull(false);
        return;
      }
      if (!mod) {
        if (e.key === '?' && !typing && !(typeof target?.closest === 'function' && target.closest('.cm-editor'))) {
          e.preventDefault();
          setModal('shortcuts');
        }
        return;
      }
      const k = e.key.toLowerCase();
      if (e.key === 'Enter') { e.preventDefault(); act.format(); }
      else if (e.shiftKey && k === 'm') { e.preventDefault(); act.compact(); }
      else if (e.shiftKey && k === 'c') { e.preventDefault(); act.copy(); }
      else if (e.shiftKey && k === 'l') { e.preventDefault(); act.share(); }
      else if (e.shiftKey && k === 'x') { e.preventDefault(); repairable && act.fix(); }
      else if (k === 's') { e.preventDefault(); act.save(); }
      else if (k === 'o') { e.preventDefault(); act.openFile(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------------------------------------------------------------- drag & drop
  const [dragging, setDragging] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) act.loadFile(f);
  };

  // ---------------------------------------------------------------- render
  const invalid = !parsed.ok && text.trim().length > 0;
  const showTree = view === 'tree' || view === 'split';
  const showCode = view !== 'tree';
  const title: Record<Mode, string> = { editor: 'JSON Editor', formatter: 'JSON Formatter', validator: 'JSON Validator', minifier: 'JSON Minifier' };

  return (
    <div
      class={
        'relative flex flex-col overflow-hidden border border-line-strong bg-surface text-ink shadow-sm ' +
        (full ? 'fixed inset-0 z-[60]' : 'h-[min(78vh,880px)] min-h-[560px] rounded-xl')
      }
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" class="hidden" onChange={(e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (f) act.loadFile(f);
        (e.target as HTMLInputElement).value = '';
      }} />

      {/* Row 1: file bar */}
      <div class="flex flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-2 py-1.5">
        <span class="mr-2 hidden items-center gap-2 pl-1 text-sm font-semibold sm:flex">
          <Icon name="code" size={16} class="text-brand-600" />
          {title[mode]}
        </span>
        <TBtn icon="file-plus" label="New" title="Clear the editor" onClick={act.newDoc} />
        <TBtn icon="folder-open" label="Open" title="Open a .json file (Ctrl+O)" onClick={act.openFile} />
        <TBtn icon="link" label="From URL" title="Load JSON from a URL" onClick={() => setModal('url')} />
        <TBtn icon="download" label="Save" title="Download as .json (Ctrl+S)" onClick={act.save} />
        <TBtn icon="copy" label="Copy" title="Copy to clipboard (Ctrl+Shift+C)" onClick={act.copy} />
        <TBtn icon="share" label="Share" title="Copy a link that contains this JSON (Ctrl+Shift+L)" onClick={act.share} />
        <span class="flex-1" />
        <TBtn icon="sparkles" label="AI" title="AI assist with your own Gemini key" onClick={() => setAiOpen((o) => !o)} active={aiOpen} accent />
        <TBtn icon="keyboard" title="Keyboard shortcuts (?)" onClick={() => setModal('shortcuts')} />
        <TBtn icon={full ? 'minimize' : 'maximize'} title={full ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFull((f) => !f)} />
      </div>

      {/* Row 2: edit bar */}
      <div class="flex flex-wrap items-center gap-x-1 gap-y-1.5 border-b border-line bg-surface px-2 py-1.5">
        <Seg
          value={view}
          onChange={(v) => setView(v as View)}
          options={[
            { value: 'code', label: 'Code', icon: 'code' },
            { value: 'tree', label: 'Tree', icon: 'list-tree' },
            { value: 'split', label: 'Split', icon: 'columns' },
            { value: 'output', label: 'Output', icon: 'panel-right' },
          ]}
        />
        <Divider />
        <TBtn icon="align-left" label="Format" title="Pretty print (Ctrl+Enter)" onClick={act.format} primary={mode !== 'minifier'} />
        <TBtn icon="minimize-2" label="Compact" title="Remove all whitespace (Ctrl+Shift+M)" onClick={act.compact} primary={mode === 'minifier'} />
        <TBtn icon="arrow-down-az" label="Sort" title="Sort keys A to Z at every level" onClick={act.sort} />
        {repairable && <TBtn icon="wand" label="Fix" title="Fix comments, quotes, trailing commas (Ctrl+Shift+X)" onClick={act.fix} accent />}
        {mode === 'validator' && <TBtn icon="check" label="Validate" title="Check the document now" onClick={act.validate} primary />}
        <Divider />
        <label class="flex items-center gap-1.5 text-xs text-ink-2">
          <span class="hidden sm:inline">Indent</span>
          <select
            class="select h-7 w-[6.5rem] py-0 text-xs"
            value={String(indent)}
            onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              setIndent(v === 'tab' ? 'tab' : (Number(v) as Indent));
            }}
            aria-label="Indentation"
          >
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
            <option value="tab">Tabs</option>
          </select>
        </label>
        <TBtn icon="wrap-text" title={wrap ? 'Disable line wrap' : 'Enable line wrap'} onClick={() => setWrap((w) => !w)} active={wrap} />
        <TBtn icon="search" title="Find in code (Ctrl+F)" onClick={act.search} />
        <Divider />
        <TBtn icon="undo" title="Undo (Ctrl+Z)" onClick={act.undo} />
        <TBtn icon="redo" title="Redo (Ctrl+Y)" onClick={act.redo} />
        {showTree && (
          <>
            <Divider />
            <TBtn icon="chevrons-up-down" title="Expand all" onClick={act.expandAll} />
            <TBtn icon="chevrons-down-up" title="Collapse all" onClick={act.collapseAll} />
          </>
        )}
        <span class="flex-1" />
        {!text && <TBtn icon="sparkles" label="Sample" title="Load sample JSON" onClick={act.sample} />}
        {text && <TBtn icon="eraser" label="Clear" title="Clear the editor" onClick={act.newDoc} />}
      </div>

      {/* Error banner */}
      {invalid && (
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-danger/30 bg-danger/8 px-3 py-1.5 text-[13px]" role="alert">
          <Icon name="alert-circle" size={15} class="shrink-0 text-danger" />
          <button type="button" class="font-medium text-danger underline-offset-2 hover:underline" onClick={jumpToError}>
            Line {parsed.ok ? '' : parsed.error.line}, col {parsed.ok ? '' : parsed.error.column}
          </button>
          <span class="text-ink">{!parsed.ok && parsed.error.message}</span>
          {!parsed.ok && parsed.error.hint && <span class="text-ink-2">{parsed.error.hint}</span>}
          <span class="flex-1" />
          {repairable && (
            <button type="button" class="btn-secondary btn-sm h-7" onClick={act.fix}>
              <Icon name="wand" size={13} /> Fix automatically
            </button>
          )}
          <button type="button" class="btn-ghost btn-sm h-7" onClick={() => setAiOpen(true)}>
            <Icon name="sparkles" size={13} /> Fix with AI
          </button>
        </div>
      )}

      {/* Workspace */}
      <div class="relative flex min-h-0 flex-1">
        <div class={'grid min-h-0 flex-1 ' + (view === 'split' || view === 'output' ? 'grid-rows-2 md:grid-cols-2 md:grid-rows-1' : '')}>
          {showCode && <div ref={hostRef} class="relative min-h-0 overflow-hidden" />}
          {showTree && (
            <div class={'flex min-h-0 flex-col ' + (view === 'split' ? 'border-t border-line md:border-l md:border-t-0' : '')}>
              <div class="flex items-center gap-2 border-b border-line bg-surface-2 px-2 py-1">
                <Icon name="search" size={14} class="shrink-0 text-ink-3" />
                <input
                  type="search"
                  class="h-7 min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
                  placeholder="Filter keys and values"
                  value={treeSearch}
                  onInput={(e) => setTreeSearch((e.target as HTMLInputElement).value)}
                  aria-label="Filter tree"
                />
                {selected && (
                  <button
                    type="button"
                    class="hidden max-w-[50%] truncate rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2 hover:text-ink sm:block"
                    title="Copy path"
                    onClick={async () => (await copyText(pathToString(selected))) && toast('Path copied')}
                  >
                    {pathToString(selected)}
                  </button>
                )}
              </div>
              <div class="min-h-0 flex-1">
                {parsed.ok ? (
                  <Tree
                    value={parsed.value}
                    search={treeSearch}
                    selected={selected}
                    onSelect={setSelected}
                    onEdit={act.treeEdit}
                    onDelete={act.treeDelete}
                    expandSignal={expandSignal}
                  />
                ) : (
                  <Empty icon={invalid ? 'alert-circle' : 'list-tree'} text={invalid ? 'Fix the syntax error to see the tree' : 'The tree appears here once you add JSON'} />
                )}
              </div>
              {parsed.ok && <p class="border-t border-line px-3 py-1 text-[11px] text-ink-3">Double-click a value to edit it. Del removes the selected node. Arrow keys expand and collapse.</p>}
            </div>
          )}
          {view === 'output' && (
            <div class="flex min-h-0 flex-col border-t border-line md:border-l md:border-t-0">
              <div class="flex items-center gap-1 border-b border-line bg-surface-2 px-2 py-1 text-xs">
                <span class="mr-1 font-medium text-ink-2">Output</span>
                <Seg
                  small
                  value={outputCompact ? 'compact' : 'formatted'}
                  onChange={(v) => setOutputCompact(v === 'compact')}
                  options={[
                    { value: 'formatted', label: 'Formatted' },
                    { value: 'compact', label: 'Compact' },
                  ]}
                />
                <span class="flex-1" />
                {output && <span class="text-ink-3">{formatBytes(byteLength(output))}{stats && outputCompact && stats.bytes > 0 ? ` · ${Math.round((1 - byteLength(output) / stats.bytes) * 100)}% smaller` : ''}</span>}
              </div>
              <div ref={outHostRef} class="relative min-h-0 flex-1 overflow-hidden" />
            </div>
          )}
        </div>

        {aiOpen && (
          <AiPanel
            text={text}
            valid={parsed.ok}
            error={parsed.ok ? null : parsed.error.message}
            onClose={() => setAiOpen(false)}
            onApply={(t) => {
              setDoc(t);
              toast('Applied AI result. Ctrl+Z to undo.');
            }}
          />
        )}

        {dragging && (
          <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-brand-600/10 backdrop-blur-[1px]">
            <div class="rounded-lg border-2 border-dashed border-brand-500 bg-surface px-6 py-4 text-sm font-medium text-brand-700 dark:text-brand-300">Drop a .json file to open it</div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-surface-2 px-3 py-1 text-[12px]">
        <span class="flex items-center gap-1.5">
          <span class={'inline-block h-2 w-2 rounded-full ' + (!text.trim() ? 'bg-line-strong' : parsed.ok ? 'bg-success' : 'bg-danger')} />
          {!text.trim() ? <span class="text-ink-3">Waiting for input</span> : parsed.ok ? <span class="font-medium text-ink-2">Valid JSON</span> : <button type="button" class="font-medium text-danger hover:underline" onClick={jumpToError}>Invalid JSON</button>}
        </span>
        {stats && (
          <span class="flex flex-wrap gap-x-3 text-ink-3">
            <span>{stats.items.toLocaleString()} items</span>
            <span>{stats.keys.toLocaleString()} keys</span>
            <span>depth {stats.depth}</span>
            <span>{formatBytes(stats.bytes)}</span>
            <span>{stats.lines.toLocaleString()} lines</span>
          </span>
        )}
        {!stats && text && <span class="text-ink-3">{formatBytes(byteLength(text))} · {text.split('\n').length} lines</span>}
        <span class="flex-1" />
        <span class="text-ink-3">Ln {cursor.line}, Col {cursor.col}</span>
        <span class={'flex items-center gap-1 ' + (saved ? 'text-ink-3' : 'text-ink-3/60')} title="Your draft is kept in this browser only">
          <Icon name="lock" size={11} /> {saved ? 'Saved locally' : 'Saving'}
        </span>
      </div>

      {/* Modals */}
      {modal === 'url' && <UrlModal onClose={() => setModal(null)} onLoad={act.openUrl} />}
      {modal === 'shortcuts' && <ShortcutsModal onClose={() => setModal(null)} />}
    </div>
  );
}

// ---------------------------------------------------------------- small components

function TBtn({ icon, label, title, onClick, active, primary, accent }: { icon: string; label?: string; title: string; onClick: () => void; active?: boolean; primary?: boolean; accent?: boolean }) {
  const base = 'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors ';
  const look = primary
    ? 'bg-brand-600 text-white hover:bg-brand-700'
    : accent
      ? 'text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/40 ' + (active ? 'bg-brand-50 dark:bg-brand-900/40' : '')
      : active
        ? 'bg-surface-3 text-ink'
        : 'text-ink-2 hover:bg-surface-3 hover:text-ink';
  return (
    <button type="button" class={base + look + (label ? '' : ' w-7 justify-center px-0')} title={title} aria-label={label ? undefined : title} aria-pressed={active} onClick={onClick}>
      <Icon name={icon} size={14} />
      {label && <span class={label === 'New' || label === 'Open' || label === 'Save' || label === 'Copy' ? '' : 'hidden sm:inline'}>{label}</span>}
    </button>
  );
}

function Seg({ value, onChange, options, small }: { value: string; onChange: (v: string) => void; options: { value: string; label: string; icon?: string }[]; small?: boolean }) {
  return (
    <div class={'inline-flex rounded-md border border-line bg-surface-2 p-0.5 ' + (small ? 'h-6' : 'h-7')} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          class={
            'inline-flex items-center gap-1.5 rounded px-2 font-medium transition-colors ' +
            (small ? 'text-[11px]' : 'text-[12.5px]') +
            (value === o.value ? ' bg-surface text-ink shadow-sm' : ' text-ink-3 hover:text-ink')
          }
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={13} />}
          <span class={o.icon ? 'hidden sm:inline' : ''}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

const Divider = () => <span class="mx-1 hidden h-5 w-px bg-line sm:block" />;

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-3">
      <Icon name={icon} size={22} />
      {text}
    </div>
  );
}

function Modal({ title, onClose, children, width = 'max-w-md' }: { title: string; onClose: () => void; children: ComponentChildren; width?: string }) {
  return (
    <div class="absolute inset-0 z-20 flex items-start justify-center bg-black/30 p-4 pt-[8vh] backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div class={'w-full rounded-xl border border-line-strong bg-surface shadow-float ' + width} onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 class="text-sm font-semibold">{title}</h3>
          <button type="button" class="btn-ghost btn-icon h-7 w-7" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div class="p-4">{children}</div>
      </div>
    </div>
  );
}

function UrlModal({ onClose, onLoad }: { onClose: () => void; onLoad: (url: string) => Promise<void> }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!/^https?:\/\//i.test(url.trim())) return toast('Enter a full URL starting with https://', 'error');
    setBusy(true);
    await onLoad(url.trim());
    setBusy(false);
  };
  return (
    <Modal title="Open JSON from a URL" onClose={onClose}>
      <form onSubmit={submit} class="space-y-3">
        <input class="input" type="url" placeholder="https://api.example.com/data.json" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} autoFocus required />
        <p class="text-xs text-ink-3">Your browser fetches the URL directly. The server must allow cross-origin requests (CORS). Nothing is sent to Cuisdev.</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" class="btn-primary btn-sm" disabled={busy}>
            {busy && <Icon name="loader" size={13} class="animate-spin" />} Load
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Ctrl + Enter', 'Format'],
    ['Ctrl + Shift + M', 'Compact'],
    ['Ctrl + Shift + X', 'Fix common mistakes'],
    ['Ctrl + Shift + C', 'Copy'],
    ['Ctrl + Shift + L', 'Copy share link'],
    ['Ctrl + S', 'Download .json'],
    ['Ctrl + O', 'Open file'],
    ['Ctrl + F', 'Find and replace in code'],
    ['Ctrl + Z / Ctrl + Y', 'Undo / Redo'],
    ['Ctrl + D', 'Select next occurrence'],
    ['Alt + Up / Down', 'Move line'],
    ['Tree: Enter', 'Edit selected value'],
    ['Tree: Del', 'Delete selected node'],
    ['Tree: Left / Right', 'Collapse / expand'],
    ['Esc', 'Close dialogs, exit full screen'],
    ['?', 'This list'],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width="max-w-lg">
      <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, d]) => (
          <>
            <dt class="whitespace-nowrap">{k.split(' + ').map((p, i) => <><span class="kbd">{p}</span>{i < k.split(' + ').length - 1 && <span class="mx-0.5 text-ink-3">+</span>}</>)}</dt>
            <dd class="text-ink-2">{d}</dd>
          </>
        ))}
      </dl>
      <p class="mt-4 text-xs text-ink-3">On macOS use Cmd instead of Ctrl.</p>
    </Modal>
  );
}

// ---------------------------------------------------------------- AI panel

function AiPanel({ text, valid, error, onClose, onApply }: { text: string; valid: boolean; error: string | null; onClose: () => void; onApply: (t: string) => void }) {
  const [key, setKey] = useState(loadKey);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState<GeminiModel>(loadModel);
  const [prompt, setPrompt] = useState('');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'text' | 'json'; value: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => saveKey(key), [key]);
  useEffect(() => saveModel(model), [model]);

  const run = async (label: string, p: string, json: boolean) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(label);
    setResult(null);
    try {
      const out = await generate({ apiKey: key, model, prompt: p, json, signal: ctl.signal });
      if (json) {
        const check = parseJson(out);
        if (check.ok) {
          onApply(formatJson(check.value, 2));
          setResult(null);
        } else setResult({ kind: 'json', value: out });
      } else setResult({ kind: 'text', value: out });
      track('tool_action', { tool: 'json-editor', action: `ai_${label.toLowerCase()}` });
    } catch (e) {
      toast(e instanceof AiError ? e.message : 'AI request failed', 'error', 4000);
    } finally {
      setBusy(null);
    }
  };

  const hasKey = key.trim().length > 10;
  const hasDoc = text.trim().length > 0;

  return (
    <aside class="flex w-full max-w-[22rem] shrink-0 flex-col border-l border-line bg-surface-2" aria-label="AI assist">
      <div class="flex items-center justify-between border-b border-line px-3 py-2">
        <h3 class="flex items-center gap-1.5 text-sm font-semibold"><Icon name="sparkles" size={15} class="text-brand-600" /> AI assist</h3>
        <button type="button" class="btn-ghost btn-icon h-7 w-7" onClick={onClose} aria-label="Close AI panel"><Icon name="x" size={15} /></button>
      </div>
      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-sm scrollbar-thin">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-ink-2" for="gemini-key">Your Gemini API key</label>
          <div class="flex gap-1">
            <input id="gemini-key" class="input h-8 text-xs" type={showKey ? 'text' : 'password'} value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} placeholder="AIza..." autocomplete="off" spellcheck={false} />
            <button type="button" class="btn-secondary btn-icon h-8 w-8" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? 'Hide key' : 'Show key'}><Icon name="eye-off" size={14} /></button>
          </div>
          <div class="flex items-center justify-between gap-2">
            <select class="select h-7 flex-1 py-0 text-xs" value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value as GeminiModel)} aria-label="Model">
              {GEMINI_MODELS.map((m) => <option value={m}>{m}</option>)}
            </select>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" class="whitespace-nowrap text-xs text-brand-600 hover:underline">Get a free key</a>
          </div>
          <p class="text-[11px] leading-4 text-ink-3">Stored only in this browser. Requests go straight from your browser to Google. Nothing passes through Cuisdev.</p>
        </div>

        <Section title="Generate JSON">
          <textarea class="input h-20 resize-none py-1.5 text-xs" placeholder="Describe the JSON you want, e.g. 5 products with id, name, price and tags" value={prompt} onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)} />
          <AiBtn label="Generate" busy={busy} disabled={!hasKey || !prompt.trim()} onClick={() => run('Generate', PROMPTS.generate(prompt), true)} />
        </Section>

        <Section title="Transform current JSON">
          <textarea class="input h-16 resize-none py-1.5 text-xs" placeholder="e.g. rename userName to name, add an email to every user" value={instruction} onInput={(e) => setInstruction((e.target as HTMLTextAreaElement).value)} />
          <AiBtn label="Transform" busy={busy} disabled={!hasKey || !valid || !instruction.trim()} onClick={() => run('Transform', PROMPTS.transform(text, instruction), true)} />
        </Section>

        <div class="grid grid-cols-2 gap-2">
          <AiBtn label="Fix with AI" busy={busy} disabled={!hasKey || valid || !hasDoc} onClick={() => run('Fix', PROMPTS.fix(text, error ?? 'invalid JSON'), true)} />
          <AiBtn label="Explain" busy={busy} disabled={!hasKey || !valid} onClick={() => run('Explain', PROMPTS.explain(text), false)} secondary />
        </div>
        {busy && (
          <button type="button" class="btn-ghost btn-sm w-full" onClick={() => abortRef.current?.abort()}>Cancel request</button>
        )}

        {result && (
          <div class="rounded-md border border-line bg-surface p-2.5">
            {result.kind === 'text' ? (
              <p class="whitespace-pre-wrap text-[13px] leading-5 text-ink-2">{result.value}</p>
            ) : (
              <>
                <p class="mb-1.5 text-xs text-danger">The model returned something that is not valid JSON:</p>
                <pre class="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-2">{result.value}</pre>
                <button type="button" class="btn-secondary btn-sm mt-2" onClick={() => onApply(result.value)}>Insert anyway</button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="space-y-1.5">
      <h4 class="text-xs font-medium text-ink-2">{title}</h4>
      {children}
    </div>
  );
}

function AiBtn({ label, busy, disabled, onClick, secondary }: { label: string; busy: string | null; disabled: boolean; onClick: () => void; secondary?: boolean }) {
  const running = busy === label || (busy && label === 'Fix with AI' && busy === 'Fix');
  return (
    <button type="button" class={(secondary ? 'btn-secondary' : 'btn-primary') + ' btn-sm w-full'} disabled={disabled || !!busy} onClick={onClick}>
      {running ? <Icon name="loader" size={13} class="animate-spin" /> : <Icon name="sparkles" size={13} />}
      {label}
    </button>
  );
}
