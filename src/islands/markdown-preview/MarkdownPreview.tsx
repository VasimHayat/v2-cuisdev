/**
 * Markdown Preview workspace: editor on the left, sanitised live preview on the right,
 * with formatting buttons, synced scrolling, an HTML source view and exports.
 * marked renders, DOMPurify sanitises, links open in a new tab with rel=noopener.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import DOMPurify from 'dompurify';
import { EditorView } from '@codemirror/view';
import { html as htmlLang } from '@codemirror/lang-html';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  MAX_DRAFT_BYTES,
  SAMPLE,
  SANITIZE_CONFIG,
  applyFormat,
  describeStats,
  extractTitle,
  hardenLinks,
  markdownStats,
  renderMarkdown,
  standaloneHtml,
  toFileName,
  type FormatKind,
} from './logic';

const TOOL = 'markdown-preview';
const DRAFT_KEY = 'cuis-md:draft';
const PREFS_KEY = 'cuis-md:prefs';
type View = 'split' | 'editor' | 'preview' | 'html';

let hooked = false;
function sanitize(html: string): string {
  if (!hooked) {
    DOMPurify.addHook('afterSanitizeAttributes', (node) => hardenLinks(node as unknown as Element));
    hooked = true;
  }
  return DOMPurify.sanitize(html, { ...SANITIZE_CONFIG, USE_PROFILES: { html: true }, FORBID_TAGS: [...SANITIZE_CONFIG.FORBID_TAGS], FORBID_ATTR: [...SANITIZE_CONFIG.FORBID_ATTR], ADD_ATTR: ['target'] }) as string;
}

function loadDraft(): string {
  try {
    const d = localStorage.getItem(DRAFT_KEY);
    return d ?? SAMPLE;
  } catch {
    return SAMPLE;
  }
}

function loadPrefs(): { view: View; breaks: boolean; sync: boolean } {
  const d = { view: 'split' as View, breaks: false, sync: true };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<typeof d> | null;
    if (!raw) return d;
    if (raw.view === 'split' || raw.view === 'editor' || raw.view === 'preview' || raw.view === 'html') d.view = raw.view;
    if (typeof raw.breaks === 'boolean') d.breaks = raw.breaks;
    if (typeof raw.sync === 'boolean') d.sync = raw.sync;
  } catch {}
  return d;
}

const BUTTONS: { kind: FormatKind; label: string; title: string; mono?: boolean }[] = [
  { kind: 'bold', label: 'B', title: 'Bold (Ctrl+B)' },
  { kind: 'italic', label: 'I', title: 'Italic (Ctrl+I)' },
  { kind: 'strike', label: 'S', title: 'Strikethrough' },
  { kind: 'heading', label: 'H', title: 'Heading' },
  { kind: 'link', label: 'Link', title: 'Link (Ctrl+K)' },
  { kind: 'code', label: '`c`', title: 'Inline code', mono: true },
  { kind: 'codeblock', label: '```', title: 'Code block', mono: true },
  { kind: 'list', label: '•', title: 'Bulleted list' },
  { kind: 'ordered', label: '1.', title: 'Numbered list' },
  { kind: 'task', label: '[ ]', title: 'Task list', mono: true },
  { kind: 'quote', label: '❝', title: 'Quote' },
];

export default function MarkdownPreview() {
  const rootRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const syncing = useRef(false);
  const [text, setText] = useState(loadDraft);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [full, setFull] = useState(false);
  const [debounced, setDebounced] = useState(text);
  const view = prefs.view;
  const update = (patch: Partial<typeof prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  // Debounce rendering slightly for large documents; save the draft
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(text);
      try {
        if (new TextEncoder().encode(text).length <= MAX_DRAFT_BYTES) localStorage.setItem(DRAFT_KEY, text);
        else localStorage.removeItem(DRAFT_KEY);
      } catch {}
    }, text.length > 20_000 ? 250 : 60);
    return () => clearTimeout(t);
  }, [text]);

  const safeHtml = useMemo(() => {
    try {
      return sanitize(renderMarkdown(debounced, { breaks: prefs.breaks }));
    } catch {
      return '<p>Could not render this Markdown.</p>';
    }
  }, [debounced, prefs.breaks]);
  const stats = useMemo(() => markdownStats(text), [text]);
  const title = useMemo(() => extractTitle(text), [text]);
  const htmlExt = useMemo(() => htmlLang(), []);

  // ------------------------------------------------------------------ editor access

  const getView = (): EditorView | null => {
    const el = editorHostRef.current?.querySelector('.cm-editor');
    return el ? EditorView.findFromDOM(el as HTMLElement) : null;
  };

  const format = (kind: FormatKind) => {
    const cm = getView();
    if (!cm) {
      // Fallback when the editor is hidden: apply to the end of the document.
      const e = applyFormat(text, text.length, text.length, kind);
      setText(e.text);
      return;
    }
    const { from, to } = cm.state.selection.main;
    const doc = cm.state.doc.toString();
    const e = applyFormat(doc, from, to, kind);
    cm.dispatch({ changes: { from: 0, to: doc.length, insert: e.text }, selection: { anchor: e.from, head: e.to } });
    cm.focus();
    track('tool_action', { tool: TOOL, action: 'format', kind });
  };

  // Synced scrolling (proportional)
  useEffect(() => {
    if (view !== 'split' || !prefs.sync) return;
    const scroller = editorHostRef.current?.querySelector<HTMLElement>('.cm-scroller');
    const preview = previewRef.current;
    if (!scroller || !preview) return;
    const link = (src: HTMLElement, dst: HTMLElement) => () => {
      if (syncing.current) {
        syncing.current = false;
        return;
      }
      const max = src.scrollHeight - src.clientHeight;
      const ratio = max > 0 ? src.scrollTop / max : 0;
      syncing.current = true;
      dst.scrollTop = ratio * (dst.scrollHeight - dst.clientHeight);
    };
    const a = link(scroller, preview);
    const b = link(preview, scroller);
    scroller.addEventListener('scroll', a, { passive: true });
    preview.addEventListener('scroll', b, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', a);
      preview.removeEventListener('scroll', b);
    };
  }, [view, prefs.sync, debounced]);

  // ------------------------------------------------------------------ actions

  const copyHtml = async () => {
    if (!safeHtml) return;
    const ok = await copyText(safeHtml);
    toast(ok ? 'HTML copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy_html' });
  };
  const copyMd = async () => {
    const ok = await copyText(text);
    toast(ok ? 'Markdown copied' : 'Copy failed', ok ? 'ok' : 'error');
  };
  const downloadMd = () => {
    downloadText(text, toFileName(title, 'md'), 'text/markdown');
    track('tool_action', { tool: TOOL, action: 'download_md' });
  };
  const downloadHtml = () => {
    downloadText(standaloneHtml(safeHtml, title), toFileName(title, 'html'), 'text/html');
    track('tool_action', { tool: TOOL, action: 'download_html' });
  };
  const openFile = async (f: File) => {
    if (f.size > 5 * 1024 * 1024) {
      toast('File is larger than 5 MB', 'error');
      return;
    }
    setText(await f.text());
    toast(`Opened ${f.name}`);
    track('tool_action', { tool: TOOL, action: 'open_file' });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const inEditor = !!(e.target as HTMLElement).closest?.('.cm-editor');
      if (meta && inEditor && !e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        format('bold');
      } else if (meta && inEditor && !e.shiftKey && (e.key === 'i' || e.key === 'I')) {
        e.preventDefault();
        format('italic');
      } else if (meta && inEditor && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        format('link');
      } else if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copyHtml();
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

  const showEditor = view === 'split' || view === 'editor';
  const showRight = view !== 'editor';
  const two = view === 'split';

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      <style>{PREVIEW_CSS}</style>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.markdown,.mdown,.txt,text/markdown,text/plain"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void openFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={view}
          onChange={(v) => update({ view: v })}
          options={[
            { value: 'split', label: 'Split', icon: 'columns' },
            { value: 'editor', label: 'Editor', icon: 'pencil' },
            { value: 'preview', label: 'Preview', icon: 'eye' },
            { value: 'html', label: 'HTML', icon: 'code' },
          ]}
          label="View"
        />
        <div class="flex flex-wrap items-center gap-0.5" role="toolbar" aria-label="Formatting">
          {BUTTONS.map((b) => (
            <button
              key={b.kind}
              type="button"
              class={'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink disabled:opacity-40 ' + (b.mono ? 'font-mono text-[11px]' : '') + (b.kind === 'bold' ? ' font-bold' : '') + (b.kind === 'italic' ? ' italic' : '') + (b.kind === 'strike' ? ' line-through' : '')}
              title={b.title}
              aria-label={b.title}
              disabled={!showEditor}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => format(b.kind)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <Chip on={prefs.breaks} onClick={() => update({ breaks: !prefs.breaks })} title="Treat single line breaks as <br>">
          Line breaks
        </Chip>
        {two && (
          <Chip on={prefs.sync} onClick={() => update({ sync: !prefs.sync })} title="Scroll the preview with the editor">
            Sync scroll
          </Chip>
        )}
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={() => setText(SAMPLE)} title="Load the sample document">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => setText('')} disabled={!text} title="Clear the document">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      <div class={'grid min-h-0 flex-1 gap-2 ' + (two ? 'lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]')}>
        {showEditor && (
          <section class={'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface ' + (two ? 'h-[340px] lg:h-auto' : '')} aria-label="Markdown editor">
            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">Markdown</span>
              <span class="ml-2 truncate text-ink-3">{stats.lines.toLocaleString()} lines</span>
              <span class="flex-1" />
              <HeaderButton icon="folder-open" title="Open a .md file" onClick={() => fileRef.current?.click()} />
              <HeaderButton icon="copy" title="Copy Markdown" onClick={() => void copyMd()} disabled={!text} />
              <HeaderButton icon="download" title={`Download ${toFileName(title, 'md')}`} onClick={downloadMd} disabled={!text} />
            </header>
            <div ref={editorHostRef} class="flex min-h-0 flex-1 flex-col">
              <CodeEditor value={text} onChange={setText} wrap placeholder="Write Markdown here, or drop a .md file" ariaLabel="Markdown source" class="flex-1" onDropFile={(f) => void openFile(f)} />
            </div>
          </section>
        )}

        {showRight && (
          <section class={'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface ' + (two ? 'h-[340px] lg:h-auto' : '')} aria-label={view === 'html' ? 'HTML source' : 'Preview'}>
            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">{view === 'html' ? 'HTML' : 'Preview'}</span>
              <span class="ml-2 truncate text-ink-3">{title !== 'Document' ? title : ''}</span>
              <span class="flex-1" />
              <HeaderButton icon="download" title={`Download ${toFileName(title, 'html')}`} onClick={downloadHtml} disabled={!safeHtml} />
              <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copyHtml()} disabled={!safeHtml} title="Copy HTML (Ctrl+Shift+C)">
                <Icon name="copy" size={13} /> Copy HTML
              </button>
            </header>
            {view === 'html' ? (
              <CodeEditor value={safeHtml} readOnly wrap language={htmlExt} placeholder="HTML appears here" ariaLabel="Rendered HTML source" class="flex-1" />
            ) : (
              <div ref={previewRef} class="scrollbar-thin min-h-0 flex-1 overflow-auto px-5 py-4">
                {safeHtml ? (
                  <div class="prose-cuis cuis-md-preview max-w-none" dangerouslySetInnerHTML={{ __html: safeHtml }} />
                ) : (
                  <p class="text-sm text-ink-3">The rendered document appears here as you type.</p>
                )}
              </div>
            )}
          </section>
        )}
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">{describeStats(stats) || 'Write or paste Markdown. Nothing leaves your browser.'}</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">B</span> bold · <span class="kbd">Ctrl</span>+<span class="kbd">K</span> link
        </span>
      </div>
    </div>
  );
}

/** Rules the global prose-cuis style does not cover, scoped to the preview. */
const PREVIEW_CSS = `
.cuis-md-preview h1 { margin: 0.2em 0 0.6em; font-size: 1.875rem; font-weight: 700; }
.cuis-md-preview h2 { margin-top: 1.6em; }
.cuis-md-preview h4, .cuis-md-preview h5, .cuis-md-preview h6 { margin: 1.4em 0 0.4em; font-weight: 600; color: var(--color-ink); }
.cuis-md-preview img { max-width: 100%; border-radius: 6px; }
.cuis-md-preview hr { margin: 2em 0; border: 0; border-top: 1px solid var(--color-line); }
.cuis-md-preview table { border-collapse: collapse; display: block; overflow-x: auto; }
.cuis-md-preview th, .cuis-md-preview td { border: 1px solid var(--color-line); padding: 0.35rem 0.7rem; }
.cuis-md-preview th { background: var(--color-surface-2); }
.cuis-md-preview li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.25rem; }
.cuis-md-preview li > input[type="checkbox"] { margin-right: 0.45rem; accent-color: var(--color-brand-600); vertical-align: middle; }
.cuis-md-preview del { color: var(--color-ink-3); }
.cuis-md-preview a[data-blocked-url] { color: var(--color-danger); text-decoration: line-through; }
`;
