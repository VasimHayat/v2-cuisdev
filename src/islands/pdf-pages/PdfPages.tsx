/**
 * PDF pages workspace shared by the PDF Split and PDF Page Reorder pages. One PDF is
 * opened, its pages render as thumbnails, and the user reorders, rotates, deletes or
 * duplicates them, then either saves one reordered PDF or splits it into several files.
 * pdf.js draws the thumbnails; pdf-lib writes the output by copying pages, so text and
 * vector content stay intact. Nothing leaves the browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { toast, track } from '../shared/toast';
import { PdfOpenError, loadPdf, renderThumbnail } from '../shared/pdfjs';
import { buildZip, downloadBlob } from '../shared/zip';
import { loadPdfLib } from '../pdf-converter/pdf';
import { formatBytes } from '../pdf-converter/logic';
import {
  PdfError,
  deletePages,
  describePart,
  dropIndexToTarget,
  duplicatePages,
  historyPush,
  historyRedo,
  historyUndo,
  initialPages,
  isModified,
  movePagesTo,
  nudgePages,
  planSplit,
  rangeIds,
  reorderedName,
  rotatePages,
  selectPreset,
  type History,
  type OutputPart,
  type PageItem,
  type SelectPreset,
  type SplitMode,
  type SplitOptions,
} from './logic';

type Kind = 'split' | 'reorder';

interface Props {
  kind?: Kind;
}

const PREFS_KEY = 'cuis-pdfpages:prefs';
const MAX_FILE = 200 * 1024 * 1024;
const DEFAULT_SPLIT: SplitOptions = { mode: 'every', every: 1, ranges: '1-3, 4-' };

interface Loaded {
  name: string;
  bytes: Uint8Array;
  size: number;
  doc: PDFDocumentProxy;
  count: number;
}

function loadSplitPrefs(): SplitOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<SplitOptions> | null;
    if (!raw) return DEFAULT_SPLIT;
    const o = { ...DEFAULT_SPLIT };
    if (raw.mode === 'selection' || raw.mode === 'every' || raw.mode === 'ranges' || raw.mode === 'each' || raw.mode === 'odd-even') o.mode = raw.mode;
    if (typeof raw.every === 'number' && raw.every >= 1) o.every = Math.floor(raw.every);
    if (typeof raw.ranges === 'string') o.ranges = raw.ranges.slice(0, 500);
    return o;
  } catch {
    return DEFAULT_SPLIT;
  }
}

const EMPTY_HISTORY: History<PageItem[]> = { past: [], present: [], future: [] };

export default function PdfPages({ kind = 'reorder' }: Props) {
  const tool = kind === 'split' ? 'pdf-split' : 'pdf-page-reorder';
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Kind>(kind);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [history, setHistory] = useState<History<PageItem[]>>(EMPTY_HISTORY);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [focus, setFocus] = useState(0);
  const [thumbs, setThumbs] = useState<Map<number, string>>(new Map());
  const [rendered, setRendered] = useState(0);
  const [split, setSplit] = useState<SplitOptions>(() => (typeof window === 'undefined' ? DEFAULT_SPLIT : loadSplitPrefs()));
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [dragIds, setDragIds] = useState<Set<string> | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const [full, setFull] = useState(false);

  const pages = history.present;
  const liveSelection = useMemo(() => new Set(pages.filter((p) => selected.has(p.id)).map((p) => p.id)), [pages, selected]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(split));
    } catch {}
  }, [split]);

  const commit = useCallback((next: PageItem[]) => setHistory((h) => historyPush(h, next)), []);

  // ------------------------------------------------------------------ open

  const openBytes = useCallback(async (name: string, bytes: Uint8Array, pwd?: string) => {
    setBusy('Opening PDF');
    try {
      const doc = await loadPdf(bytes, pwd);
      setLoaded({ name, bytes, size: bytes.length, doc, count: doc.numPages });
      setHistory({ past: [], present: initialPages(doc.numPages), future: [] });
      setSelected(new Set());
      setAnchor(null);
      setFocus(0);
      setPending(null);
      setPassword('');
      setPasswordError(null);
      track('tool_action', { tool, action: 'open', pages: doc.numPages, bytes: bytes.length });
    } catch (err) {
      if (err instanceof PdfOpenError && /password/i.test(err.message)) {
        setPending({ name, bytes });
        setPasswordError(pwd ? err.message : null);
      } else toast(err instanceof Error ? err.message : 'Could not open that PDF.', 'error', 4000);
    } finally {
      setBusy(null);
    }
  }, [tool]);

  const openFile = useCallback(
    async (file: File) => {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        toast(`${file.name} is not a PDF`, 'error');
        return;
      }
      if (file.size > MAX_FILE) {
        toast(`${file.name} is larger than ${formatBytes(MAX_FILE)}`, 'error');
        return;
      }
      await openBytes(file.name, new Uint8Array(await file.arrayBuffer()));
    },
    [openBytes],
  );

  const loadSample = async () => {
    setBusy('Creating sample');
    try {
      const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      const colours = [rgb(0.36, 0.42, 0.95), rgb(0.95, 0.45, 0.35), rgb(0.2, 0.7, 0.5), rgb(0.95, 0.75, 0.2), rgb(0.6, 0.4, 0.9), rgb(0.25, 0.65, 0.85)];
      for (let i = 0; i < 6; i++) {
        const landscape = i === 3;
        const [w, h] = landscape ? [841.89, 595.28] : [595.28, 841.89];
        const page = doc.addPage([w, h]);
        page.drawRectangle({ x: 0, y: 0, width: w, height: h, color: colours[i]! });
        page.drawRectangle({ x: 40, y: 40, width: w - 80, height: h - 80, color: rgb(1, 1, 1), opacity: 0.9 });
        const label = String(i + 1);
        page.drawText(label, { x: w / 2 - font.widthOfTextAtSize(label, 220) / 2, y: h / 2 - 70, size: 220, font, color: colours[i]! });
        page.drawText(`Sample page ${i + 1}${landscape ? ' (landscape)' : ''}`, { x: 70, y: h - 100, size: 22, font, color: rgb(0.2, 0.2, 0.25) });
      }
      const bytes = await doc.save();
      await openBytes('sample-6-pages.pdf', bytes);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create the sample', 'error');
    } finally {
      setBusy(null);
    }
  };

  const clear = () => {
    setLoaded(null);
    setHistory(EMPTY_HISTORY);
    setSelected(new Set());
    setPending(null);
  };

  // Render thumbnails sequentially; revoke them when the document changes.
  useEffect(() => {
    if (!loaded) {
      setThumbs(new Map());
      setRendered(0);
      return;
    }
    let cancelled = false;
    const urls: string[] = [];
    setThumbs(new Map());
    setRendered(0);
    (async () => {
      for (let i = 1; i <= loaded.count; i++) {
        if (cancelled) return;
        try {
          const url = await renderThumbnail(loaded.doc, i, 180);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          urls.push(url);
          setThumbs((m) => new Map(m).set(i - 1, url));
        } catch {
          /* a page that fails to render keeps its placeholder */
        }
        setRendered(i);
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [loaded]);

  // ------------------------------------------------------------------ edits

  const targetIds = (id?: string): Set<string> => {
    if (id && !liveSelection.has(id)) return new Set([id]);
    if (liveSelection.size) return liveSelection;
    const f = pages[focus];
    return f ? new Set([f.id]) : new Set();
  };
  const rotate = (delta: number, id?: string) => commit(rotatePages(pages, targetIds(id), delta));
  const remove = (id?: string) => {
    const ids = targetIds(id);
    if (ids.size >= pages.length) {
      toast('A PDF needs at least one page. Use Clear to start over.', 'error');
      return;
    }
    commit(deletePages(pages, ids));
    setSelected(new Set());
    setFocus((f) => Math.min(f, pages.length - ids.size - 1));
  };
  const duplicate = (id?: string) => commit(duplicatePages(pages, targetIds(id)));
  const nudge = (step: -1 | 1) => {
    const ids = targetIds();
    const next = nudgePages(pages, ids, step);
    commit(next);
    const firstIndex = next.findIndex((p) => ids.has(p.id));
    if (firstIndex >= 0) setFocus(firstIndex);
  };
  const preset = (p: SelectPreset) => setSelected(selectPreset(pages, liveSelection, p));
  const undo = () => setHistory((h) => historyUndo(h));
  const redo = () => setHistory((h) => historyRedo(h));
  const resetPages = () => loaded && commit(initialPages(loaded.count));

  const onCardClick = (e: MouseEvent, index: number, id: string) => {
    setFocus(index);
    if (e.shiftKey && anchor !== null) {
      const ids = rangeIds(pages, anchor, index);
      setSelected((s) => (e.ctrlKey || e.metaKey ? new Set([...s, ...ids]) : new Set(ids)));
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      });
    } else setSelected((s) => (s.size === 1 && s.has(id) ? new Set() : new Set([id])));
    setAnchor(index);
  };

  // Drag and drop to reorder
  const onDragStart = (e: DragEvent, id: string) => {
    const ids = liveSelection.has(id) ? liveSelection : new Set([id]);
    setDragIds(ids);
    e.dataTransfer?.setData('text/plain', 'cuis-pages');
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  };
  const onCardDragOver = (e: DragEvent, index: number) => {
    if (!dragIds) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropIndex(e.clientX < rect.left + rect.width / 2 ? index : index + 1);
  };
  const finishDrop = () => {
    if (dragIds && dropIndex !== null) {
      const next = movePagesTo(pages, dragIds, dropIndexToTarget(pages, dragIds, dropIndex));
      if (next.some((p, i) => p.id !== pages[i]?.id)) {
        commit(next);
        track('tool_action', { tool, action: 'drag_reorder' });
      }
    }
    setDragIds(null);
    setDropIndex(null);
  };

  // ------------------------------------------------------------------ output

  const writeParts = async (parts: OutputPart[]): Promise<{ name: string; bytes: Uint8Array }[]> => {
    if (!loaded) throw new PdfError('Open a PDF first.');
    const { PDFDocument, degrees } = await loadPdfLib();
    let src;
    try {
      src = await PDFDocument.load(loaded.bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch {
      throw new PdfError('This PDF could not be read for writing. It may be damaged.');
    }
    if (src.isEncrypted) throw new PdfError('This PDF is encrypted, so its pages cannot be rewritten here. Remove the password in the app that created it, then open it again.');
    const out: { name: string; bytes: Uint8Array }[] = [];
    for (const [n, part] of parts.entries()) {
      setBusy(parts.length > 1 ? `Writing file ${n + 1} of ${parts.length}` : 'Writing PDF');
      const doc = await PDFDocument.create();
      const title = src.getTitle();
      if (title) doc.setTitle(title);
      doc.setProducer('Cuisdev PDF tools');
      doc.setCreator('cuisdev.com');
      const copied = await doc.copyPages(src, part.pages.map((p) => p.source));
      copied.forEach((page, i) => {
        const extra = part.pages[i]!.rotation;
        if (extra) page.setRotation(degrees((page.getRotation().angle + extra) % 360));
        doc.addPage(page);
      });
      out.push({ name: `${part.name}.pdf`, bytes: await doc.save({ useObjectStreams: true }) });
    }
    return out;
  };

  const saveReordered = async () => {
    if (!loaded) return;
    try {
      const [file] = await writeParts([{ name: reorderedName(loaded.name).replace(/\.pdf$/, ''), pages }]);
      if (!file) return;
      downloadBlob(new Blob([file.bytes as BlobPart], { type: 'application/pdf' }), file.name);
      toast(`Saved ${file.name} (${formatBytes(file.bytes.length)})`);
      track('tool_action', { tool, action: 'save', pages: pages.length });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save the PDF', 'error', 5000);
    } finally {
      setBusy(null);
    }
  };

  const plan = useMemo((): { parts: OutputPart[]; error: string | null } => {
    if (!loaded || pages.length === 0) return { parts: [], error: null };
    try {
      return { parts: planSplit(pages, liveSelection, split, loaded.name), error: null };
    } catch (err) {
      return { parts: [], error: err instanceof Error ? err.message : 'Invalid split' };
    }
  }, [loaded, pages, liveSelection, split]);

  const downloadPart = async (part: OutputPart) => {
    try {
      const [file] = await writeParts([part]);
      if (file) downloadBlob(new Blob([file.bytes as BlobPart], { type: 'application/pdf' }), file.name);
      track('tool_action', { tool, action: 'download_part' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not write the file', 'error', 5000);
    } finally {
      setBusy(null);
    }
  };

  const downloadAll = async () => {
    if (!loaded || plan.parts.length === 0) return;
    try {
      const files = await writeParts(plan.parts);
      if (files.length === 1) {
        downloadBlob(new Blob([files[0]!.bytes as BlobPart], { type: 'application/pdf' }), files[0]!.name);
      } else {
        setBusy('Zipping');
        const zip = await buildZip(files.map((f) => ({ name: f.name, data: f.bytes })));
        downloadBlob(zip, `${loaded.name.replace(/\.pdf$/i, '')}-split.zip`);
        toast(`Saved ${files.length} PDFs in a zip (${formatBytes(zip.size)})`);
      }
      track('tool_action', { tool, action: 'split', files: files.length, mode: split.mode });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not split the PDF', 'error', 5000);
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------------ keyboard, full screen

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.matches?.('input, select, textarea')) return;
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') {
        if (full) setFull(false);
        else setSelected(new Set());
        return;
      }
      if (!loaded) return;
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        redo();
      } else if (meta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        preset('all');
      } else if (meta && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
        e.preventDefault();
        nudge(-1);
      } else if (meta && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
        e.preventDefault();
        nudge(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const cols = columnsInGrid(gridRef.current);
        const delta = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -cols : cols;
        const next = Math.max(0, Math.min(pages.length - 1, focus + delta));
        setFocus(next);
        if (e.shiftKey) setSelected(new Set(rangeIds(pages, anchor ?? focus, next)));
        gridRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus();
      } else if (e.key === ' ' || e.key === 'Enter') {
        const p = pages[focus];
        if (!p) return;
        e.preventDefault();
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(p.id)) n.delete(p.id);
          else n.add(p.id);
          return n;
        });
        setAnchor(focus);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        remove();
      } else if (e.key.toLowerCase() === 'r') {
        rotate(e.shiftKey ? -90 : 90);
      }
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
  // Release the pdf.js document when it is replaced or the island unmounts.
  useEffect(() => () => void loaded?.doc.destroy(), [loaded]);

  // ------------------------------------------------------------------ render

  const modified = loaded ? isModified(pages, loaded.count) : false;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink outline-none ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(82vh,900px)] min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
      tabIndex={-1}
      onDragOver={(e) => {
        if (dragIds) return;
        e.preventDefault();
        setFileOver(true);
      }}
      onDragLeave={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setFileOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setFileOver(false);
        if (dragIds) {
          finishDrop();
          return;
        }
        const f = e.dataTransfer?.files?.[0];
        if (f) void openFile(f);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void openFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'reorder', label: 'Reorder', icon: 'layers' },
            { value: 'split', label: 'Split', icon: 'columns' },
          ]}
          label="Mode"
        />
        <button type="button" class="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
          <Icon name="folder-open" size={14} /> Open PDF
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => void loadSample()} disabled={!!busy} title="Load a 6-page sample PDF">
          <Icon name="sparkles" size={14} /> Sample
        </button>
        <span class="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <HeaderButton icon="undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <HeaderButton icon="redo" title="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo} />
        <HeaderButton icon="rotate-ccw" title="Rotate left (Shift+R)" onClick={() => rotate(-90)} disabled={!loaded} />
        <HeaderButton icon="rotate-cw" title="Rotate right (R)" onClick={() => rotate(90)} disabled={!loaded} />
        <HeaderButton icon="copy" title="Duplicate selected pages" onClick={() => duplicate()} disabled={!loaded} />
        <HeaderButton icon="trash" title="Delete selected pages (Delete)" onClick={() => remove()} disabled={!loaded} />
        <span class="flex-1" />
        <button type="button" class="btn-ghost btn-sm" onClick={clear} disabled={!loaded && !pending} title="Close this PDF">
          <Icon name="eraser" size={14} /> Clear
        </button>
        <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 max-lg:overflow-y-auto lg:grid-cols-[minmax(0,1fr)_19rem] lg:grid-rows-[minmax(0,1fr)]">
        {/* Pages */}
        <section
          class={
            'relative flex h-[420px] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-surface transition-colors lg:h-auto ' +
            (fileOver ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-line-strong')
          }
          aria-label="Pages"
        >
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 text-xs">
            <span class="font-semibold text-ink">Pages</span>
            {loaded && <span class="truncate text-ink-3">{loaded.name}</span>}
            <span class="flex-1" />
            {loaded && (
              <span class="hidden items-center gap-1 sm:flex">
                <SelectButton onClick={() => preset('all')}>All</SelectButton>
                <SelectButton onClick={() => preset('none')}>None</SelectButton>
                <SelectButton onClick={() => preset('odd')}>Odd</SelectButton>
                <SelectButton onClick={() => preset('even')}>Even</SelectButton>
                <SelectButton onClick={() => preset('invert')}>Invert</SelectButton>
              </span>
            )}
          </header>

          {pending ? (
            <form
              class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                void openBytes(pending.name, pending.bytes, password);
              }}
            >
              <Icon name="lock" size={26} class="text-ink-3" />
              <p>
                <span class="font-medium">{pending.name}</span> is password protected.
              </p>
              <div class="flex gap-2">
                <input type="password" class="input h-8 w-56" value={password} onInput={(e) => setPassword((e.currentTarget as HTMLInputElement).value)} placeholder="Password" aria-label="PDF password" autocomplete="off" />
                <button type="submit" class="btn-primary btn-sm" disabled={!password}>
                  Open
                </button>
              </div>
              {passwordError && <p class="text-xs text-danger">{passwordError}</p>}
              <p class="max-w-sm text-xs text-ink-3">The password lets you view the pages here. Encrypted PDFs cannot be rewritten in the browser, so remove the password before splitting or reordering.</p>
            </form>
          ) : !loaded ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Icon name={mode === 'split' ? 'columns' : 'layers'} size={26} />
              </span>
              <p class="text-sm font-medium">Drop a PDF here or</p>
              <div class="flex gap-2">
                <button type="button" class="btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="folder-open" size={14} /> Open PDF
                </button>
                <button type="button" class="btn-secondary btn-sm" onClick={() => void loadSample()}>
                  Try a sample
                </button>
              </div>
              <p class="max-w-sm text-xs leading-5 text-ink-3">Pages are copied, not redrawn, so text stays selectable and quality is unchanged. Nothing is uploaded.</p>
            </div>
          ) : (
            <div
              ref={gridRef}
              class="scrollbar-thin grid min-h-0 flex-1 auto-rows-max grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 overflow-y-auto p-3"
              role="listbox"
              aria-multiselectable="true"
              aria-label="Pages, use arrow keys to move and Ctrl with arrows to reorder"
              onDragOver={(e) => {
                if (!dragIds) return;
                e.preventDefault();
                if (e.target === e.currentTarget) setDropIndex(pages.length);
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                finishDrop();
              }}
            >
              {pages.map((p, i) => {
                const isSel = liveSelection.has(p.id);
                const thumb = thumbs.get(p.source);
                const dragging = dragIds?.has(p.id);
                return (
                  <div
                    key={p.id}
                    data-index={i}
                    role="option"
                    aria-label={`Page ${i + 1}${p.source !== i ? `, originally page ${p.source + 1}` : ''}${p.rotation ? `, rotated ${p.rotation} degrees` : ''}`}
                    aria-selected={isSel}
                    tabIndex={i === focus ? 0 : -1}
                    draggable
                    onDragStart={(e) => onDragStart(e, p.id)}
                    onDragEnd={() => {
                      setDragIds(null);
                      setDropIndex(null);
                    }}
                    onDragOver={(e) => onCardDragOver(e, i)}
                    onClick={(e) => onCardClick(e, i, p.id)}
                    onFocus={() => setFocus(i)}
                    class={
                      'group relative flex cursor-pointer select-none flex-col items-center gap-1.5 rounded-lg border p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-500 ' +
                      (isSel ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-line hover:border-line-strong') +
                      (dragging ? ' opacity-40' : '')
                    }
                  >
                    {dropIndex === i && <span class="absolute -left-2 top-2 bottom-2 w-1 rounded bg-brand-500" aria-hidden="true" />}
                    {dropIndex === pages.length && i === pages.length - 1 && <span class="absolute -right-2 top-2 bottom-2 w-1 rounded bg-brand-500" aria-hidden="true" />}
                    <div class="flex aspect-square w-full items-center justify-center overflow-hidden rounded bg-surface-3">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={`Page ${i + 1}`}
                          draggable={false}
                          class="h-full w-full object-contain transition-transform duration-200"
                          style={{ transform: `rotate(${p.rotation}deg)` }}
                        />
                      ) : (
                        <Icon name="loader" size={18} class="animate-spin text-ink-3" />
                      )}
                    </div>
                    <div class="flex w-full items-center justify-between text-xs">
                      <span class="font-medium text-ink">{i + 1}</span>
                      <span class="text-ink-3">
                        {p.source !== i ? `p.${p.source + 1}` : ''}
                        {p.rotation ? ` ${p.rotation}°` : ''}
                      </span>
                      {isSel && <Icon name="check-circle" size={14} class="text-brand-600" />}
                    </div>
                    <div class="absolute right-1.5 top-1.5 hidden gap-0.5 rounded-md border border-line bg-surface/95 p-0.5 shadow-sm group-hover:flex group-focus-within:flex">
                      <CardButton icon="rotate-ccw" title="Rotate left" onClick={() => rotate(-90, p.id)} />
                      <CardButton icon="rotate-cw" title="Rotate right" onClick={() => rotate(90, p.id)} />
                      <CardButton icon="copy" title="Duplicate" onClick={() => duplicate(p.id)} />
                      <CardButton icon="trash" title="Delete" onClick={() => remove(p.id)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {busy && (
            <div class="absolute inset-0 flex items-center justify-center bg-surface/75 text-sm text-ink-2">
              <Icon name="loader" size={16} class="mr-2 animate-spin" /> {busy}
            </div>
          )}
        </section>

        {/* Side panel */}
        <aside class="scrollbar-thin flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3 text-sm" aria-label={mode === 'split' ? 'Split options' : 'Save options'}>
          {mode === 'reorder' ? (
            <>
              <section>
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Arrange pages</h3>
                <ul class="space-y-1.5 text-xs leading-5 text-ink-2">
                  <li>Drag pages to a new position, or select them and press Ctrl with an arrow key.</li>
                  <li>Shift-click selects a range, Ctrl-click adds or removes one page.</li>
                  <li>R rotates, Delete removes, and Ctrl+Z undoes.</li>
                </ul>
              </section>
              {loaded && (
                <div class="rounded-md border border-line bg-surface-2 p-2.5 text-xs text-ink-2">
                  <Row label="Pages">
                    {pages.length}
                    {pages.length !== loaded.count && <span class="text-ink-3"> (was {loaded.count})</span>}
                  </Row>
                  <Row label="Rotated">{pages.filter((p) => p.rotation).length}</Row>
                  <Row label="Moved">{pages.filter((p, i) => p.source !== i).length}</Row>
                </div>
              )}
              <div class="flex gap-2">
                <button type="button" class="btn-primary btn-sm flex-1" onClick={() => void saveReordered()} disabled={!loaded || !!busy}>
                  <Icon name="download" size={14} /> Save PDF
                </button>
                <button type="button" class="btn-secondary btn-sm" onClick={resetPages} disabled={!modified} title="Back to the original order">
                  Reset
                </button>
              </div>
              {loaded && !modified && <p class="text-xs text-ink-3">No changes yet. Saving now gives a copy of the original.</p>}
            </>
          ) : (
            <>
              <section>
                <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Split into</h3>
                <div class="space-y-1.5">
                  {(
                    [
                      ['every', 'Every N pages'],
                      ['ranges', 'Custom ranges'],
                      ['each', 'One file per page'],
                      ['selection', 'Selected pages only'],
                      ['odd-even', 'Odd and even pages'],
                    ] as [SplitMode, string][]
                  ).map(([value, label]) => (
                    <label key={value} class="flex cursor-pointer items-center gap-2 text-sm">
                      <input type="radio" name="split-mode" class="accent-brand-600" checked={split.mode === value} onChange={() => setSplit((s) => ({ ...s, mode: value }))} />
                      {label}
                    </label>
                  ))}
                </div>
              </section>
              {split.mode === 'every' && (
                <label class="block">
                  <span class="text-xs text-ink-2">Pages per file</span>
                  <input
                    type="number"
                    min={1}
                    class="input mt-1 h-8 font-mono text-xs"
                    value={split.every}
                    onInput={(e) => {
                      const v = Number((e.currentTarget as HTMLInputElement).value);
                      if (Number.isFinite(v) && v >= 1) setSplit((s) => ({ ...s, every: Math.floor(v) }));
                    }}
                    aria-label="Pages per file"
                  />
                </label>
              )}
              {split.mode === 'ranges' && (
                <label class="block">
                  <span class="text-xs text-ink-2">Ranges, one file each (comma separated)</span>
                  <input class="input mt-1 h-8 font-mono text-xs" value={split.ranges} onInput={(e) => setSplit((s) => ({ ...s, ranges: (e.currentTarget as HTMLInputElement).value }))} placeholder="1-3, 4-6, 7-" aria-label="Page ranges" />
                  <span class="mt-1 block text-xs text-ink-3">Numbers follow the order shown on the left.</span>
                </label>
              )}
              {split.mode === 'selection' && <p class="text-xs text-ink-3">{liveSelection.size ? `${liveSelection.size} selected` : 'Click pages to select them.'}</p>}

              <section class="min-h-0">
                <h3 class="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink-3">
                  Result
                  {plan.parts.length > 0 && <span class="font-normal normal-case tracking-normal">{plan.parts.length} file{plan.parts.length === 1 ? '' : 's'}</span>}
                </h3>
                {plan.error ? (
                  <p class="flex items-start gap-1.5 text-xs text-danger">
                    <Icon name="alert-circle" size={13} class="mt-0.5 shrink-0" /> {plan.error}
                  </p>
                ) : !loaded ? (
                  <p class="text-xs text-ink-3">Open a PDF to see the files it will produce.</p>
                ) : (
                  <ul class="space-y-1">
                    {plan.parts.slice(0, 100).map((part) => (
                      <li key={part.name} class="flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
                        <Icon name="file-text" size={14} class="shrink-0 text-ink-3" />
                        <span class="min-w-0 flex-1">
                          <span class="block truncate text-xs font-medium" title={`${part.name}.pdf`}>
                            {part.name}.pdf
                          </span>
                          <span class="block text-[11px] text-ink-3">{describePart(part)}</span>
                        </span>
                        <HeaderButton icon="download" title={`Download ${part.name}.pdf`} onClick={() => void downloadPart(part)} disabled={!!busy} />
                      </li>
                    ))}
                    {plan.parts.length > 100 && <li class="text-xs text-ink-3">and {plan.parts.length - 100} more in the zip</li>}
                  </ul>
                )}
              </section>
              <button type="button" class="btn-primary btn-sm" onClick={() => void downloadAll()} disabled={!loaded || !plan.parts.length || !!busy}>
                <Icon name="download" size={14} /> {plan.parts.length > 1 ? `Download all as zip` : 'Download PDF'}
              </button>
            </>
          )}
          {loaded && (
            <div class="mt-auto flex flex-wrap gap-1.5 sm:hidden">
              <Chip on={false} onClick={() => preset('all')}>
                Select all
              </Chip>
              <Chip on={false} onClick={() => preset('none')}>
                Select none
              </Chip>
            </div>
          )}
        </aside>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">
          {loaded
            ? `${pages.length} page${pages.length === 1 ? '' : 's'} · ${liveSelection.size} selected · ${formatBytes(loaded.size)}${rendered < loaded.count ? ` · rendering ${rendered}/${loaded.count}` : ''}`
            : 'Your PDF is processed in this browser tab. Nothing is uploaded.'}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">←</span>
          <span class="kbd">→</span> move pages
        </span>
      </div>
    </div>
  );
}

function columnsInGrid(grid: HTMLElement | null): number {
  if (!grid) return 1;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  return Math.max(1, cols);
}

function SelectButton(p: { onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="rounded px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-surface-3 hover:text-ink" onClick={p.onClick}>
      {p.children}
    </button>
  );
}

function CardButton(p: { icon: string; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="inline-flex h-6 w-6 items-center justify-center rounded text-ink-2 hover:bg-surface-3 hover:text-ink"
      title={p.title}
      aria-label={p.title}
      onClick={(e) => {
        e.stopPropagation();
        p.onClick();
      }}
    >
      <Icon name={p.icon} size={13} />
    </button>
  );
}

function Row(p: { label: string; children: ComponentChildren }) {
  return (
    <div class="flex justify-between py-0.5">
      <span>{p.label}</span>
      <span class="font-mono text-ink">{p.children}</span>
    </div>
  );
}
