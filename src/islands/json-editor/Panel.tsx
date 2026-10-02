import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { createJSONEditor, Mode, type Content, type OnClassName, type TransformModalOptions } from 'vanilla-jsoneditor';

type JSONPath = string[];
type JSONEditorInstance = ReturnType<typeof createJSONEditor>;
import { Icon } from '../shared/icons';
import type { LocalDoc } from './store';

/** Imperative handle the workspace uses to drive a panel. */
export interface PanelApi {
  get(): Content;
  set(content: Content): void;
  transform(options?: TransformModalOptions): void;
  scrollTo(path: JSONPath): Promise<void>;
  expand(path: JSONPath): void;
  focus(): void;
}

export interface PanelProps {
  side: 'left' | 'right';
  doc: LocalDoc;
  mode: Mode;
  dark: boolean;
  /** Path key -> class name, when Compare is on. */
  diffClasses: Map<string, string> | null;
  onReady: (api: PanelApi | null) => void;
  onText: (text: string) => void;
  onMode: (mode: Mode) => void;
  onRename: (name: string) => void;
  /** Header menu actions */
  onNew: () => void;
  onOpenLocal: () => void;
  onOpenFile: () => void;
  onOpenUrl: () => void;
  onSaveDisk: () => void;
  onShareLink: () => void;
  onCopy: (variant: 'formatted' | 'compact') => void;
  onAi: () => void;
  onFullScreen: () => void;
  isFull: boolean;
  /** Only shown on the right panel: lets the user hide it again. */
  onClose?: () => void;
}

export function Panel(p: PanelProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<JSONEditorInstance | null>(null);
  const docIdRef = useRef<string>('');
  const latestText = useRef(p.doc.text);
  const [menu, setMenu] = useState<null | 'open' | 'save' | 'copy'>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(p.doc.name);

  // Mount the engine once per panel.
  useEffect(() => {
    if (!hostRef.current) return;
    const editor = createJSONEditor({
      target: hostRef.current,
      props: {
        content: { text: p.doc.text },
        mode: p.mode,
        mainMenuBar: true,
        navigationBar: true,
        statusBar: true,
        askToFormat: true,
        indentation: 2,
        tabSize: 2,
        onChange: (content: Content) => {
          const text = 'text' in content ? content.text : JSON.stringify(content.json, null, 2);
          latestText.current = text;
          p.onText(text);
        },
        onChangeMode: (m: Mode) => p.onMode(m),
        onClassName: classNameFor(p.diffClasses),
      },
    });
    editorRef.current = editor;
    docIdRef.current = p.doc.id;
    p.onReady({
      get: () => editor.get(),
      set: (c) => editor.set(c),
      transform: (o) => editor.transform(o),
      scrollTo: (path) => editor.scrollTo(path),
      expand: (path) => editor.expand(path, () => true),
      focus: () => editor.focus(),
    });
    return () => {
      p.onReady(null);
      editor.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch document (only when the id changes, not on every keystroke echo).
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || docIdRef.current === p.doc.id) return;
    docIdRef.current = p.doc.id;
    latestText.current = p.doc.text;
    ed.set({ text: p.doc.text });
    setNameDraft(p.doc.name);
    setRenaming(false);
  }, [p.doc.id]);

  // External text updates (copy from other panel, AI, repair) arrive via doc.text changing
  // while the id stays the same; only push them if they differ from what the editor has.
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || p.doc.text === latestText.current) return;
    latestText.current = p.doc.text;
    ed.set({ text: p.doc.text });
  }, [p.doc.text]);

  useEffect(() => {
    editorRef.current?.updateProps({ mode: p.mode });
  }, [p.mode]);

  useEffect(() => {
    editorRef.current?.updateProps({ onClassName: classNameFor(p.diffClasses) });
    void editorRef.current?.refresh();
  }, [p.diffClasses]);

  useEffect(() => setNameDraft(p.doc.name), [p.doc.name]);

  // Close dropdowns on outside click / Escape
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  const commitName = () => {
    const n = nameDraft.trim() || p.doc.name;
    setNameDraft(n);
    setRenaming(false);
    if (n !== p.doc.name) p.onRename(n);
  };

  return (
    <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label={`${p.side} document`}>
      {/* Document header */}
      <header class="flex h-10 shrink-0 items-center gap-1 bg-brand-600 pl-3 pr-1.5 text-white dark:bg-brand-700">
        {renaming ? (
          <input
            class="h-7 min-w-0 flex-1 rounded border border-white/40 bg-white/15 px-2 text-sm text-white outline-none placeholder:text-white/60"
            value={nameDraft}
            onInput={(e) => setNameDraft((e.target as HTMLInputElement).value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
              if (e.key === 'Escape') {
                setNameDraft(p.doc.name);
                setRenaming(false);
              }
            }}
            ref={(el) => {
              if (el) setTimeout(() => el.focus(), 0);
            }}
            aria-label="Document name"
          />
        ) : (
          <button type="button" class="group flex min-w-0 items-center gap-1.5 rounded px-1 text-sm font-medium hover:bg-white/15" onClick={() => setRenaming(true)} title="Rename document">
            <span class="truncate">{p.doc.name}</span>
            <Icon name="pencil" size={13} class="shrink-0 opacity-70 group-hover:opacity-100" />
          </button>
        )}
        <span class="flex-1" />

        <HBtn icon="file-plus" label="New" title="Open a new, empty document" onClick={p.onNew} />
        <Dropdown
          open={menu === 'open'}
          onToggle={() => setMenu(menu === 'open' ? null : 'open')}
          button={<HBtn icon="folder-open" label="Open" title="Open a document" caret />}
        >
          <MItem icon="list-tree" text="Local documents" hint="Stored in this browser" onClick={p.onOpenLocal} />
          <MItem icon="folder-open" text="From disk" hint=".json or .txt" onClick={p.onOpenFile} />
          <MItem icon="link" text="From URL" hint="Fetched by your browser" onClick={p.onOpenUrl} />
        </Dropdown>
        <Dropdown
          open={menu === 'save'}
          onToggle={() => setMenu(menu === 'save' ? null : 'save')}
          button={<HBtn icon="download" label="Save" title="Save this document" caret />}
        >
          <MItem icon="download" text="Save to disk" hint="Download .json" onClick={p.onSaveDisk} />
          <MItem icon="share" text="Copy share link" hint="Data travels inside the link" onClick={p.onShareLink} />
        </Dropdown>
        <Dropdown
          open={menu === 'copy'}
          onToggle={() => setMenu(menu === 'copy' ? null : 'copy')}
          button={<HBtn icon="copy" label="Copy" title="Copy to clipboard" caret />}
        >
          <MItem icon="align-left" text="Copy formatted" hint="Indented, readable" onClick={() => p.onCopy('formatted')} />
          <MItem icon="minimize-2" text="Copy compact" hint="Single line" onClick={() => p.onCopy('compact')} />
        </Dropdown>
        <HBtn icon="sparkles" title="AI assist with your own Gemini key" onClick={p.onAi} />
        <HBtn icon={p.isFull ? 'minimize' : 'maximize'} title={p.isFull ? 'Exit full screen (Esc)' : 'Full screen'} onClick={p.onFullScreen} />
        {p.onClose && <HBtn icon="x" title="Close this panel" onClick={p.onClose} />}
      </header>

      {/* Engine */}
      <div ref={hostRef} class={'cuis-jse min-h-0 flex-1 ' + (p.dark ? 'jse-theme-dark' : '')} />
    </section>
  );
}

