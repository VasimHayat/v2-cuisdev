/**
 * PDF Compress workspace. Two honest modes: Optimise (lossless re-save with pdf-lib,
 * text stays selectable) and Compress images (pages re-rendered with pdf.js as JPEGs,
 * much smaller but no longer selectable). Shows the real before and after size and
 * offers the original when the result is not smaller.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Icon } from '../shared/icons';
import { Chip, Segmented } from '../shared/controls';
import { toast, track } from '../shared/toast';
import { PdfOpenError, loadPdf, pageSize, renderPage, renderThumbnail } from '../shared/pdfjs';
import { downloadBlob } from '../shared/zip';
import { formatBytes } from '../pdf-converter/logic';
import { PasswordCard } from '../pdf-to-image/PasswordCard';
import { makeSamplePdf } from './sample';
import {
  CompressError,
  QUALITY_PRESETS,
  RASTER_DPIS,
  buildRasterPdf,
  compressedName,
  describeOutcome,
  normalizePrefs,
  optimizePdf,
  presetFor,
  type CompressMode,
  type Outcome,
  type Prefs,
  type QualityPreset,
  type RasterPage,
} from './logic';

const TOOL = 'pdf-compress';
const PREFS_KEY = 'cuis-pdfcompress:prefs';
const MAX_FILE = 200 * 1024 * 1024;
const PREVIEW_WIDTH = 420;

interface Result {
  mode: CompressMode;
  bytes: Uint8Array;
  outcome: Outcome;
  previewUrl: string;
  ms: number;
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

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number, grayscale: boolean): Promise<Uint8Array> {
  let source = canvas;
  if (grayscale) {
    const g = document.createElement('canvas');
    g.width = canvas.width;
    g.height = canvas.height;
    const ctx = g.getContext('2d');
    if (ctx) {
      ctx.filter = 'grayscale(1)';
      ctx.drawImage(canvas, 0, 0);
      source = g;
    }
  }
  return new Promise((resolve, reject) =>
    source.toBlob(async (b) => {
      if (source !== canvas) source.width = source.height = 0;
      if (!b) reject(new Error('The browser could not encode a page.'));
      else resolve(new Uint8Array(await b.arrayBuffer()));
    }, 'image/jpeg', quality / 100),
  );
}

export default function PdfCompress() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);
  const loadToken = useRef(0);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pw, setPw] = useState<{ needed: boolean; value: string; used?: string; error?: string }>({ needed: false, value: '' });
  const [originalPreview, setOriginalPreview] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [full, setFull] = useState(false);

  const update = (patch: Partial<Prefs>) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setResult((r) => {
      if (r?.previewUrl) URL.revokeObjectURL(r.previewUrl);
      return null;
    });
  };
  const preset = presetFor(prefs.dpi, prefs.quality);
  const pageCount = doc?.numPages ?? 0;

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  const reset = useCallback(() => {
    loadToken.current++;
    cancelRef.current = true;
    void doc?.destroy();
    setDoc(null);
    setFile(null);
    setBytes(null);
    setPw({ needed: false, value: '' });
    setOriginalPreview((u) => {
      if (u) URL.revokeObjectURL(u);
      return '';
    });
    setResult((r) => {
      if (r?.previewUrl) URL.revokeObjectURL(r.previewUrl);
      return null;
    });
    setBusy(null);
  }, [doc]);

  const openBytes = async (f: File, data: Uint8Array, password?: string) => {
    const token = ++loadToken.current;
    setBusy({ done: 0, total: 1, label: 'Opening PDF' });
    try {
      const d = await loadPdf(data, password);
      if (token !== loadToken.current) return;
      setDoc(d);
      setPw({ needed: false, value: '', used: password });
      setBusy(null);
      track('tool_action', { tool: TOOL, action: 'open', pages: d.numPages, bytes: f.size });
      const thumb = await renderThumbnail(d, 1, PREVIEW_WIDTH);
      if (token === loadToken.current) setOriginalPreview(thumb);
    } catch (err) {
      if (token !== loadToken.current) return;
      setBusy(null);
      if (err instanceof PdfOpenError && /password/i.test(err.message)) setPw({ needed: true, value: '', error: password ? err.message : undefined });
      else {
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

  const compress = async () => {
    if (!file || !bytes || !doc || busy) return;
    cancelRef.current = false;
    setResult((r) => {
      if (r?.previewUrl) URL.revokeObjectURL(r.previewUrl);
      return null;
    });
    const t0 = performance.now();
    try {
      let out: Uint8Array;
      if (prefs.mode === 'optimize') {
        if (pw.used) throw new CompressError('Optimise cannot rewrite a password-protected PDF. Use Compress images, or remove the password first.');
        setBusy({ done: 0, total: 1, label: 'Optimising' });
        out = await optimizePdf(bytes, { keepMetadata: prefs.keepMetadata });
      } else {
        const pages: RasterPage[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          if (cancelRef.current) {
            toast('Stopped. Nothing was written.');
            return;
          }
          setBusy({ done: n - 1, total: doc.numPages, label: `Compressing page ${n} of ${doc.numPages}` });
          const pts = await pageSize(doc, n);
          const canvas = await renderPage(doc, n, { scale: prefs.dpi / 72 });
          const jpeg = await canvasToJpeg(canvas, prefs.quality, prefs.grayscale);
          canvas.width = canvas.height = 0;
          pages.push({ jpeg, width: pts.width, height: pts.height });
        }
        setBusy({ done: doc.numPages, total: doc.numPages, label: 'Writing the PDF' });
        out = await buildRasterPdf(pages, { title: file.name.replace(/\.pdf$/i, '') });
      }
      const outcome = describeOutcome(bytes.length, out.length);
      let previewUrl = '';
      if (prefs.mode === 'raster') {
        const rd = await loadPdf(out);
        previewUrl = await renderThumbnail(rd, 1, PREVIEW_WIDTH);
        void rd.destroy();
      }
      setResult({ mode: prefs.mode, bytes: out, outcome, previewUrl, ms: Math.round(performance.now() - t0) });
      track('tool_action', { tool: TOOL, action: 'compress', mode: prefs.mode, before: bytes.length, after: out.length, dpi: prefs.dpi, quality: prefs.quality });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Compression failed.', 'error', 5000);
    } finally {
      setBusy(null);
    }
  };

  const downloadResult = () => {
    if (!result || !file) return;
    downloadBlob(new Blob([result.bytes as BlobPart], { type: 'application/pdf' }), compressedName(file.name));
    track('tool_action', { tool: TOOL, action: 'download', mode: result.mode });
  };
  const downloadOriginal = () => {
    if (!file) return;
    downloadBlob(file, file.name);
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && full) setFull(false);
      else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void compress();
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

  const o = result?.outcome;

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
        {/* Preview */}
        <section
          class={'relative flex h-[420px] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-surface lg:h-auto ' + (dragOver ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-line-strong')}
          aria-label="Preview"
        >
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 text-xs">
            <span class="font-semibold text-ink">{result?.mode === 'raster' ? 'Page 1: original and compressed' : 'Page 1'}</span>
            {o && (
              <span class={'badge ' + (o.larger || o.noGain ? 'border-warning/50 bg-warning/10 text-ink-2' : 'border-success/40 bg-success/10 text-success')}>
                {o.larger ? `+${Math.abs(o.percent)}%` : `−${o.percent}%`}
              </span>
            )}
          </header>
          {!file && !pw.needed ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Icon name="minimize-2" size={26} />
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
              <p class="max-w-sm text-xs leading-5 text-ink-3">The file is processed in your browser. Nothing is uploaded.</p>
            </div>
          ) : pw.needed ? (
            <PasswordCard value={pw.value} error={pw.error} onChange={(v) => setPw((p) => ({ ...p, value: v }))} onSubmit={() => file && bytes && void openBytes(file, bytes, pw.value)} />
          ) : (
            <div class="scrollbar-thin grid min-h-0 flex-1 auto-rows-min gap-3 overflow-y-auto bg-surface-3/50 p-3 sm:grid-cols-2">
              <Figure label={`Original · ${formatBytes(bytes?.length ?? 0)}`} url={originalPreview} />
              {result?.mode === 'raster' ? (
                <Figure label={`Compressed · ${formatBytes(result.bytes.length)}`} url={result.previewUrl} />
              ) : (
                <div class="flex flex-col justify-center gap-2 rounded-md border border-dashed border-line-strong p-4 text-xs leading-5 text-ink-2">
                  {result ? (
                    <>
                      <p class="font-medium text-ink">Optimised without touching page content.</p>
                      <p>Text, links and vector graphics are unchanged, so the pages look identical to the original.</p>
                    </>
                  ) : prefs.mode === 'raster' ? (
                    <p>Run Compress images to see page 1 after compression next to the original.</p>
                  ) : (
                    <p>Optimise re-saves the file without changing what the pages look like.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {busy && (
            <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/80 text-sm text-ink-2">
              <Icon name="loader" size={18} class="animate-spin" />
              <span>{busy.label}</span>
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
        </section>

        {/* Options and result */}
        <aside class="scrollbar-thin flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3 text-sm" aria-label="Compression options">
          <div role="radiogroup" aria-label="Compression mode" class="grid gap-2">
            <ModeCard
              on={prefs.mode === 'optimize'}
              onClick={() => update({ mode: 'optimize' })}
              title="Optimise (lossless)"
              text="Re-saves the PDF compactly and drops unused data. Text stays selectable and searchable. Usually a small saving."
            />
            <ModeCard
              on={prefs.mode === 'raster'}
              onClick={() => update({ mode: 'raster' })}
              title="Compress images (strong)"
              text="Re-renders every page as a JPEG. Big savings on scans and photos, but text is no longer selectable or searchable."
              warn
            />
          </div>

          {prefs.mode === 'optimize' ? (
            <Chip on={prefs.keepMetadata} onClick={() => update({ keepMetadata: !prefs.keepMetadata })} title="Keep title, author, subject and keywords">
              Keep document info
            </Chip>
          ) : (
            <>
              <Field label="Preset">
                <Segmented
                  value={(preset ?? 'custom') as QualityPreset | 'custom'}
                  onChange={(v) => {
                    if (v === 'custom') return;
                    const p = QUALITY_PRESETS[v as QualityPreset];
                    update({ dpi: p.dpi, quality: p.quality });
                  }}
                  options={[
                    ...(Object.keys(QUALITY_PRESETS) as QualityPreset[]).map((k) => ({ value: k as QualityPreset | 'custom', label: QUALITY_PRESETS[k].label })),
                    { value: 'custom' as const, label: 'Custom', disabled: preset !== null },
                  ]}
                  label="Quality preset"
                />
              </Field>
              <Field label="Resolution">
                <div class="flex flex-wrap gap-1">
                  {RASTER_DPIS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      class={'rounded-md border px-2 py-1 text-xs ' + (prefs.dpi === d ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong text-ink-2 hover:bg-surface-3')}
                      onClick={() => update({ dpi: d })}
                    >
                      {d} dpi
                    </button>
                  ))}
                </div>
              </Field>
              <label class="block">
                <span class="flex items-center justify-between text-xs text-ink-2">
                  <span>JPEG quality</span>
                  <span class="font-mono tabular-nums">{prefs.quality}</span>
                </span>
                <input type="range" class="mt-1 w-full accent-brand-600" min={20} max={95} value={prefs.quality} onInput={(e) => update({ quality: Number((e.currentTarget as HTMLInputElement).value) })} aria-label="JPEG quality" />
              </label>
              <Chip on={prefs.grayscale} onClick={() => update({ grayscale: !prefs.grayscale })} title="Convert pages to grayscale for an extra saving">
                Grayscale
              </Chip>
            </>
          )}

          <button type="button" class="btn-primary" onClick={() => void compress()} disabled={!doc || !!busy} title="Compress (Ctrl+Enter)">
            <Icon name="minimize-2" size={15} /> {prefs.mode === 'optimize' ? 'Optimise PDF' : 'Compress PDF'}
          </button>

          {result && o && (
            <div class={'rounded-md border p-3 text-xs ' + (o.larger || o.noGain ? 'border-warning/50 bg-warning/10' : 'border-success/40 bg-success/10')} aria-live="polite">
              <div class="grid grid-cols-2 gap-y-1">
                <span class="text-ink-2">Before</span>
                <span class="text-right font-mono">{formatBytes(o.before)}</span>
                <span class="text-ink-2">After</span>
                <span class="text-right font-mono">{formatBytes(o.after)}</span>
                <span class="text-ink-2">Change</span>
                <span class={'text-right font-mono ' + (o.larger ? 'text-danger' : 'text-success')}>{o.larger ? `+${Math.abs(o.percent)}%` : `−${o.percent}%`}</span>
              </div>
              <p class="mt-2 leading-5 text-ink-2">{o.message}</p>
              <div class="mt-3 flex flex-col gap-2">
                {o.larger ? (
                  <>
                    <button type="button" class="btn-primary btn-sm" onClick={downloadOriginal}>
                      <Icon name="download" size={13} /> Keep the original
                    </button>
                    <button type="button" class="btn-ghost btn-sm" onClick={downloadResult}>
                      Download the larger result anyway
                    </button>
                  </>
                ) : (
                  <button type="button" class="btn-primary btn-sm" onClick={downloadResult}>
                    <Icon name="download" size={13} /> Download {file ? compressedName(file.name) : ''}
                  </button>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">{result ? `${result.mode === 'optimize' ? 'Optimised' : 'Compressed'} ${pageCount} page${pageCount === 1 ? '' : 's'} in ${(result.ms / 1000).toFixed(1)} s. Nothing was uploaded.` : 'Processed in your browser. Nothing is uploaded.'}</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> compress
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

function ModeCard(p: { on: boolean; onClick: () => void; title: string; text: string; warn?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={p.on}
      onClick={p.onClick}
      class={'rounded-md border p-2.5 text-left transition-colors ' + (p.on ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30' : 'border-line-strong hover:bg-surface-3')}
    >
      <span class="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <span class={'flex h-4 w-4 items-center justify-center rounded-full border ' + (p.on ? 'border-brand-600' : 'border-line-strong')}>{p.on && <span class="h-2 w-2 rounded-full bg-brand-600" />}</span>
        {p.title}
      </span>
      <span class="mt-1 block text-xs leading-5 text-ink-2">
        {p.warn && p.on && <Icon name="alert-circle" size={12} class="mr-1 inline -translate-y-px text-warning" />}
        {p.text}
      </span>
    </button>
  );
}

function Figure({ label, url }: { label: string; url: string }) {
  return (
    <figure class="flex min-w-0 flex-col gap-1.5">
      <figcaption class="text-xs text-ink-2">{label}</figcaption>
      <div class="flex min-h-[200px] items-center justify-center overflow-hidden rounded-md border border-line bg-white">
        {url ? <img src={url} alt={label} class="block h-auto w-full" /> : <Icon name="loader" size={16} class="animate-spin text-ink-3" />}
      </div>
    </figure>
  );
}
