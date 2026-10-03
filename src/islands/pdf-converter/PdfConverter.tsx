/**
 * PDF Converter workspace: a sortable list of images and PDFs on the left becomes one
 * PDF; page and image options on the right. Images become pages, PDFs contribute their
 * pages (optionally a range), in list order. pdf-lib loads on first use.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { toast, track } from '../shared/toast';
import { buildPdf, downloadBytes, makeId, makeSamples, readImageInfo, readPdfInfo, type Progress } from './pdf';
import {
  DEFAULT_OPTIONS,
  MARGINS,
  MAX_FILE_BYTES,
  MAX_ITEMS,
  MAX_TOTAL_BYTES,
  PAGE_SIZES,
  PdfError,
  classify,
  describeBatch,
  formatBytes,
  moveItem,
  outputFileName,
  pagesFor,
  parsePageRange,
  totalPages,
  type BuildOptions,
  type Item,
  type MarginId,
  type PageSizeId,
} from './logic';

const TOOL = 'pdf-converter';
const PREFS_KEY = 'cuis-pdf:options';

function loadOptions(): BuildOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<BuildOptions> | null;
    if (!raw) return DEFAULT_OPTIONS;
    const o = { ...DEFAULT_OPTIONS };
    if (raw.pageSize === 'fit' || (raw.pageSize && raw.pageSize in PAGE_SIZES)) o.pageSize = raw.pageSize;
    if (raw.orientation === 'auto' || raw.orientation === 'portrait' || raw.orientation === 'landscape') o.orientation = raw.orientation;
    if (raw.margin && raw.margin in MARGINS) o.margin = raw.margin;
    if (raw.fit === 'contain' || raw.fit === 'cover') o.fit = raw.fit;
    if (typeof raw.quality === 'number' && raw.quality >= 1 && raw.quality <= 100) o.quality = Math.round(raw.quality);
    if (typeof raw.keepOriginal === 'boolean') o.keepOriginal = raw.keepOriginal;
    if (typeof raw.author === 'string') o.author = raw.author.slice(0, 120);
    return o;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

export default function PdfConverter() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [options, setOptions] = useState<BuildOptions>(() => (typeof window === 'undefined' ? DEFAULT_OPTIONS : loadOptions()));
  const [busy, setBusy] = useState<Progress | null>(null);
  const [result, setResult] = useState<{ url: string; bytes: number; pages: number; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...options, title: '' }));
    } catch {}
  }, [options]);

  const update = (patch: Partial<BuildOptions>) => setOptions((o) => ({ ...o, ...patch }));
  const patchItem = (id: string, patch: Partial<Item> | ((i: Item) => Partial<Item>)) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...(typeof patch === 'function' ? patch(i) : patch) } : i)));

  // Any change to the inputs invalidates the last result
  useEffect(() => {
    setResult((r) => {
      if (r) URL.revokeObjectURL(r.url);
      return null;
    });
  }, [items, options]);

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      const accepted: Item[] = [];
      let rejected = 0;
      const currentBytes = items.reduce((n, i) => n + i.size, 0);
      let bytes = currentBytes;
      for (const file of list) {
        const kind = classify(file);
        if (!kind) {
          rejected++;
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          toast(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}`, 'error');
          continue;
        }
        if (bytes + file.size > MAX_TOTAL_BYTES) {
          toast(`Batch limit of ${formatBytes(MAX_TOTAL_BYTES)} reached`, 'error');
          break;
        }
        if (items.length + accepted.length >= MAX_ITEMS) {
          toast(`At most ${MAX_ITEMS} files at once`, 'error');
          break;
        }
        bytes += file.size;
        accepted.push({ id: makeId(), kind, file, name: file.name, size: file.size, rotation: 0, range: '', loading: true });
      }
      if (rejected) toast(`${rejected} file${rejected === 1 ? ' was' : 's were'} skipped: only images and PDFs are accepted`, 'error', 3500);
      if (accepted.length === 0) return;
      setItems((cur) => [...cur, ...accepted]);
      track('tool_action', { tool: TOOL, action: 'add', count: accepted.length });

      // Inspect each file in the background
      for (const item of accepted) {
        try {
          if (item.kind === 'image') {
            const info = await readImageInfo(item.file);
            patchItem(item.id, { dims: info.dims, thumb: info.thumb, loading: false });
          } else {
            const info = await readPdfInfo(item.file);
            patchItem(item.id, { pageCount: info.pageCount, encrypted: info.encrypted, loading: false });
          }
        } catch (err) {
          patchItem(item.id, { error: err instanceof Error ? err.message : 'Could not read this file', loading: false });
        }
      }
    },
    [items],
  );

  const remove = (id: string) =>
    setItems((list) => {
      const it = list.find((i) => i.id === id);
      if (it?.thumb) URL.revokeObjectURL(it.thumb);
      return list.filter((i) => i.id !== id);
    });
  const clear = () => {
    items.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb));
    setItems([]);
  };
  const move = (from: number, to: number) => setItems((list) => moveItem(list, from, to));
  const sortByName = () => setItems((list) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })));
  const reverse = () => setItems((list) => [...list].reverse());

  const loadSample = async () => {
    setBusy({ done: 0, total: 1, label: 'Creating samples' });
    try {
      await addFiles(await makeSamples());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not create samples', 'error');
    } finally {
      setBusy(null);
    }
  };

  const ready = items.length > 0 && items.every((i) => !i.loading && !i.error) && totalPages(items) > 0;
  const rangeErrors = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) {
      if (i.kind !== 'pdf' || !i.pageCount || !i.range.trim()) continue;
      try {
        parsePageRange(i.range, i.pageCount);
      } catch (err) {
        m.set(i.id, err instanceof Error ? err.message : 'Invalid range');
      }
    }
    return m;
  }, [items]);

  const build = async () => {
    if (!ready || rangeErrors.size > 0) return;
    setBusy({ done: 0, total: items.length, label: 'Loading PDF engine' });
    const t0 = performance.now();
    try {
      const bytes = await buildPdf(items, options, (p) => setBusy(p));
      const name = outputFileName(items, options.title);
      const url = downloadBytes(bytes, name);
      setResult({ url, bytes: bytes.length, pages: totalPages(items), name });
      toast(`Saved ${name} (${formatBytes(bytes.length)})`);
      track('tool_action', { tool: TOOL, action: 'build', files: items.length, pages: totalPages(items), bytes: bytes.length, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      toast(err instanceof PdfError ? err.message : 'Could not create the PDF.', 'error', 5000);
    } finally {
      setBusy(null);
    }
  };

  // Paste files, keyboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void build();
      } else if (e.key === 'Escape' && full) setFull(false);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

  // Full screen
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

  const hasImages = items.some((i) => i.kind === 'image');
  const pages = totalPages(items);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      class={
        'flex flex-col bg-surface-2 text-ink outline-none ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(82vh,900px)] min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragId) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (dragId) return;
        if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,application/pdf,.pdf"
        class="hidden"
        onChange={(e) => {
          const files = (e.currentTarget as HTMLInputElement).files;
          if (files?.length) void addFiles(files);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2 pt-1">
        <button type="button" class="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
          <Icon name="file-plus" size={14} /> Add files
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => void loadSample()} disabled={!!busy} title="Add two images and a two-page PDF">
          <Icon name="sparkles" size={14} /> Sample
        </button>
        <span class="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <button type="button" class="btn-ghost btn-sm" onClick={sortByName} disabled={items.length < 2} title="Sort by file name">
          <Icon name="arrow-down-az" size={14} /> Sort
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={reverse} disabled={items.length < 2} title="Reverse the order">
          <Icon name="arrow-left-right" size={14} /> Reverse
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={clear} disabled={items.length === 0} title="Remove every file">
          <Icon name="eraser" size={14} /> Clear
        </button>
        <span class="flex-1" />
        <button type="button" class="btn-primary btn-sm" disabled={!ready || rangeErrors.size > 0 || !!busy} onClick={() => void build()} title="Create and download the PDF (Ctrl+Enter)">
          <Icon name="download" size={14} /> Create PDF{pages > 0 ? ` (${pages} page${pages === 1 ? '' : 's'})` : ''}
        </button>
        <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[minmax(0,1fr)_18rem]">
        {/* File list */}
        <section
          class={
            'relative flex min-h-[280px] min-w-0 flex-col overflow-hidden rounded-lg border bg-surface transition-colors ' +
            (dragOver ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-line-strong')
          }
          aria-label="Files to combine"
        >
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 text-xs">
            <span class="font-semibold text-ink">Pages in order</span>
            <span class="text-ink-3">{describeBatch(items)}</span>
          </header>

          {items.length === 0 ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Icon name="layers" size={26} />
              </span>
              <p class="text-sm font-medium">Drop images and PDFs here, paste them, or</p>
              <div class="flex gap-2">
                <button type="button" class="btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="file-plus" size={14} /> Add files
                </button>
                <button type="button" class="btn-secondary btn-sm" onClick={() => void loadSample()}>
                  Try a sample
                </button>
              </div>
              <p class="max-w-sm text-xs leading-5 text-ink-3">Images become one page each; PDFs contribute their pages. Everything is combined in list order into a single PDF, entirely in your browser.</p>
            </div>
          ) : (
            <ol class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-2" aria-label="File order">
              {items.map((item, index) => (
                <li
                  key={item.id}
                  draggable
                  onDragStart={(e) => {
                    setDragId(item.id);
                    e.dataTransfer?.setData('text/plain', item.id);
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => {
                    if (!dragId) return;
                    e.preventDefault();
                    e.stopPropagation();
                    const from = items.findIndex((i) => i.id === dragId);
                    if (from !== -1 && from !== index) move(from, index);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragId(null);
                  }}
                  class={
                    'mb-1.5 flex items-center gap-2.5 rounded-md border p-2 text-sm transition-colors ' +
                    (dragId === item.id ? 'border-brand-400 bg-brand-50/60 opacity-70 dark:bg-brand-900/30' : item.error ? 'border-danger/40 bg-danger/5' : 'border-line bg-surface hover:border-line-strong')
                  }
                >
                  <span class="cursor-grab text-ink-3" title="Drag to reorder" aria-hidden="true">
                    <Icon name="grip-vertical" size={16} />
                  </span>
                  <span class="w-5 shrink-0 text-right font-mono text-xs text-ink-3">{index + 1}</span>
                  <span class="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded border border-line bg-surface-3">
                    {item.kind === 'image' && item.thumb ? (
                      <img src={item.thumb} alt="" class="h-full w-full object-cover" style={{ transform: `rotate(${item.rotation * 90}deg)` }} />
                    ) : item.loading ? (
                      <Icon name="loader" size={16} class="animate-spin text-ink-3" />
                    ) : (
                      <Icon name={item.kind === 'pdf' ? 'file-text' : 'file-image'} size={20} class="text-ink-3" />
                    )}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-medium" title={item.name}>
                      {item.name}
                    </span>
                    <span class="block truncate text-xs text-ink-3">
                      {item.error ? (
                        <span class="text-danger">{item.error}</span>
                      ) : item.loading ? (
                        'Reading…'
                      ) : item.kind === 'image' ? (
                        `${item.dims ? `${item.dims.width} × ${item.dims.height}` : ''} · ${formatBytes(item.size)} · 1 page`
                      ) : (
                        `${item.pageCount} page${item.pageCount === 1 ? '' : 's'} · ${formatBytes(item.size)}${item.encrypted ? ' · encrypted' : ''}${item.range.trim() && !rangeErrors.has(item.id) ? ` · using ${pagesFor(item)}` : ''}`
                      )}
                    </span>
                    {item.kind === 'pdf' && !item.error && !item.loading && (
                      <span class="mt-1 flex items-center gap-1.5">
                        <input
                          class={'input h-6 w-32 font-mono text-[11px] ' + (rangeErrors.has(item.id) ? 'border-danger' : '')}
                          placeholder={`all (1-${item.pageCount})`}
                          value={item.range}
                          onInput={(e) => patchItem(item.id, { range: (e.currentTarget as HTMLInputElement).value })}
                          aria-label={`Pages to include from ${item.name}`}
                          title="Pages to include, e.g. 1-3, 7, 10-"
                        />
                        {rangeErrors.has(item.id) && <span class="truncate text-[11px] text-danger">{rangeErrors.get(item.id)}</span>}
                      </span>
                    )}
                  </span>
                  <span class="flex shrink-0 items-center">
                    {item.kind === 'image' && !item.error && (
                      <HeaderButton icon="rotate-cw" title="Rotate this image" onClick={() => patchItem(item.id, (i) => ({ rotation: ((i.rotation + 1) % 4) as Item['rotation'] }))} active={item.rotation !== 0} />
                    )}
                    <HeaderButton icon="arrow-up" title="Move up" onClick={() => move(index, index - 1)} disabled={index === 0} />
                    <HeaderButton icon="arrow-down" title="Move down" onClick={() => move(index, index + 1)} disabled={index === items.length - 1} />
                    <HeaderButton icon="x" title={`Remove ${item.name}`} onClick={() => remove(item.id)} />
                  </span>
                </li>
              ))}
              <li class="mt-1 flex justify-center">
                <button type="button" class="btn-ghost btn-sm text-ink-3" onClick={() => fileRef.current?.click()}>
                  <Icon name="plus" size={14} /> Add more files
                </button>
              </li>
            </ol>
          )}

          {busy && (
            <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/80 text-sm text-ink-2">
              <Icon name="loader" size={18} class="animate-spin" />
              <span>
                {busy.label}
                {busy.total > 1 ? ` (${busy.done}/${busy.total})` : ''}
              </span>
              {busy.total > 1 && (
                <span class="h-1.5 w-48 overflow-hidden rounded-full bg-line">
                  <span class="block h-full bg-brand-600 transition-[width]" style={{ width: `${Math.round((busy.done / busy.total) * 100)}%` }} />
                </span>
              )}
            </div>
          )}
        </section>

        {/* Options */}
        <aside class="scrollbar-thin flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3 text-sm" aria-label="PDF options">
          <Group title="Image pages" hint={hasImages ? undefined : 'Add an image to use these'}>
            <Field label="Page size">
              <select class="select h-8 text-[13px]" value={options.pageSize} onChange={(e) => update({ pageSize: (e.currentTarget as HTMLSelectElement).value as PageSizeId })} aria-label="Page size">
                <option value="fit">Fit to image</option>
                {(Object.keys(PAGE_SIZES) as Exclude<PageSizeId, 'fit'>[]).map((k) => (
                  <option key={k} value={k}>
                    {PAGE_SIZES[k].label}
                  </option>
                ))}
              </select>
            </Field>
            {options.pageSize !== 'fit' && (
              <>
                <Field label="Orientation">
                  <Segmented
                    value={options.orientation}
                    onChange={(orientation) => update({ orientation })}
                    options={[
                      { value: 'auto', label: 'Auto' },
                      { value: 'portrait', label: 'Portrait' },
                      { value: 'landscape', label: 'Landscape' },
                    ]}
                    label="Orientation"
                  />
                </Field>
                <Field label="Image placement">
                  <Segmented
                    value={options.fit}
                    onChange={(fit) => update({ fit })}
                    options={[
                      { value: 'contain', label: 'Fit inside' },
                      { value: 'cover', label: 'Fill page' },
                    ]}
                    label="Image placement"
                  />
                </Field>
              </>
            )}
            <Field label="Margins">
              <select class="select h-8 text-[13px]" value={options.margin} onChange={(e) => update({ margin: (e.currentTarget as HTMLSelectElement).value as MarginId })} aria-label="Margins">
                {(Object.keys(MARGINS) as MarginId[]).map((k) => (
                  <option key={k} value={k}>
                    {MARGINS[k].label}
                  </option>
                ))}
              </select>
            </Field>
            <Chip on={options.keepOriginal} onClick={() => update({ keepOriginal: !options.keepOriginal })} title="Embed JPEG and PNG files byte for byte instead of re-encoding them">
              Keep original JPG/PNG data
            </Chip>
            <label class="block">
              <span class="flex items-center justify-between text-xs text-ink-2">
                <span>JPEG quality for converted images</span>
                <span class="font-mono tabular-nums">{options.quality}</span>
              </span>
              <input type="range" class="mt-1 w-full accent-brand-600" min={1} max={100} value={options.quality} onInput={(e) => update({ quality: Number((e.currentTarget as HTMLInputElement).value) })} aria-label="JPEG quality" />
            </label>
          </Group>

          <Group title="Document">
            <Field label="Title (also the file name)">
              <input class="input h-8 text-xs" value={options.title} placeholder={outputFileName(items, '').replace(/\.pdf$/, '')} onInput={(e) => update({ title: (e.currentTarget as HTMLInputElement).value })} aria-label="Document title" />
            </Field>
            <Field label="Author">
              <input class="input h-8 text-xs" value={options.author} onInput={(e) => update({ author: (e.currentTarget as HTMLInputElement).value })} aria-label="Author" />
            </Field>
          </Group>

          {result && (
            <div class="rounded-md border border-success/40 bg-success/10 p-2.5 text-xs text-ink-2">
              <div class="flex items-center gap-1.5 font-medium text-ink">
                <Icon name="check-circle" size={14} class="text-success" /> {result.name}
              </div>
              <div class="mt-1">
                {result.pages} page{result.pages === 1 ? '' : 's'} · {formatBytes(result.bytes)}
              </div>
              <div class="mt-2 flex gap-2">
                <a class="btn-secondary btn-sm flex-1" href={result.url} download={result.name}>
                  <Icon name="download" size={13} /> Save again
                </a>
                <a class="btn-secondary btn-sm" href={result.url} target="_blank" rel="noopener" title="Open in a new tab">
                  <Icon name="external-link" size={13} />
                </a>
              </div>
            </div>
          )}
        </aside>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Files are read and combined in this browser tab. Nothing is uploaded, and there is no watermark.</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> create PDF
        </span>
      </div>
    </div>
  );
}

function Group(p: { title: string; hint?: string; children: ComponentChildren }) {
  return (
    <section class={p.hint ? 'opacity-60' : ''}>
      <h3 class="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-ink-3">
        {p.title}
        {p.hint && <span class="font-normal normal-case tracking-normal">{p.hint}</span>}
      </h3>
      <div class="space-y-3">{p.children}</div>
    </section>
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