function classNameFor(map: Map<string, string> | null): OnClassName | undefined {
  if (!map) return undefined;
  return (path) => map.get(JSON.stringify(path));
}

function HBtn({ icon, label, title, onClick, caret }: { icon: string; label?: string; title: string; onClick?: () => void; caret?: boolean }) {
  return (
    <button
      type="button"
      class={'inline-flex h-7 items-center gap-1.5 rounded px-1.5 text-[12.5px] font-medium text-white/90 hover:bg-white/15 hover:text-white ' + (label ? '' : 'w-7 justify-center px-0')}
      title={title}
      aria-label={label ? undefined : title}
      onClick={onClick}
    >
      <Icon name={icon} size={14} />
      {label && <span class="hidden lg:inline">{label}</span>}
      {caret && <Icon name="chevron-down" size={11} class="-ml-0.5 opacity-80" />}
    </button>
  );
}

function Dropdown({ open, onToggle, button, children }: { open: boolean; onToggle: () => void; button: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="relative" onPointerDown={(e) => e.stopPropagation()}>
      <div onClick={onToggle}>{button}</div>
      {open && (
        <div class="absolute right-0 top-full z-30 mt-1 w-60 rounded-md border border-line-strong bg-surface p-1 text-ink shadow-float" role="menu" onClick={onToggle}>
          {children}
        </div>
      )}
    </div>
  );
}

function MItem({ icon, text, hint, onClick }: { icon: string; text: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" class="flex w-full items-start gap-2.5 rounded px-2 py-1.5 text-left text-[13px] hover:bg-surface-3" onClick={onClick}>
      <Icon name={icon} size={15} class="mt-0.5 shrink-0 text-ink-3" />
      <span>
        <span class="block font-medium text-ink">{text}</span>
        {hint && <span class="block text-[11px] text-ink-3">{hint}</span>}
      </span>
    </button>
  );
}
