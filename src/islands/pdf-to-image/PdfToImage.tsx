/**
 * PDF to Image workspace: open a PDF, pick pages from thumbnails or a range, choose
 * format and resolution, and render each page with pdf.js to PNG, JPG or WebP. Pages
 * can also be stacked into one tall image. Everything runs in the browser.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { toast, track } from '../shared/toast';
import { PdfOpenError, loadPdf, pageSize, renderPage, renderThumbnail } from '../shared/pdfjs';
import { buildZip, downloadBlob } from '../shared/zip';
import { formatBytes } from '../pdf-converter/logic';
import { makeSamplePdf } from '../pdf-compress/sample';
import { PasswordCard } from './PasswordCard';
import {
  DPI_PRESETS,
  FORMATS,
  MAX_MEGAPIXELS,
  combineLayout,
  combinedName,
  exceedsLimit,
  formatInfo,
  maxSafeDpi,
  normalizeHex,
  normalizePrefs,
  outputName,
  pixelSize,
  rangeFromSelection,
  selectionFromRange,
  type Dpi,
  type ImageFormat,
  type Prefs,
  type Size,
} from './logic';

const TOOL = 'pdf-to-image';
const PREFS_KEY = 'cuis-pdf2img:prefs';
const MAX_FILE = 200 * 1024 * 1024;

interface Result {
  page: number;
  name: string;
  blob: Blob;
  url: string;
  width: number;
  height: number;
}

interface Busy {
  done: number;
  total: number;
  label: string;
}

function loadPrefs(): Prefs {
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'));
  } catch {
    return normalizePrefs(null);
  }
}

function supportsWebp(): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode this image.'))), mime, quality));
}

export default function PdfToImage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const loadToken = useRef(0);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [rangeText, setRangeText] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [combined, setCombined] = useState<Result | null>(null);
  const [view, setView] = useState<'pages' | 'images'>('pages');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [password, setPassword] = useState<{ needed: boolean; value: string; error?: string }>({ needed: false, value: '' });
  const [preview, setPreview] = useState<Result | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [full, setFull] = useState(false);
  const [webp] = useState(supportsWebp);

  const pageCount = doc?.numPages ?? 0;
  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const info = formatInfo(prefs.format);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  const clearResults = useCallback(() => {
    setResults((rs) => {
      rs.forEach((r) => URL.revokeObjectURL(r.url));
      return [];
    });
    setCombined((c) => {
      if (c) URL.revokeObjectURL(c.url);
      return null;
    });
    setPreview(null);
  }, []);

  const reset = useCallback(() => {
    loadToken.current++;
    cancelRef.current = true;
    clearResults();
    setThumbs((ts) => {
      ts.forEach((t) => t && URL.revokeObjectURL(t));
      return [];
    });
    void doc?.destroy();
    setDoc(null);
    setFile(null);
    setBytes(null);
    setSizes([]);
    setSelected(new Set());
    setRangeText('');
    setRangeError(null);
    setPassword({ needed: false, value: '' });
    setView('pages');
    setBusy(null);
  }, [doc, clearResults]);

  // ------------------------------------------------------------------ loading

  const openBytes = async (f: File, data: Uint8Array, pw?: string) => {
    const token = ++loadToken.current;
    setBusy({ done: 0, total: 1, label: 'Opening PDF' });
    try {
      const d = await loadPdf(data, pw);
      if (token !== loadToken.current) return;
      setDoc(d);
      setPassword({ needed: false, value: '' });
      const all = new Set(Array.from({ length: d.numPages }, (_, i) => i + 1));
      setSelected(all);
      setRangeText('');
      setView('pages');
      setBusy(null);
      track('tool_action', { tool: TOOL, action: 'open', pages: d.numPages, bytes: f.size });
      // Page sizes first (cheap), then thumbnails one by one.
      const s: Size[] = [];
      for (let i = 1; i <= d.numPages; i++) s.push(await pageSize(d, i));
      if (token !== loadToken.current) return;
      setSizes(s);
      const t: string[] = new Array(d.numPages).fill('');
      for (let i = 1; i <= d.numPages; i++) {
        if (token !== loadToken.current) return;
        t[i - 1] = await renderThumbnail(d, i, 150);
        setThumbs([...t]);
      }
    } catch (err) {
      if (token !== loadToken.current) return;
      setBusy(null);
      if (err instanceof PdfOpenError && /password/i.test(err.message)) {
        setPassword({ needed: true, value: '', error: pw ? err.message : undefined });
      } else {
        toast(err instanceof Error ? err.message : 'The PDF could not be opened.', 'error', 4000);
        setFile(null);
        setBytes(null);
      }
    }
  };

  const open = async (f: File) => {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
      toast('That is not a PDF file.', 'error');
      return;
    }
    if (f.size > MAX_FILE) {
      toast(`The file is larger than ${formatBytes(MAX_FILE)}.`, 'error');
      return;
    }
    reset();
    cancelRef.current = false;
    const data = new Uint8Array(await f.arrayBuffer());
    setFile(f);
    setBytes(data);
    await openBytes(f, data);
  };

  const loadSample = async () => {
    setBusy({ done: 0, total: 1, label: 'Creating a sample PDF' });
    try {
      await open(await makeSamplePdf());
    } catch (err) {
      setBusy(null);
      toast(err instanceof Error ? err.message : 'Could not create the sample.', 'error');
    }
  };

  // ------------------------------------------------------------------ selection

  const toggle = (n: number) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      setRangeText(rangeFromSelection(next, pageCount));
      setRangeError(null);
      return next;
    });
  };
  const selectAll = (on: boolean) => {
    setSelected(on ? new Set(Array.from({ length: pageCount }, (_, i) => i + 1)) : new Set());
    setRangeText(on ? '' : '');
    setRangeError(null);
  };
  const onRange = (text: string) => {
    setRangeText(text);
    if (!pageCount) return;
    try {
      setSelected(selectionFromRange(text, pageCount));
      setRangeError(null);
    } catch (err) {
      setRangeError(err instanceof Error ? err.message : 'Invalid range');
    }
  };

  const ordered = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  const first = sizes[(ordered[0] ?? 1) - 1];
  const firstPx = first ? pixelSize(first, prefs.dpi) : null;
  const tooBig = first ? exceedsLimit(first, prefs.dpi) : false;

  // ------------------------------------------------------------------ rendering

  const convert = async () => {
    if (!doc || !file || ordered.length === 0 || busy) return;
    if (prefs.format === 'webp' && !webp) {
      toast('This browser cannot encode WebP. Choose PNG or JPG.', 'error');
      return;
    }
    clearResults();
    cancelRef.current = false;
    const mime = info.mime;
    const quality = info.lossy ? prefs.quality / 100 : undefined;
    const background = prefs.format === 'png' && prefs.transparent ? 'rgba(0,0,0,0)' : prefs.background;
    const t0 = performance.now();
    const out: Result[] = [];
    const skipped: number[] = [];
    try {
      if (prefs.combine) {
        const pxSizes = ordered.map((n) => pixelSize(sizes[n - 1] ?? { width: 612, height: 792 }, prefs.dpi));
        const layout = combineLayout(pxSizes);
        const big = document.createElement('canvas');
        big.width = layout.width;
        big.height = layout.height;
        const ctx = big.getContext('2d');
        if (!ctx) throw new Error('Canvas is not available.');
        if (background !== 'rgba(0,0,0,0)') {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, big.width, big.height);
        }
        for (let i = 0; i < ordered.length; i++) {
          if (cancelRef.current) break;
          const n = ordered[i]!;
          setBusy({ done: i, total: ordered.length, label: `Rendering page ${n}` });
          const scale = (prefs.dpi / 72) * layout.scale;
          const canvas = await renderPage(doc, n, { scale, background });
          const p = layout.placements[i]!;
          ctx.drawImage(canvas, p.x, p.y, p.width, p.height);
          canvas.width = canvas.height = 0;
        }
        if (!cancelRef.current) {
          setBusy({ done: ordered.length, total: ordered.length, label: 'Encoding' });
          const blob = await toBlob(big, mime, quality);
          const r = { page: 0, name: combinedName(file.name, prefs.format), blob, url: URL.createObjectURL(blob), width: big.width, height: big.height };
          setCombined(r);
          setPreview(r);
          if (layout.scale < 1) toast(`Scaled to ${Math.round(layout.scale * 100)}% to stay within the ${layout.height}px height limit`);
        }
        big.width = big.height = 0;
      } else {
        for (let i = 0; i < ordered.length; i++) {
          if (cancelRef.current) break;
          const n = ordered[i]!;
          setBusy({ done: i, total: ordered.length, label: `Rendering page ${n}` });
          const pts = sizes[n - 1];
          if (pts && exceedsLimit(pts, prefs.dpi)) {
            skipped.push(n);
            continue;
          }
          const canvas = await renderPage(doc, n, { scale: prefs.dpi / 72, background });
          const blob = await toBlob(canvas, mime, quality);
          const r = { page: n, name: outputName(file.name, n, prefs.format), blob, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
          canvas.width = canvas.height = 0;
          out.push(r);
          setResults([...out]);
        }
      }
      setView('images');
      if (cancelRef.current) toast('Stopped. The pages finished so far are kept.');
      else if (skipped.length) toast(`Skipped ${skipped.length} page(s) above ${MAX_MEGAPIXELS} megapixels. Lower the resolution to include them.`, 'error', 5000);
      track('tool_action', { tool: TOOL, action: 'convert', pages: ordered.length, format: prefs.format, dpi: prefs.dpi, combine: prefs.combine, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Rendering failed.', 'error', 4000);
    } finally {
      setBusy(null);
    }
  };

  const downloadAll = async () => {
    if (!file || results.length === 0) return;
    if (results.length === 1) {
      downloadBlob(results[0]!.blob, results[0]!.name);
      return;
    }
    setBusy({ done: 0, total: 1, label: 'Building the zip' });
    try {
      const zip = await buildZip(results.map((r) => ({ name: r.name, data: r.blob })));
      downloadBlob(zip, `${file.name.replace(/\.pdf$/i, '')}-images.zip`);
      track('tool_action', { tool: TOOL, action: 'zip', count: results.length });
    } finally {
      setBusy(null);
    }
  };

  // ------------------------------------------------------------------ shell

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (preview) setPreview(null);
        else if (full) setFull(false);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void convert();
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

  const totalOut = results.reduce((n, r) => n + r.blob.size, 0) + (combined?.blob.size ?? 0);
  const hasOutput = results.length > 0 || !!combined;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      class={'flex flex-col bg-surface-2 text-ink outline-none ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(82vh,900px)] min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm')}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const f = e.dataTransfer?.files?.[0];
        if (f) void open(f);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void open(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2 pt-1">
        <button type="button" class="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
          <Icon name="folder-open" size={14} /> Open PDF
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => void loadSample()} disabled={!!busy}>
          <Icon name="sparkles" size={14} /> Sample
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={reset} disabled={!file && !busy}>
          <Icon name="eraser" size={14} /> Clear
        </button>
        <span class="min-w-0 flex-1 truncate px-2 text-xs text-ink-3">{file ? `${file.name} · ${pageCount} page${pageCount === 1 ? '' : 's'} · ${formatBytes(file.size)}` : ''}</span>
        <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* Pages / images */}
        <section
          class={'relative flex h-[420px] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-surface lg:h-auto ' + (dragOver ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-line-strong')}
          aria-label="Pages"
        >
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-2 text-xs">
            {doc ? (
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'pages', label: `Pages (${selected.size}/${pageCount})` },
                  { value: 'images', label: `Images${hasOutput ? ` (${combined ? 1 : results.length})` : ''}`, disabled: !hasOutput },
                ]}
                label="View"
              />
            ) : (
              <span class="pl-1 font-semibold text-ink">Pages</span>
            )}
            <span class="flex-1" />
            {doc && view === 'pages' && (
              <>
                <button type="button" class="btn-ghost btn-sm h-7 text-xs" onClick={() => selectAll(true)}>
                  All
                </button>
                <button type="button" class="btn-ghost btn-sm h-7 text-xs" onClick={() => selectAll(false)}>
                  None
                </button>
              </>
            )}
            {view === 'images' && hasOutput && <span class="text-ink-3">{formatBytes(totalOut)}</span>}
          </header>

          {!doc && !password.needed ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Icon name="file-image" size={26} />
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
              <p class="max-w-sm text-xs leading-5 text-ink-3">Pages are rendered with pdf.js in your browser. Nothing is uploaded.</p>
            </div>
          ) : password.needed ? (
            <PasswordCard
              value={password.value}
              error={password.error}
              onChange={(v) => setPassword((p) => ({ ...p, value: v }))}
              onSubmit={() => file && bytes && void openBytes(file, bytes, password.value)}
            />
          ) : view === 'pages' ? (
            <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
              <ul class="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3" aria-label="Pages to convert">
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => {
                  const on = selected.has(n);
                  return (
                    <li key={n}>
                      <button
                        type="button"
                        class={'group relative block w-full overflow-hidden rounded-md border-2 bg-surface-3 transition-colors ' + (on ? 'border-brand-500' : 'border-transparent opacity-60 hover:opacity-100')}
                        onClick={() => toggle(n)}
                        aria-pressed={on}
                        aria-label={`Page ${n}`}
                      >
                        {thumbs[n - 1] ? <img src={thumbs[n - 1]} alt="" class="block h-auto w-full" /> : <span class="flex aspect-[3/4] items-center justify-center"><Icon name="loader" size={16} class="animate-spin text-ink-3" /></span>}
                        <span class={'absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded ' + (on ? 'bg-brand-600 text-white' : 'border border-line-strong bg-surface text-transparent')}>
                          <Icon name="check" size={12} />
                        </span>
                      </button>
                      <div class="mt-1 text-center text-[11px] text-ink-3">{n}</div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
              <ul class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3" aria-label="Rendered images">
                {(combined ? [combined] : results).map((r) => (
                  <li key={r.name} class="overflow-hidden rounded-md border border-line bg-surface-2">
                    <button type="button" class="block w-full bg-[repeating-conic-gradient(var(--color-surface-3)_0_25%,transparent_0_50%)] bg-[length:16px_16px]" onClick={() => setPreview(r)} title="Show large">
                      <img src={r.url} alt={r.page ? `Page ${r.page}` : 'Combined pages'} class="mx-auto block max-h-48 w-auto" />
                    </button>
                    <div class="flex items-center gap-1 border-t border-line px-2 py-1 text-[11px]">
                      <span class="min-w-0 flex-1 truncate" title={r.name}>
                        {r.page ? `Page ${r.page}` : 'All pages'} · {r.width}×{r.height} · {formatBytes(r.blob.size)}
                      </span>
                      <HeaderButton icon="download" title={`Download ${r.name}`} onClick={() => downloadBlob(r.blob, r.name)} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {busy && (
            <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/80 text-sm text-ink-2">
              <Icon name="loader" size={18} class="animate-spin" />
              <span>
                {busy.label}
                {busy.total > 1 ? ` (${busy.done}/${busy.total})` : ''}
              </span>
              {busy.total > 1 && (
                <>
                  <span class="h-1.5 w-48 overflow-hidden rounded-full bg-line">
                    <span class="block h-full bg-brand-600 transition-[width]" style={{ width: `${Math.round((busy.done / busy.total) * 100)}%` }} />
                  </span>
                  <button type="button" class="btn-secondary btn-sm mt-1" onClick={() => (cancelRef.current = true)}>
                    <Icon name="x" size={13} /> Cancel
                  </button>
                </>
              )}
            </div>
          )}

          {preview && (
            <div class="absolute inset-0 z-20 flex flex-col bg-surface" role="dialog" aria-label="Image preview">
              <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-2 text-xs">
                <span class="font-semibold">{preview.page ? `Page ${preview.page}` : 'All pages'}</span>
                <span class="text-ink-3">
                  {preview.width}×{preview.height} · {formatBytes(preview.blob.size)}
                </span>
                <span class="flex-1" />
                <HeaderButton icon="download" title={`Download ${preview.name}`} onClick={() => downloadBlob(preview.blob, preview.name)} />
                <HeaderButton icon="x" title="Close preview (Esc)" onClick={() => setPreview(null)} />
              </div>
              <div class="scrollbar-thin min-h-0 flex-1 overflow-auto bg-[repeating-conic-gradient(var(--color-surface-3)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3">
                <img src={preview.url} alt="" class="mx-auto block h-auto max-w-full shadow-float" />
              </div>
            </div>
          )}
        </section>

        {/* Options */}
        <aside class="scrollbar-thin flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3 text-sm" aria-label="Options">
          <Field label="Pages">
            <input
              class={'input h-8 font-mono text-xs ' + (rangeError ? 'border-danger' : '')}
              value={rangeText}
              placeholder={pageCount ? `all (1-${pageCount})` : 'e.g. 1-3, 7'}
              onInput={(e) => onRange((e.currentTarget as HTMLInputElement).value)}
              disabled={!doc}
              aria-label="Page range"
            />
            {rangeError && <p class="mt-1 text-xs text-danger">{rangeError}</p>}
          </Field>
          <Field label="Format">
            <Segmented value={prefs.format} onChange={(format: ImageFormat) => update({ format })} options={FORMATS.map((f) => ({ value: f.id, label: f.label, disabled: f.id === 'webp' && !webp }))} label="Image format" />
          </Field>
          <Field label="Resolution">
            <div class="flex flex-wrap gap-1">
              {DPI_PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  class={'rounded-md border px-2 py-1 text-xs ' + (prefs.dpi === d ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong text-ink-2 hover:bg-surface-3')}
                  onClick={() => update({ dpi: d as Dpi })}
                >
                  {d} dpi
                </button>
              ))}
            </div>
            {firstPx && (
              <p class={'mt-1.5 text-xs ' + (tooBig ? 'text-danger' : 'text-ink-3')}>
                Page {ordered[0] ?? 1}: {firstPx.width} × {firstPx.height} px
                {tooBig ? ` is above ${MAX_MEGAPIXELS} MP. Use ${maxSafeDpi(first!)} dpi or lower.` : ''}
              </p>
            )}
          </Field>
          {info.lossy && (
            <label class="block">
              <span class="flex items-center justify-between text-xs text-ink-2">
                <span>Quality</span>
                <span class="font-mono tabular-nums">{prefs.quality}</span>
              </span>
              <input type="range" class="mt-1 w-full accent-brand-600" min={10} max={100} value={prefs.quality} onInput={(e) => update({ quality: Number((e.currentTarget as HTMLInputElement).value) })} aria-label="Quality" />
            </label>
          )}
          <Field label="Background">
            <div class="flex items-center gap-2">
              <input
                type="color"
                class="h-8 w-10 cursor-pointer rounded border border-line-strong bg-surface p-0.5 disabled:opacity-40"
                value={prefs.background}
                disabled={prefs.format === 'png' && prefs.transparent}
                onInput={(e) => update({ background: normalizeHex((e.currentTarget as HTMLInputElement).value, prefs.background) })}
                aria-label="Background colour"
              />
              {prefs.format === 'png' && (
                <Chip on={prefs.transparent} onClick={() => update({ transparent: !prefs.transparent })} title="Keep areas without content transparent">
                  Transparent
                </Chip>
              )}
            </div>
          </Field>
          <Chip on={prefs.combine} onClick={() => update({ combine: !prefs.combine })} title="Stack the selected pages into one tall image">
            Combine into one image
          </Chip>

          <div class="mt-auto flex flex-col gap-2 border-t border-line pt-3">
            <button type="button" class="btn-primary" onClick={() => void convert()} disabled={!doc || ordered.length === 0 || !!busy || !!rangeError} title="Convert (Ctrl+Enter)">
              <Icon name="image" size={15} /> Convert {ordered.length || ''} page{ordered.length === 1 ? '' : 's'} to {info.label}
            </button>
            <button type="button" class="btn-secondary" onClick={() => (combined ? downloadBlob(combined.blob, combined.name) : void downloadAll())} disabled={!hasOutput || !!busy}>
              <Icon name="download" size={15} /> {combined ? 'Download image' : results.length > 1 ? `Download all as zip (${results.length})` : 'Download'}
            </button>
          </div>
        </aside>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">{hasOutput ? `${combined ? 1 : results.length} image${(combined ? 1 : results.length) === 1 ? '' : 's'} · ${formatBytes(totalOut)}. Rendered in your browser, nothing uploaded.` : 'Rendered in your browser with pdf.js. Nothing is uploaded.'}</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> convert
        </span>
      </div>
    </div>
  );
}

function Field(p: { label: string; children: ComponentChildren }) {
  return (
    <div>
      <div class="mb-1 text-xs text-ink-2">{p.label}</div>
      {p.children}
    </div>
  );
}
