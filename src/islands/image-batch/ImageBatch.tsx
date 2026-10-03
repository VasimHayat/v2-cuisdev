/**
 * Batch image workspace shared by the Image Compressor, Image Converter and Image Resizer
 * pages. Every file runs through one pipeline (decode, optional resize, encode); the
 * `kind` prop only decides which settings section is enabled and open first. Results
 * are recomputed automatically when settings change and can be downloaded one by one
 * or as a zip.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { toast, track } from '../shared/toast';
import { buildZip, downloadBlob } from '../shared/zip';
import { makeSample } from '../image-editor/canvas';
import { ImageError, SIZE_PRESETS, assertUsableFile, formatBytes, type Dimensions } from '../image-editor/logic';
import { canWrite, processFile } from './process';
import {
  FORMAT_LABELS,
  MAX_FILES,
  MAX_FILE_BYTES,
  describeTotals,
  outputName,
  sanitizeSettings,
  savingsPercent,
  settingsKey,
  totals,
  type Fit,
  type Kind,
  type Mime,
  type ResizeMode,
  type Settings,
} from './logic';

interface Props {
  kind?: Kind;
}

type Status = 'queued' | 'processing' | 'done' | 'error';

interface Result {
  blob: Blob;
  url: string;
  type: Mime;
  width: number;
  height: number;
  quality: number | null;
  targetMet: boolean | null;
}

interface Item {
  id: string;
  file: File;
  name: string;
  size: number;
  url: string;
  status: Status;
  key?: string;
  error?: string;
  source?: Dimensions;
  result?: Result;
}

const PREFS_KEY = 'cuis-imgbatch:prefs';
const TOOL: Record<Kind, string> = { compress: 'image-compressor', convert: 'image-converter', resize: 'image-resizer' };
const SECTION_ORDER: Record<Kind, Kind[]> = { compress: ['compress', 'convert', 'resize'], convert: ['convert', 'compress', 'resize'], resize: ['resize', 'compress', 'convert'] };

function loadSettings(kind: Kind): Settings {
  try {
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Record<string, unknown> | null;
    return sanitizeSettings(all?.[kind], kind);
  } catch {
    return sanitizeSettings(null, kind);
  }
}

let counter = 0;
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`;

export default function ImageBatch({ kind = 'compress' }: Props) {
  const tool = TOOL[kind];
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings(kind));
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<Kind, boolean>>({ compress: kind === 'compress', convert: kind === 'convert', resize: kind === 'resize' });
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [compareMode, setCompareMode] = useState<'slider' | 'side'>('slider');
  const [split, setSplit] = useState(50);
  const [zipping, setZipping] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [full, setFull] = useState(false);
  const runId = useRef(0);

  const key = useMemo(() => settingsKey(settings), [settings]);
  const update = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  // Persist settings per page kind
  useEffect(() => {
    try {
      const all = (JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Record<string, unknown> | null) ?? {};
      all[kind] = settings;
      localStorage.setItem(PREFS_KEY, JSON.stringify(all));
    } catch {}
  }, [settings, kind]);

  // Revoke every object URL on unmount
  useEffect(
    () => () => {
      for (const i of itemsRef.current) {
        URL.revokeObjectURL(i.url);
        if (i.result) URL.revokeObjectURL(i.result.url);
      }
    },
    [],
  );

  const patch = (id: string, p: Partial<Item>) =>
    setItems((list) =>
      list.map((i) => {
        if (i.id !== id) return i;
        if (p.result && i.result && p.result.url !== i.result.url) URL.revokeObjectURL(i.result.url);
        return { ...i, ...p };
      }),
    );

  // ------------------------------------------------------------------ processing

  const run = useCallback(async () => {
    const id = ++runId.current;
    const k = key;
    const s = settings;
    const todo = itemsRef.current.filter((i) => i.key !== k);
    if (todo.length === 0) {
      setProgress(null);
      return;
    }
    let done = 0;
    setProgress({ done, total: todo.length });
    for (const item of todo) {
      if (id !== runId.current) return;
      if (!itemsRef.current.some((i) => i.id === item.id)) continue;
      patch(item.id, { status: 'processing' });
      try {
        const r = await processFile(item.file, s);
        if (id !== runId.current) {
          patch(item.id, { status: item.result ? 'done' : 'queued' });
          return;
        }
        patch(item.id, {
          status: 'done',
          key: k,
          error: undefined,
          source: r.source,
          result: { blob: r.blob, url: URL.createObjectURL(r.blob), type: r.type, width: r.width, height: r.height, quality: r.quality, targetMet: r.targetMet },
        });
      } catch (err) {
        patch(item.id, { status: 'error', key: k, error: err instanceof Error ? err.message : 'Could not process this image.' });
      }
      done++;
      if (id === runId.current) setProgress({ done, total: todo.length });
    }
    if (id === runId.current) setProgress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const pending = items.filter((i) => i.key !== key).length;
  useEffect(() => {
    if (pending === 0) return;
    const t = setTimeout(() => void run(), 350);
    return () => clearTimeout(t);
  }, [run, pending, items.length]);

  // ------------------------------------------------------------------ files

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      const room = MAX_FILES - itemsRef.current.length;
      if (room <= 0) {
        toast(`At most ${MAX_FILES} images at once`, 'error');
        return;
      }
      const accepted: Item[] = [];
      let skipped = 0;
      for (const file of list.slice(0, room)) {
        try {
          assertUsableFile(file);
          if (file.size > MAX_FILE_BYTES) throw new ImageError(`${file.name} is larger than ${formatBytes(MAX_FILE_BYTES)}`);
          accepted.push({ id: newId(), file, name: file.name, size: file.size, url: URL.createObjectURL(file), status: 'queued' });
        } catch (err) {
          skipped++;
          if (skipped === 1) toast(err instanceof Error ? err.message : 'Skipped a file', 'error', 3500);
        }
      }
      if (list.length > room) toast(`Only the first ${room} images were added (limit ${MAX_FILES})`, 'error');
      if (accepted.length === 0) return;
      setItems((cur) => [...cur, ...accepted]);
      setSelected((s) => s ?? accepted[0]!.id);
      track('tool_action', { tool, action: 'add', count: accepted.length });
    },
    [tool],
  );

  const remove = (id: string) => {
    setItems((list) => {
      const it = list.find((i) => i.id === id);
      if (it) {
        URL.revokeObjectURL(it.url);
        if (it.result) URL.revokeObjectURL(it.result.url);
      }
      const next = list.filter((i) => i.id !== id);
      setSelected((s) => (s === id ? (next[0]?.id ?? null) : s));
      return next;
    });
  };

  const clear = () => {
    runId.current++;
    for (const i of itemsRef.current) {
      URL.revokeObjectURL(i.url);
      if (i.result) URL.revokeObjectURL(i.result.url);
    }
    setItems([]);
    setSelected(null);
    setProgress(null);
  };

  const loadSample = async () => {
    try {
      addFiles([await makeSample()]);
      track('tool_action', { tool, action: 'sample' });
    } catch {
      toast('Could not create the sample image', 'error');
    }
  };

  const fileName = (i: Item) => outputName(i.name, i.result!.type, settings.resize ? { width: i.result!.width, height: i.result!.height } : null);

  const downloadOne = (i: Item) => {
    if (!i.result) return;
    downloadBlob(i.result.blob, fileName(i));
    track('tool_action', { tool, action: 'download_one' });
  };

  const downloadAll = async () => {
    const done = itemsRef.current.filter((i) => i.result && i.key === key);
    if (done.length === 0) return;
    if (done.length === 1) {
      downloadOne(done[0]!);
      return;
    }
    setZipping(true);
    try {
      const zip = await buildZip(done.map((i) => ({ name: fileName(i), data: i.result!.blob })));
      downloadBlob(zip, `${tool}-${done.length}-images.zip`);
      toast(`Saved ${done.length} images (${formatBytes(zip.size)})`);
      track('tool_action', { tool, action: 'download_zip', count: done.length });
    } catch {
      toast('Could not build the zip file', 'error');
    } finally {
      setZipping(false);
    }
  };

  // Paste images anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        addFiles(files);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [addFiles]);

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && full) setFull(false);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void downloadAll();
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

  // ------------------------------------------------------------------ render

  const sel = items.find((i) => i.id === selected) ?? null;
  const t = totals(items.map((i) => ({ size: i.size, resultSize: i.result && i.key === key ? i.result.blob.size : undefined })));
  const readyCount = items.filter((i) => i.result && i.key === key).length;
  const pngKeep = settings.compress && settings.compressFormat === 'keep' && !settings.convert && items.some((i) => i.file.type === 'image/png');

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
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*"
        class="hidden"
        onChange={(e) => {
          const files = (e.currentTarget as HTMLInputElement).files;
          if (files?.length) addFiles(files);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2 pt-1">
        <button type="button" class="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
          <Icon name="file-plus" size={14} /> Add images
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => void loadSample()} title="Add a sample photo">
          <Icon name="sparkles" size={14} /> Sample
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={clear} disabled={items.length === 0} title="Remove every image">
          <Icon name="eraser" size={14} /> Clear
        </button>
        <span class="flex-1" />
        <button type="button" class="btn-primary btn-sm" onClick={() => void downloadAll()} disabled={readyCount === 0 || zipping} title="Download every result (Ctrl+S)">
          <Icon name={zipping ? 'loader' : 'download'} size={14} class={zipping ? 'animate-spin' : ''} />
          {readyCount > 1 ? `Download all (${readyCount}) as zip` : 'Download'}
        </button>
        <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-visible">
        {/* Left: compare + list */}
        <div class="flex min-h-0 min-w-0 flex-col gap-2">
          {items.length === 0 ? (
            <section
              class={
                'flex h-[420px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center lg:h-auto lg:flex-1 ' +
                (dragOver ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-900/20' : 'border-line-strong bg-surface')
              }
              aria-label="Add images"
            >
              <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Icon name="image" size={26} />
              </span>
              <p class="text-sm font-medium">Drop images here, paste them, or</p>
              <div class="flex gap-2">
                <button type="button" class="btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="file-plus" size={14} /> Add images
                </button>
                <button type="button" class="btn-secondary btn-sm" onClick={() => void loadSample()}>
                  Try a sample
                </button>
              </div>
              <p class="max-w-sm text-xs leading-5 text-ink-3">
                PNG, JPG, WebP, GIF, BMP or AVIF. Up to {MAX_FILES} images of {formatBytes(MAX_FILE_BYTES)} each, processed in your browser. Nothing is uploaded.
              </p>
            </section>
          ) : (
            <>
              <Compare item={sel} mode={compareMode} onMode={setCompareMode} split={split} onSplit={setSplit} />
              <section class="flex h-[300px] min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:flex-[2]" aria-label="Images">
                <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 text-xs">
                  <span class="font-semibold text-ink">Images</span>
                  <span class="text-ink-3">{items.length}</span>
                  {progress && (
                    <span class="ml-2 flex flex-1 items-center gap-2 text-ink-3">
                      <span class="h-1.5 w-32 overflow-hidden rounded-full bg-line">
                        <span class="block h-full bg-brand-600 transition-[width]" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                      </span>
                      {progress.done}/{progress.total}
                    </span>
                  )}
                </header>
                <ul class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
                  {items.map((i) => (
                    <Row key={i.id} item={i} current={i.key === key} active={i.id === selected} onSelect={() => setSelected(i.id)} onDownload={() => downloadOne(i)} onRemove={() => remove(i.id)} />
                  ))}
                </ul>
              </section>
            </>
          )}
        </div>

        {/* Right: settings */}
        <aside class="scrollbar-thin flex min-h-0 flex-col gap-2 overflow-y-auto rounded-lg border border-line-strong bg-surface p-2 text-sm lg:h-auto" aria-label="Settings">
          {SECTION_ORDER[kind].map((section) => (
            <Section
              key={section}
              title={section === 'compress' ? 'Compress' : section === 'convert' ? 'Convert format' : 'Resize'}
              enabled={settings[section]}
              onEnable={() => update({ [section]: !settings[section] } as Partial<Settings>)}
              open={open[section]}
              onOpen={() => setOpen((o) => ({ ...o, [section]: !o[section] }))}
            >
              {section === 'compress' && <CompressPanel s={settings} update={update} pngKeep={pngKeep} />}
              {section === 'convert' && <ConvertPanel s={settings} update={update} />}
              {section === 'resize' && <ResizePanel s={settings} update={update} />}
            </Section>
          ))}
          <p class="px-1 pt-1 text-xs leading-5 text-ink-3">Metadata such as EXIF and GPS location is removed from every output. Photos are rotated upright first.</p>
        </aside>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">{describeTotals(t)}</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">V</span> paste images
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function Row(p: { item: Item; current: boolean; active: boolean; onSelect: () => void; onDownload: () => void; onRemove: () => void }) {
  const { item } = p;
  const r = item.result;
  const saving = r ? savingsPercent(item.size, r.blob.size) : null;
  return (
    <li
      class={'mb-1 flex cursor-pointer items-center gap-2.5 rounded-md border p-1.5 text-sm transition-colors ' + (p.active ? 'border-brand-400 bg-brand-50/50 dark:border-brand-700 dark:bg-brand-900/20' : 'border-transparent hover:bg-surface-3')}
      onClick={p.onSelect}
    >
      <img src={item.url} alt="" class="h-10 w-10 shrink-0 rounded border border-line bg-surface-3 object-cover" loading="lazy" />
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium" title={item.name}>
          {item.name}
        </span>
        <span class="block truncate text-xs text-ink-3">
          {item.status === 'error' ? (
            <span class="text-danger">{item.error}</span>
          ) : (
            <>
              {item.source ? `${item.source.width} × ${item.source.height} · ` : ''}
              {formatBytes(item.size)}
              {r && (
                <>
                  {' → '}
                  {r.width !== item.source?.width || r.height !== item.source?.height ? `${r.width} × ${r.height} · ` : ''}
                  {FORMAT_LABELS[r.type]} {formatBytes(r.blob.size)}
                  {r.targetMet === false && <span class="text-warning"> (target not reached)</span>}
                </>
              )}
            </>
          )}
        </span>
      </span>
      {saving !== null && item.status === 'done' && (
        <span class={'badge shrink-0 ' + (saving >= 0 ? 'border-success/40 bg-success/10 text-success' : 'border-warning/50 bg-warning/10 text-ink-2')}>{saving >= 0 ? `−${saving}%` : `+${Math.abs(saving)}%`}</span>
      )}
      <span class="flex w-5 shrink-0 justify-center">
        {item.status === 'processing' || (item.status === 'done' && !p.current) || item.status === 'queued' ? (
          <Icon name="loader" size={14} class="animate-spin text-ink-3" />
        ) : item.status === 'done' ? (
          <Icon name="check" size={14} class="text-success" />
        ) : (
          <Icon name="alert-circle" size={14} class="text-danger" />
        )}
      </span>
      <span class="flex shrink-0" onClick={(e) => e.stopPropagation()}>
        <HeaderButton icon="download" title={`Download ${item.name}`} onClick={p.onDownload} disabled={!r} />
        <HeaderButton icon="x" title={`Remove ${item.name}`} onClick={p.onRemove} />
      </span>
    </li>
  );
}

function Compare(p: { item: Item | null; mode: 'slider' | 'side'; onMode: (m: 'slider' | 'side') => void; split: number; onSplit: (n: number) => void }) {
  const { item } = p;
  const r = item?.result;
  return (
    <section class="flex h-[300px] min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:flex-[3]" aria-label="Compare">
      <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
        <span class="font-semibold text-ink">Compare</span>
        <span class="min-w-0 flex-1 truncate text-ink-3">{item?.name ?? ''}</span>
        <Segmented
          value={p.mode}
          onChange={p.onMode}
          options={[
            { value: 'slider', label: 'Slider', icon: 'columns' },
            { value: 'side', label: 'Side by side', icon: 'panel-right' },
          ]}
          label="Compare view"
        />
      </header>
      <div class="relative min-h-0 flex-1 bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] [background-size:14px_14px]">
        {!item ? (
          <p class="flex h-full items-center justify-center text-sm text-ink-3">Select an image to compare.</p>
        ) : p.mode === 'side' ? (
          <div class="grid h-full grid-cols-2 gap-1 p-2">
            <Figure url={item.url} label="Before" detail={`${item.source ? `${item.source.width} × ${item.source.height} · ` : ''}${formatBytes(item.size)}`} />
            {r ? <Figure url={r.url} label="After" detail={`${r.width} × ${r.height} · ${FORMAT_LABELS[r.type]} ${formatBytes(r.blob.size)}${r.quality !== null ? ` · q${r.quality}` : ''}`} /> : <Pending item={item} />}
          </div>
        ) : (
          <div class="relative h-full w-full select-none">
            {r ? (
              <>
                <img src={r.url} alt="After" class="absolute inset-0 h-full w-full object-contain p-2" draggable={false} />
                <img src={item.url} alt="Before" class="absolute inset-0 h-full w-full object-contain p-2" style={{ clipPath: `inset(0 ${100 - p.split}% 0 0)` }} draggable={false} />
                <span class="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${p.split}%` }} />
                <span class="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">
                  Before · {formatBytes(item.size)}
                </span>
                <span class="absolute right-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[11px] text-white">
                  After · {formatBytes(r.blob.size)}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={p.split}
                  onInput={(e) => p.onSplit(Number((e.currentTarget as HTMLInputElement).value))}
                  class="absolute inset-x-4 bottom-2 accent-brand-600"
                  aria-label="Compare position"
                />
              </>
            ) : (
              <Pending item={item} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Figure(p: { url: string; label: string; detail: string }) {
  return (
    <figure class="relative flex min-h-0 min-w-0 flex-col">
      <img src={p.url} alt={p.label} class="min-h-0 flex-1 object-contain" />
      <figcaption class="mt-1 truncate text-center text-[11px] text-ink-2">
        <span class="font-medium">{p.label}</span> · {p.detail}
      </figcaption>
    </figure>
  );
}

function Pending({ item }: { item: Item }) {
  return (
    <div class="flex h-full flex-col items-center justify-center gap-2 text-sm text-ink-3">
      {item.status === 'error' ? (
        <>
          <Icon name="alert-circle" size={20} class="text-danger" />
          <span class="max-w-sm text-center text-danger">{item.error}</span>
        </>
      ) : (
        <>
          <Icon name="loader" size={18} class="animate-spin" /> Processing
        </>
      )}
    </div>
  );
}

function Section(p: { title: string; enabled: boolean; onEnable: () => void; open: boolean; onOpen: () => void; children: ComponentChildren }) {
  return (
    <section class={'rounded-md border ' + (p.enabled ? 'border-line-strong' : 'border-line')}>
      <div class="flex items-center gap-2 px-2 py-1.5">
        <button type="button" class="flex flex-1 items-center gap-1.5 text-left text-sm font-semibold" onClick={p.onOpen} aria-expanded={p.open}>
          <Icon name={p.open ? 'chevron-down' : 'chevron-right'} size={14} class="text-ink-3" />
          <span class={p.enabled ? 'text-ink' : 'text-ink-3'}>{p.title}</span>
        </button>
        <Chip on={p.enabled} onClick={p.onEnable} title={p.enabled ? `Turn ${p.title.toLowerCase()} off` : `Apply ${p.title.toLowerCase()} too`}>
          {p.enabled ? 'On' : 'Off'}
        </Chip>
      </div>
      {p.open && <div class={'space-y-3 border-t border-line px-2.5 pb-3 pt-2.5 ' + (p.enabled ? '' : 'opacity-60')}>{p.children}</div>}
    </section>
  );
}

function Field(p: { label: string; children: ComponentChildren; hint?: string }) {
  return (
    <div>
      <div class="mb-1 flex items-center justify-between text-xs text-ink-2">
        <span>{p.label}</span>
        {p.hint && <span class="font-mono tabular-nums text-ink-3">{p.hint}</span>}
      </div>
      {p.children}
    </div>
  );
}

type PanelProps = { s: Settings; update: (p: Partial<Settings>) => void };

function CompressPanel({ s, update, pngKeep }: PanelProps & { pngKeep: boolean }) {
  return (
    <>
      <Segmented
        value={s.sizeMode}
        onChange={(sizeMode) => update({ sizeMode, compress: true })}
        options={[
          { value: 'quality', label: 'Quality' },
          { value: 'target', label: 'Target size' },
        ]}
        label="Compression mode"
      />
      {s.sizeMode === 'quality' ? (
        <Field label="Quality" hint={String(s.quality)}>
          <input type="range" min={1} max={100} value={s.quality} class="w-full accent-brand-600" onInput={(e) => update({ quality: Number((e.currentTarget as HTMLInputElement).value) })} aria-label="Quality" />
        </Field>
      ) : (
        <Field label="Largest file size">
          <div class="flex items-center gap-2">
            <input type="number" min={1} class="input h-8 font-mono text-xs" value={s.targetKB} onChange={(e) => update({ targetKB: Math.max(1, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 1)) })} aria-label="Target size in KB" />
            <span class="text-xs text-ink-3">KB</span>
          </div>
          <p class="mt-1 text-xs text-ink-3">The highest quality that fits is found for each JPG or WebP output.</p>
        </Field>
      )}
      <Field label="Output format">
        <Segmented
          value={s.compressFormat}
          onChange={(compressFormat) => update({ compressFormat })}
          options={[
            { value: 'keep', label: 'Keep' },
            { value: 'image/jpeg', label: 'JPG' },
            { value: 'image/webp', label: 'WebP' },
          ]}
          label="Compressed format"
        />
      </Field>
      {pngKeep && <p class="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-ink-2">PNG is lossless, so quality has no effect on PNG files. Choose JPG or WebP to shrink them a lot.</p>}
    </>
  );
}

function ConvertPanel({ s, update }: PanelProps) {
  const formats: Mime[] = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];
  return (
    <>
      <Field label="Convert to">
        <Segmented
          value={s.convertTo}
          onChange={(convertTo) => update({ convertTo, convert: true })}
          options={formats.map((m) => ({ value: m, label: FORMAT_LABELS[m], disabled: !canWrite(m), title: canWrite(m) ? undefined : `This browser cannot write ${FORMAT_LABELS[m]}` }))}
          label="Target format"
        />
      </Field>
      {s.convertTo !== 'image/png' && (
        <Field label="Quality" hint={String(s.convertQuality)}>
          <input type="range" min={1} max={100} value={s.convertQuality} class="w-full accent-brand-600" onInput={(e) => update({ convertQuality: Number((e.currentTarget as HTMLInputElement).value) })} aria-label="Conversion quality" />
        </Field>
      )}
      {s.convertTo === 'image/jpeg' && (
        <Field label="Background for transparent areas">
          <div class="flex items-center gap-2">
            <input type="color" class="h-8 w-10 cursor-pointer rounded border border-line-strong bg-surface p-0.5" value={s.background} onInput={(e) => update({ background: (e.currentTarget as HTMLInputElement).value })} aria-label="Background colour" />
            <span class="font-mono text-xs text-ink-2">{s.background}</span>
          </div>
        </Field>
      )}
    </>
  );
}

function ResizePanel({ s, update }: PanelProps) {
  const num = (v: string, fb: number) => Math.max(1, Math.round(Number(v) || fb));
  return (
    <>
      <Field label="Resize by">
        <select class="select h-8 text-[13px]" value={s.resizeMode} onChange={(e) => update({ resizeMode: (e.currentTarget as HTMLSelectElement).value as ResizeMode, resize: true })} aria-label="Resize mode">
          <option value="width">Width (keep proportions)</option>
          <option value="height">Height (keep proportions)</option>
          <option value="both">Width and height</option>
          <option value="longest">Longest edge</option>
          <option value="percent">Percentage</option>
          <option value="preset">Preset size</option>
        </select>
      </Field>
      {(s.resizeMode === 'width' || s.resizeMode === 'both') && (
        <Field label="Width (px)">
          <input type="number" min={1} class="input h-8 font-mono text-xs" value={s.width} onChange={(e) => update({ width: num((e.currentTarget as HTMLInputElement).value, s.width) })} aria-label="Width" />
        </Field>
      )}
      {(s.resizeMode === 'height' || s.resizeMode === 'both') && (
        <Field label="Height (px)">
          <input type="number" min={1} class="input h-8 font-mono text-xs" value={s.height} onChange={(e) => update({ height: num((e.currentTarget as HTMLInputElement).value, s.height) })} aria-label="Height" />
        </Field>
      )}
      {s.resizeMode === 'longest' && (
        <Field label="Longest edge (px)">
          <input type="number" min={1} class="input h-8 font-mono text-xs" value={s.longest} onChange={(e) => update({ longest: num((e.currentTarget as HTMLInputElement).value, s.longest) })} aria-label="Longest edge" />
        </Field>
      )}
      {s.resizeMode === 'percent' && (
        <Field label="Scale" hint={`${s.percent}%`}>
          <input type="range" min={5} max={200} step={5} value={s.percent} class="w-full accent-brand-600" onInput={(e) => update({ percent: Number((e.currentTarget as HTMLInputElement).value) })} aria-label="Scale percent" />
        </Field>
      )}
      {s.resizeMode === 'preset' && (
        <Field label="Preset">
          <select class="select h-8 text-[13px]" value={s.preset} onChange={(e) => update({ preset: (e.currentTarget as HTMLSelectElement).value })} aria-label="Size preset">
            {SIZE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      )}
      {(s.resizeMode === 'both' || s.resizeMode === 'preset') && (
        <Field label="Fit">
          <Segmented
            value={s.fit}
            onChange={(fit: Fit) => update({ fit })}
            options={[
              { value: 'contain', label: 'Fit inside', title: 'Keep proportions inside the box' },
              { value: 'cover', label: 'Fill and crop', title: 'Fill the box exactly, cropping the edges' },
              { value: 'stretch', label: 'Stretch', title: 'Use the exact size, distorting if needed' },
            ]}
            label="Fit"
          />
        </Field>
      )}
      <Chip on={s.noUpscale} onClick={() => update({ noUpscale: !s.noUpscale })} title="Never make an image larger than its original">
        Never enlarge
      </Chip>
    </>
  );
}
