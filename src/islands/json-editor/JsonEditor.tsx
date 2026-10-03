/**
 * Two-panel JSON workspace in the spirit of jsoneditoronline.org. Each panel is an
 * independent document (text / tree / table modes, format, compact, sort, transform,
 * search, undo, repair) powered by the open-source vanilla-jsoneditor engine. The shell
 * adds local documents addressed in the URL hash, the Copy / Transform / Compare bar,
 * file and URL loading, share links, full screen and an optional AI drawer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Mode } from 'vanilla-jsoneditor';
import { Icon } from '../shared/icons';
import { copyText, downloadText, formatBytes, toast, track } from '../shared/toast';
import { Panel, type PanelApi } from './Panel';
import { AiPanel } from './AiPanel';
import { LocalDocsModal, Modal, ShortcutsModal, UrlModal } from './dialogs';
import { diffJson, type DiffResult } from './diff';
import { SAMPLE_JSON, formatJson, minifyJson, parseJson } from './json';
import { canShare, decodeShare, encodeShare } from './share';
import { createDoc, deleteDoc, isFirstVisit, listDocs, loadDoc, readHash, saveDoc, writeHash, type LocalDoc } from './store';

export type PageMode = 'editor' | 'formatter' | 'validator' | 'minifier';
type Side = 'left' | 'right';

interface Props {
  mode?: PageMode;
}

const LEGACY_DRAFT_KEY = 'cuis-json-doc:v2';
const MODE_PREF = 'cuis-jed:modes';
const MAX_FILE = 100 * 1024 * 1024;

function loadModes(fallback: [Mode, Mode]): [Mode, Mode] {
  try {
    const m = JSON.parse(localStorage.getItem(MODE_PREF) ?? 'null') as unknown;
    const ok = (x: unknown): x is Mode => x === Mode.text || x === Mode.tree || x === Mode.table;
    if (Array.isArray(m) && ok(m[0]) && ok(m[1])) return [m[0], m[1]];
  } catch {}
  return fallback;
}

export default function JsonEditor({ mode: page = 'editor' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileSide = useRef<Side>('left');
  const apis = useRef<{ left: PanelApi | null; right: PanelApi | null }>({ left: null, right: null });
  const saveTimers = useRef<{ left?: number; right?: number }>({});

  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<{ left: LocalDoc | null; right: LocalDoc | null }>({ left: null, right: null });
  const [twoPanels, setTwoPanels] = useState(page === 'editor');
  const [modes, setModes] = useState<[Mode, Mode]>(() => loadModes([Mode.text, Mode.tree]));
  const [compare, setCompare] = useState(false);
  const [diffIndex, setDiffIndex] = useState(0);
  const [full, setFull] = useState(false);
  const [dark, setDark] = useState(false);
  const [active, setActive] = useState<Side>('left');
  const [modal, setModal] = useState<null | { kind: 'url' | 'docs' | 'ai'; side: Side } | { kind: 'shortcuts' }>(null);
  const [docList, setDocList] = useState<LocalDoc[]>([]);

  // ---------------------------------------------------------------- boot
  useEffect(() => {
    (async () => {
      const hash = readHash();
      let left = hash.left ? loadDoc(hash.left) : null;
      let right = hash.right ? loadDoc(hash.right) : null;
      const first = isFirstVisit();

      // A share link from any version of the editor opens in the left panel as a new document.
      if (hash.share) {
        const text = await decodeShare(location.hash);
        if (text !== null) {
          left = createDoc(text, 'Shared document');
          toast('Opened the JSON from the shared link');
        }
      }
      // No hash and nothing shared: reopen the most recent documents instead of creating new ones.
      if (!left && !right && !hash.share && !first) {
        const recent = listDocs();
        left = recent[0] ?? null;
        right = recent[1] ?? null;
      }
      if (!left) {
        let seed = '';
        if (first) {
          try {
            seed = localStorage.getItem(LEGACY_DRAFT_KEY) ?? SAMPLE_JSON;
            localStorage.removeItem(LEGACY_DRAFT_KEY);
          } catch {
            seed = SAMPLE_JSON;
          }
        }
        left = createDoc(seed, first ? 'New document 1' : undefined);
      }
      if (!right && (page === 'editor' || hash.right)) right = createDoc('', first ? 'New document 2' : undefined);
      setDocs({ left, right });
      setTwoPanels(page === 'editor' || !!hash.right);
      setReady(true);
    })();
  }, [page]);

  useEffect(() => {
    if (!ready) return;
    writeHash(docs.left?.id ?? null, twoPanels ? (docs.right?.id ?? null) : null);
  }, [ready, docs.left?.id, docs.right?.id, twoPanels]);

  // Size readout for the active document: bytes now and bytes once minified. Computed
  // 300 ms after typing stops; the minified size is skipped above 20 MB to stay responsive.
  const [sizes, setSizes] = useState<{ raw: number; min: number | null } | null>(null);
  const activeText = docs[active]?.text ?? '';
  useEffect(() => {
    const t = setTimeout(() => {
      if (!activeText.trim()) {
        setSizes(null);
        return;
      }
      const raw = new Blob([activeText]).size;
      let min: number | null = null;
      if (raw <= 20 * 1024 * 1024) {
        try {
          min = new Blob([JSON.stringify(JSON.parse(activeText))]).size;
        } catch {
          min = null;
        }
      }
      setSizes({ raw, min });
    }, 300);
    return () => clearTimeout(t);
  }, [activeText]);

  // Dark mode follows the site toggle
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains('dark'));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_PREF, JSON.stringify(modes));
    } catch {}
  }, [modes]);

  // Full screen (native API, fixed overlay fallback)
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

  // ---------------------------------------------------------------- doc helpers
  const persist = useCallback((doc: LocalDoc) => {
    if (!saveDoc(doc)) toast('Could not save locally: browser storage is full or blocked.', 'error', 4000);
  }, []);

  const setDocText = useCallback(
    (side: Side, text: string) => {
      setDocs((d) => {
        const cur = d[side];
        if (!cur || cur.text === text) return d;
        const next = { ...cur, text, updated: Date.now() };
        window.clearTimeout(saveTimers.current[side]);
        saveTimers.current[side] = window.setTimeout(() => persist(next), 400);
        return { ...d, [side]: next };
      });
    },
    [persist],
  );

  const replaceDoc = (side: Side, doc: LocalDoc) => setDocs((d) => ({ ...d, [side]: doc }));

  const renameDoc = (side: Side, name: string) =>
    setDocs((d) => {
      const cur = d[side];
      if (!cur) return d;
      const next = { ...cur, name, updated: Date.now() };
      persist(next);
      return { ...d, [side]: next };
    });

  const otherSide = (s: Side): Side => (s === 'left' ? 'right' : 'left');

  // ---------------------------------------------------------------- compare
  const leftText = docs.left?.text ?? '';
  const rightText = docs.right?.text ?? '';
  const parsedLeft = useMemo(() => (docs.left ? parseJson(leftText) : null), [leftText, !!docs.left]);
  const parsedRight = useMemo(() => (docs.right ? parseJson(rightText) : null), [rightText, !!docs.right]);
  const diff: DiffResult | null = useMemo(() => {
    if (!compare || !twoPanels || !parsedLeft?.ok || !parsedRight?.ok) return null;
    return diffJson(parsedLeft.value, parsedRight.value);
  }, [compare, twoPanels, parsedLeft, parsedRight]);
  const diffCount = diff?.entries.length ?? 0;
  useEffect(() => setDiffIndex(0), [diffCount]);

  const gotoDiff = async (i: number) => {
    if (!diff || diffCount === 0) return;
    const n = ((i % diffCount) + diffCount) % diffCount;
    setDiffIndex(n);
    const path = diff.entries[n].path;
    for (const side of ['left', 'right'] as Side[]) {
      const api = apis.current[side];
      if (!api) continue;
      try {
        if (path.length > 0) api.expand(path.slice(0, -1));
        await api.scrollTo(path);
      } catch {
        /* the path may not exist on this side */
      }
    }
  };

  // ---------------------------------------------------------------- actions
  const act = {
    copyAcross(from: Side) {
      const src = docs[from];
      if (!src) return;
      const to = otherSide(from);
      if (!docs[to]) replaceDoc(to, createDoc(src.text));
      else setDocText(to, src.text);
      toast(`Copied ${src.name} to the ${to} panel`);
      track('tool_action', { tool: 'json-editor', action: 'copy_across' });
    },
    transformAcross(from: Side) {
      const api = apis.current[from];
      const src = docs[from];
      if (!api || !src) return;
      if (!parseJson(src.text).ok) return toast(`${src.name} must be valid JSON before it can be transformed`, 'error');
      const to = otherSide(from);
      api.transform({
        onTransform: ({ transformedJson }) => {
          const text = JSON.stringify(transformedJson, null, 2);
          if (!docs[to]) replaceDoc(to, createDoc(text));
          else setDocText(to, text);
          toast(`Transformed into the ${to} panel`);
          track('tool_action', { tool: 'json-editor', action: 'transform_across' });
        },
      });
    },
    newDoc(side: Side) {
      replaceDoc(side, createDoc(''));
      track('tool_action', { tool: 'json-editor', action: 'new' });
    },
    openLocal(side: Side) {
      setDocList(listDocs());
      setModal({ kind: 'docs', side });
    },
    openFile(side: Side) {
      fileSide.current = side;
      fileRef.current?.click();
    },
    async loadFile(f: File) {
      if (f.size > MAX_FILE) return toast('File is larger than 100 MB', 'error');
      const side = fileSide.current;
      const text = await f.text();
      const name = f.name.replace(/\.(json|txt)$/i, '');
      replaceDoc(side, createDoc(text, name));
      toast(`Opened ${f.name}`);
      track('tool_action', { tool: 'json-editor', action: 'open_file' });
    },
    async loadUrl(side: Side, url: string): Promise<boolean> {
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
        const name = decodeURIComponent(last).replace(/\.json$/i, '') || 'From URL';
        replaceDoc(side, createDoc(text, name));
        toast('Loaded JSON from URL');
        track('tool_action', { tool: 'json-editor', action: 'open_url' });
        return true;
      } catch (e) {
        toast(`Could not load that URL (${(e as Error).message}). The server must allow CORS.`, 'error', 4500);
        return false;
      }
    },
    saveDisk(side: Side) {
      const d = docs[side];
      if (!d?.text) return toast('Nothing to save yet', 'error');
      downloadText(d.text, `${d.name.replace(/[\\/:*?"<>|]+/g, '-')}.json`, 'application/json');
      track('tool_action', { tool: 'json-editor', action: 'download' });
    },
    async share(side: Side) {
      const d = docs[side];
      if (!d?.text.trim()) return toast('Nothing to share yet', 'error');
      if (!canShare()) return toast('Your browser does not support share links', 'error');
      const enc = await encodeShare(d.text);
      if (!enc) return toast('Document is too large for a link (about 12 KB compressed). Save it to disk instead.', 'error', 4500);
      const url = new URL(location.href);
      url.hash = `share=${enc}`;
      (await copyText(url.toString())) ? toast('Share link copied. The data lives inside the link, not on our servers.', 'ok', 3500) : toast('Copy failed', 'error');
      track('tool_action', { tool: 'json-editor', action: 'share' });
    },
    async copy(side: Side, variant: 'formatted' | 'compact') {
      const d = docs[side];
      if (!d?.text) return toast('Nothing to copy yet', 'error');
      const parsed = parseJson(d.text);
      const out = parsed.ok ? (variant === 'compact' ? minifyJson(parsed.value) : formatJson(parsed.value, 2)) : d.text;
      (await copyText(out)) ? toast(parsed.ok ? `Copied ${variant}` : 'Copied as-is (document is not valid JSON)') : toast('Copy failed', 'error');
      track('tool_action', { tool: 'json-editor', action: 'copy' });
    },
    deleteLocal(doc: LocalDoc) {
      deleteDoc(doc.id);
      setDocList(listDocs());
      setDocs((d) => ({
        left: d.left?.id === doc.id ? createDoc('') : d.left,
        right: d.right?.id === doc.id ? createDoc('') : d.right,
      }));
      toast(`Deleted ${doc.name}`);
    },
  };

  // Keyboard: Esc closes, Ctrl+S saves the active document
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modal) setModal(null);
        else if (full && !document.fullscreenElement) setFull(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        act.saveDisk(active);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------------------------------------------------------------- render
  const panelProps = (side: Side, doc: LocalDoc) => ({
    side,
    doc,
    mode: modes[side === 'left' ? 0 : 1],
    dark,
    diffClasses: diff ? diff[side] : null,
    isFull: full,
    onReady: (api: PanelApi | null) => {
      apis.current[side] = api;
    },
    onText: (t: string) => setDocText(side, t),
    onMode: (m: Mode) => setModes((ms) => (side === 'left' ? [m, ms[1]] : [ms[0], m])),
    onRename: (n: string) => renameDoc(side, n),
    onNew: () => act.newDoc(side),
    onOpenLocal: () => act.openLocal(side),
    onOpenFile: () => act.openFile(side),
    onOpenUrl: () => setModal({ kind: 'url', side }),
    onSaveDisk: () => act.saveDisk(side),
    onShareLink: () => act.share(side),
    onCopy: (v: 'formatted' | 'compact') => act.copy(side, v),
    onAi: () => setModal({ kind: 'ai', side }),
    onFullScreen: () => setFull((f) => !f),
  });

  const aiSide = modal?.kind === 'ai' ? modal.side : null;
  const aiDoc = aiSide ? docs[aiSide] : null;

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(82vh,960px)] min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
      onFocusCapture={(e) => {
        const side = (e.target as HTMLElement).closest?.('[data-side]')?.getAttribute('data-side') as Side | null;
        if (side) setActive(side);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".json,.txt,application/json,text/plain"
        class="hidden"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) act.loadFile(f);
          (e.target as HTMLInputElement).value = '';
        }}
      />

      {!ready || !docs.left ? (
        <div class="flex flex-1 items-center justify-center text-sm text-ink-3">
          <Icon name="loader" size={18} class="mr-2 animate-spin" /> Loading your documents
        </div>
      ) : (
        <div class={'grid min-h-0 flex-1 gap-2 ' + (twoPanels ? 'grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-rows-1' : 'grid-cols-1')}>
          <div class="flex min-h-0 min-w-0 [&>section]:flex-1" data-side="left">
            <Panel {...panelProps('left', docs.left)} />
          </div>

          {twoPanels && docs.right && (
            <>
              <div class="flex flex-row flex-wrap items-start justify-center gap-4 py-1 md:w-28 md:flex-col md:items-center md:justify-start md:gap-5 md:py-10" aria-label="Panel actions">
                <Group label="Copy">
                  <MidBtn icon="arrow-left" title="Copy the right document to the left panel" onClick={() => act.copyAcross('right')} />
                  <MidBtn icon="arrow-right" title="Copy the left document to the right panel" onClick={() => act.copyAcross('left')} />
                </Group>
                <Group label="Transform">
                  <MidBtn icon="arrow-left" title="Transform the right document into the left panel (filter, sort, pick)" onClick={() => act.transformAcross('right')} />
                  <MidBtn icon="arrow-right" title="Transform the left document into the right panel (filter, sort, pick)" onClick={() => act.transformAcross('left')} />
                </Group>
                <Group label="Differences">
                  <button
                    type="button"
                    class={'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ' + (compare ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-3')}
                    aria-pressed={compare}
                    onClick={() => setCompare((c) => !c)}
                    title="Highlight differences between the two documents (tree and table modes)"
                  >
                    <Icon name={compare ? 'square-check' : 'square'} size={14} /> Compare
                  </button>
                </Group>
                {compare && (
                  <div class="flex flex-col items-center gap-1 text-[11px] text-ink-2">
                    {!parsedLeft?.ok || !parsedRight?.ok ? (
                      <span class="max-w-[7rem] text-center text-danger">Both documents must be valid JSON</span>
                    ) : (
                      <>
                        <span>{diffCount === 0 ? 'No differences' : `${diffIndex + 1} of ${diffCount}`}</span>
                        {diffCount > 0 && (
                          <span class="flex gap-1">
                            <MidBtn icon="chevron-up" title="Previous difference" onClick={() => gotoDiff(diffIndex - 1)} />
                            <MidBtn icon="chevron-down" title="Next difference" onClick={() => gotoDiff(diffIndex + 1)} />
                          </span>
                        )}
                        {(modes[0] === Mode.text || modes[1] === Mode.text) && <span class="max-w-[7rem] text-center text-ink-3">Highlights show in tree and table modes</span>}
                      </>
                    )}
                  </div>
                )}
                <button type="button" class="btn-ghost btn-icon h-7 w-7 text-ink-3" title="Keyboard shortcuts" aria-label="Keyboard shortcuts" onClick={() => setModal({ kind: 'shortcuts' })}>
                  <Icon name="keyboard" size={15} />
                </button>
              </div>
              <div class="flex min-h-0 min-w-0 [&>section]:flex-1" data-side="right">
                <Panel {...panelProps('right', docs.right)} onClose={() => setTwoPanels(false)} />
              </div>
            </>
          )}
        </div>
      )}

      {ready && docs.left && !twoPanels && (
        <div class="mt-2 flex items-center justify-between gap-3 text-xs text-ink-3">
          {sizes ? (
            <span class="tabular-nums" aria-live="polite">
              {formatBytes(sizes.raw)}
              {sizes.min !== null && sizes.min < sizes.raw && (
                <>
                  {' '}· minified {formatBytes(sizes.min)} <span class="text-success">(−{Math.round((1 - sizes.min / sizes.raw) * 1000) / 10}%)</span>
                </>
              )}
              {sizes.min !== null && sizes.min >= sizes.raw && ' · already minified'}
            </span>
          ) : (
            <span class="hidden sm:inline">Tip: right-click a node in tree mode for the full menu.</span>
          )}
          <button
            type="button"
            class="btn-secondary btn-sm"
            onClick={() => {
              if (!docs.right) replaceDoc('right', createDoc(''));
              setTwoPanels(true);
            }}
          >
            <Icon name="columns" size={14} /> Open a second panel to compare or transform
          </button>
        </div>
      )}

      {/* Overlays */}
      {modal?.kind === 'url' && <UrlModal onClose={() => setModal(null)} onLoad={(u) => act.loadUrl(modal.side, u)} />}
      {modal?.kind === 'docs' && (
        <LocalDocsModal
          docs={docList}
          openIds={[docs.left?.id, docs.right?.id].filter((x): x is string => !!x)}
          onClose={() => setModal(null)}
          onOpen={(d) => {
            replaceDoc(modal.side, d);
            setModal(null);
          }}
          onDelete={act.deleteLocal}
        />
      )}
      {modal?.kind === 'shortcuts' && <ShortcutsModal onClose={() => setModal(null)} />}
      {aiSide && aiDoc && <AiPanel text={aiDoc.text} docName={aiDoc.name} onClose={() => setModal(null)} onApply={(t) => setDocText(aiSide, t)} />}
      {ready && !docs.left && (
        <Modal title="Storage unavailable" onClose={() => {}}>
          <p class="text-sm text-ink-2">This browser blocks local storage, which the editor needs to keep your documents. Allow site data and reload.</p>
        </Modal>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="flex flex-col items-center gap-1.5">
      <span class="text-[11px] font-medium uppercase tracking-wide text-ink-3">{label}</span>
      <div class="flex items-center gap-1.5">{children}</div>
    </div>
  );
}

function MidBtn({ icon, title, onClick }: { icon: string; title: string; onClick: () => void }) {
  return (
    <button type="button" class="inline-flex h-8 w-9 items-center justify-center rounded-md border border-line-strong bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink" title={title} aria-label={title} onClick={onClick}>
      <Icon name={icon} size={15} />
    </button>
  );
}
