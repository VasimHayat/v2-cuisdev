/**
 * Favicon Generator: one source (an uploaded image, an SVG, or generated letters or an
 * emoji) becomes every favicon file a site needs, previewed on light and dark tiles, in
 * a browser tab and on a phone home screen, and downloaded as one zip with the HTML.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { html } from '@codemirror/lang-html';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, formatBytes, toast, track } from '../shared/toast';
import { buildZip, downloadBlob } from '../shared/zip';
import { decodeFile, makeSample, releaseSource, type Source } from '../image-editor/canvas';
import {
  DEFAULT_OPTIONS,
  FONTS,
  ICO_SIZES,
  PNG_OUTPUTS,
  buildHtml,
  buildIco,
  buildManifest,
  containIn,
  fileList,
  fontCss,
  fontSizeFor,
  graphemeCount,
  layout,
  normalizeHex,
  sanitizePrefs,
  type FaviconOptions,
} from './logic';

const TOOL = 'favicon-generator';
const PREFS_KEY = 'cuis-favicon:prefs';
const MASTER = 512;
const MAX_FILE = 20 * 1024 * 1024;

interface LoadedImage {
  source: Source;
  width: number;
  height: number;
  name: string;
  /** Original SVG markup when the upload was an SVG. */
  svg: string | null;
}

function loadPrefs(): FaviconOptions {
  try {
    return sanitizePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'));
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function roundedPath(ctx: CanvasRenderingContext2D, size: number, radius: number): void {
  ctx.beginPath();
  const withRound = ctx as unknown as { roundRect?: (x: number, y: number, w: number, h: number, r: number) => void };
  if (radius <= 0) ctx.rect(0, 0, size, size);
  else if (typeof withRound.roundRect === 'function') withRound.roundRect.call(ctx, 0, 0, size, size, Math.min(radius, size / 2));
  else {
    const r = Math.min(radius, size / 2);
    ctx.moveTo(r, 0);
    ctx.arcTo(size, 0, size, size, r);
    ctx.arcTo(size, size, 0, size, r);
    ctx.arcTo(0, size, 0, 0, r);
    ctx.arcTo(0, 0, size, 0, r);
    ctx.closePath();
  }
}

/** Draw the icon at MASTER resolution. `opaque` forces the background colour. */
function renderMaster(options: FaviconOptions, image: LoadedImage | null, opaque: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MASTER;
  canvas.height = MASTER;
  const ctx = canvas.getContext('2d')!;
  const geo = layout(MASTER, options);
  const fillBackground = opaque || !options.transparent;
  ctx.save();
  roundedPath(ctx, MASTER, geo.radius);
  if (fillBackground) {
    ctx.fillStyle = normalizeHex(options.background, '#ffffff');
    ctx.fill();
  }
  if (geo.radius > 0) ctx.clip();
  if (options.source === 'image' && image) {
    const box = containIn(image.width, image.height, geo.inner);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.source, box.x, box.y, box.w, box.h);
  } else {
    const text = options.text.trim() || 'C';
    const chars = graphemeCount(text);
    ctx.fillStyle = normalizeHex(options.textColor, '#ffffff');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(fontSizeFor(geo.inner.size, chars))}px ${fontCss(options.font)}`;
    const m = ctx.measureText(text);
    // Centre on the visible glyph box rather than the em box so letters sit optically centred.
    const ascent = m.actualBoundingBoxAscent || 0;
    const descent = m.actualBoundingBoxDescent || 0;
    const y = MASTER / 2 + (ascent - descent) / 2;
    const width = m.width || 1;
    const maxWidth = geo.inner.size;
    if (width > maxWidth) {
      ctx.save();
      ctx.translate(MASTER / 2, 0);
      ctx.scale(maxWidth / width, 1);
      ctx.fillText(text, 0, y);
      ctx.restore();
    } else ctx.fillText(text, MASTER / 2, y);
  }
  ctx.restore();
  return canvas;
}

/** Downscale in halving steps for clean small icons. */
function downscale(master: HTMLCanvasElement, size: number): HTMLCanvasElement {
  let src: HTMLCanvasElement = master;
  while (src.width / 2 >= size * 1.5 && src.width / 2 >= size) {
    const step = document.createElement('canvas');
    step.width = Math.round(src.width / 2);
    step.height = Math.round(src.height / 2);
    const c = step.getContext('2d')!;
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, step.width, step.height);
    src = step;
  }
  const out = document.createElement('canvas');
  out.width = size;
  out.height = size;
  const c = out.getContext('2d')!;
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  c.drawImage(src, 0, 0, size, size);
  return out;
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

async function loadSvg(file: File): Promise<LoadedImage> {
  const svg = await file.text();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('This SVG could not be rendered.'));
    el.src = url;
  });
  const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
  const width = img.naturalWidth || (viewBox ? Number(viewBox[1]) : 512) || 512;
  const height = img.naturalHeight || (viewBox ? Number(viewBox[2]) : 512) || 512;
  return { source: img, width, height, name: file.name, svg };
}

export default function FaviconGenerator() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [options, setOptions] = useState<FaviconOptions>(loadPrefs);
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const update = (patch: Partial<FaviconOptions>) => setOptions((o) => ({ ...o, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(options));
    } catch {}
  }, [options]);

  const usingImage = options.source === 'image' && image !== null;
  const hasSvg = usingImage && !!image?.svg;
  const htmlSnippet = useMemo(() => buildHtml(options, hasSvg), [options.themeColor, options.basePath, hasSvg]);

  // Re-render previews (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      const transparentMaster = renderMaster(options, usingImage ? image : null, false);
      const opaqueMaster = renderMaster(options, usingImage ? image : null, true);
      const next: Record<number, string> = {};
      for (const size of [16, 32, 48, 180, 192, 512]) {
        const master = size === 180 ? opaqueMaster : transparentMaster;
        next[size] = size === 512 ? master.toDataURL('image/png') : downscale(master, size).toDataURL('image/png');
      }
      setPreviews(next);
    }, 120);
    return () => clearTimeout(t);
  }, [options, image, usingImage]);

  // ------------------------------------------------------------------ actions

  const open = useCallback(async (file: File) => {
    if (file.size > MAX_FILE) {
      toast('Images up to 20 MB, please', 'error');
      return;
    }
    if (!file.type.startsWith('image/') && !/\.(svg|png|jpe?g|webp|gif|avif|bmp|ico)$/i.test(file.name)) {
      toast(`${file.name} is not an image`, 'error');
      return;
    }
    setBusy('Reading image');
    try {
      let loaded: LoadedImage;
      if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) loaded = await loadSvg(file);
      else {
        const d = await decodeFile(file);
        loaded = { source: d.source, width: d.size.width, height: d.size.height, name: file.name, svg: null };
      }
      setImage((prev) => {
        if (prev) releaseSource(prev.source);
        return loaded;
      });
      update({ source: 'image' });
      if (loaded.width !== loaded.height) toast('The image is not square, so it is centred with space around it');
      track('tool_action', { tool: TOOL, action: 'open', type: file.type || 'unknown' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open that image', 'error', 4000);
    } finally {
      setBusy(null);
    }
  }, []);

  const loadSample = async () => {
    update({ source: 'text', text: 'C', background: '#4f46e5', textColor: '#ffffff', radius: 22, padding: 8 });
    track('tool_action', { tool: TOOL, action: 'sample' });
  };

  const loadSampleImage = async () => {
    await open(await makeSample());
  };

  const reset = () => {
    setOptions(DEFAULT_OPTIONS);
    setImage((prev) => {
      if (prev) releaseSource(prev.source);
      return null;
    });
  };

  const download = async () => {
    setBusy('Building favicon.zip');
    try {
      const src = usingImage ? image : null;
      const transparentMaster = renderMaster(options, src, false);
      const opaqueMaster = renderMaster(options, src, true);
      const entries: { name: string; data: Blob | string | Uint8Array }[] = [];
      const icoImages = await Promise.all(ICO_SIZES.map(async (size) => ({ size, png: new Uint8Array(await (await toPng(downscale(transparentMaster, size))).arrayBuffer()) })));
      entries.push({ name: 'favicon.ico', data: buildIco(icoImages) });
      if (hasSvg && image?.svg) entries.push({ name: 'icon.svg', data: image.svg });
      for (const out of PNG_OUTPUTS) {
        const master = out.opaque ? opaqueMaster : transparentMaster;
        entries.push({ name: out.name, data: await toPng(out.size === MASTER ? master : downscale(master, out.size)) });
      }
      entries.push({ name: 'site.webmanifest', data: buildManifest(options) });
      entries.push({ name: 'favicon-html.txt', data: htmlSnippet });
      const zip = await buildZip(entries);
      downloadBlob(zip, 'favicon.zip');
      toast(`favicon.zip saved (${formatBytes(zip.size)}, ${entries.length} files)`);
      track('tool_action', { tool: TOOL, action: 'download', files: entries.length });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not build the zip', 'error', 4000);
    } finally {
      setBusy(null);
    }
  };

  const copyHtml = async () => {
    const ok = await copyText(htmlSnippet);
    toast(ok ? 'HTML copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy_html' });
  };

  // Paste images anywhere
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        void open(f);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open]);

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void download();
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

  const files = fileList(hasSvg);

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
        accept="image/*,.svg,.ico"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void open(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={options.source}
          onChange={(source) => {
            if (source === 'image' && !image) fileRef.current?.click();
            else update({ source });
          }}
          options={[
            { value: 'text', label: 'Text or emoji', icon: 'pencil' },
            { value: 'image', label: 'Image', icon: 'image' },
          ]}
          label="Source"
        />
        <button type="button" class="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
          <Icon name="folder-open" size={14} /> Open
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => void loadSample()} title="Load an example text favicon">
          <Icon name="sparkles" size={14} /> Sample
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Reset every option">
          <Icon name="eraser" size={14} /> Reset
        </button>
        <span class="flex-1" />
        <button type="button" class="btn-secondary btn-sm" onClick={() => void copyHtml()} title="Copy the HTML link tags">
          <Icon name="code" size={14} /> Copy HTML
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={() => void download()} disabled={!!busy} title="Download every file as favicon.zip (Ctrl+S)">
          <Icon name="download" size={14} /> Download zip
        </button>
        <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* Options */}
        <aside class="scrollbar-thin flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3 text-sm max-lg:max-h-[420px]" aria-label="Favicon options">
          {options.source === 'text' ? (
            <Group title="Text or emoji">
              <Field label="Characters (1 to 4)">
                <input class="input h-9 text-base" value={options.text} maxLength={4} onInput={(e) => update({ text: (e.currentTarget as HTMLInputElement).value })} aria-label="Favicon text" />
              </Field>
              <Field label="Font">
                <select class="select h-8 text-[13px]" value={options.font} onChange={(e) => update({ font: (e.currentTarget as HTMLSelectElement).value })} aria-label="Font">
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <ColorField label="Text colour" value={options.textColor} onChange={(textColor) => update({ textColor })} />
            </Group>
          ) : (
            <Group title="Image">
              {image ? (
                <p class="text-xs text-ink-2">
                  <span class="font-medium text-ink">{image.name}</span>
                  <br />
                  {Math.round(image.width)} × {Math.round(image.height)}
                  {image.svg ? ' · SVG, also exported as icon.svg' : ''}
                </p>
              ) : (
                <div class="flex flex-col gap-2">
                  <button type="button" class="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                    <Icon name="upload" size={14} /> Choose an image
                  </button>
                  <button type="button" class="btn-ghost btn-sm" onClick={() => void loadSampleImage()}>
                    Use a sample photo
                  </button>
                </div>
              )}
              <Chip on={options.transparent} onClick={() => update({ transparent: !options.transparent })} title="Keep transparency in the PNG and ICO files (the Apple icon is always opaque)">
                Transparent background
              </Chip>
            </Group>
          )}

          <Group title="Shape">
            <ColorField label="Background" value={options.background} onChange={(background) => update({ background })} />
            <Range label="Padding" value={options.padding} min={0} max={30} unit="%" onChange={(padding) => update({ padding })} />
            <Range label="Corner radius" value={options.radius} min={0} max={50} unit="%" onChange={(radius) => update({ radius })} />
            <div class="flex gap-1">
              {[
                ['Square', 0],
                ['Rounded', 22],
                ['Circle', 50],
              ].map(([label, r]) => (
                <button key={label} type="button" class={'btn-sm flex-1 px-0 text-xs ' + (options.radius === r ? 'btn-primary' : 'btn-secondary')} onClick={() => update({ radius: r as number })}>
                  {label}
                </button>
              ))}
            </div>
          </Group>

          <Group title="App details">
            <Field label="App name">
              <input class="input h-8 text-xs" value={options.appName} onInput={(e) => update({ appName: (e.currentTarget as HTMLInputElement).value })} aria-label="App name" />
            </Field>
            <Field label="Short name (home screen label)">
              <input class="input h-8 text-xs" value={options.shortName} maxLength={24} onInput={(e) => update({ shortName: (e.currentTarget as HTMLInputElement).value })} aria-label="Short name" />
            </Field>
            <ColorField label="Theme colour" value={options.themeColor} onChange={(themeColor) => update({ themeColor })} />
            <Field label="Files served from">
              <input class="input h-8 font-mono text-xs" value={options.basePath} onInput={(e) => update({ basePath: (e.currentTarget as HTMLInputElement).value })} aria-label="Base path" placeholder="/" />
            </Field>
          </Group>
        </aside>

        {/* Previews */}
        <section class="scrollbar-thin flex min-h-0 min-w-0 flex-col overflow-y-auto rounded-lg border border-line-strong bg-surface" aria-label="Previews">
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 text-xs">
            <span class="font-semibold text-ink">Preview</span>
            <span class="text-ink-3">{files.length} files in the zip</span>
          </header>

          <div class="grid gap-3 p-3 xl:grid-cols-2">
            {/* Browser tab */}
            <div class="rounded-lg border border-line bg-surface-3 p-3">
              <div class="mb-2 text-xs font-medium text-ink-2">Browser tab</div>
              <div class="flex items-end gap-1">
                {[false, true].map((dark) => (
                  <div key={String(dark)} class={'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-t-lg px-3 text-xs ' + (dark ? 'bg-[#35363a] text-[#e8eaed]' : 'bg-white text-[#202124]')}>
                    {previews[32] && <img src={previews[32]} alt="" width={16} height={16} class="shrink-0" />}
                    <span class="truncate">{options.appName || 'My Website'}</span>
                    <Icon name="x" size={12} class="ml-auto shrink-0 opacity-60" />
                  </div>
                ))}
              </div>
            </div>

            {/* Phone */}
            <div class="rounded-lg border border-line bg-surface-3 p-3">
              <div class="mb-2 text-xs font-medium text-ink-2">Phone home screen</div>
              <div class="flex items-start justify-center gap-5 rounded-xl bg-gradient-to-br from-[#1e3a8a] via-[#6d28d9] to-[#db2777] px-4 py-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} class="flex w-16 flex-col items-center gap-1">
                    {i === 1 && previews[180] ? (
                      <img src={previews[180]} alt="" width={56} height={56} class="h-14 w-14 rounded-[13px] shadow-lg" />
                    ) : (
                      <span class="h-14 w-14 rounded-[13px] bg-white/25" />
                    )}
                    <span class="w-full truncate text-center text-[11px] text-white">{i === 1 ? options.shortName || options.appName || 'Website' : i === 0 ? 'Photos' : 'Mail'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sizes on light and dark */}
          <div class="grid grid-cols-1 gap-3 px-3 pb-3 sm:grid-cols-2">
            {[false, true].map((dark) => (
              <div key={String(dark)} class={'flex flex-wrap items-end gap-4 rounded-lg border p-4 ' + (dark ? 'border-[#30363d] bg-[#0d1117]' : 'border-line bg-white')}>
                {[16, 32, 48, 180].map((size) => (
                  <figure key={size} class="flex flex-col items-center gap-1">
                    {previews[size] ? <img src={previews[size]} alt={`${size} pixel icon`} width={Math.min(size, 96)} height={Math.min(size, 96)} style={size <= 48 ? { imageRendering: 'auto' } : undefined} /> : <span style={{ width: `${Math.min(size, 96)}px`, height: `${Math.min(size, 96)}px` }} />}
                    <figcaption class={'font-mono text-[10px] ' + (dark ? 'text-[#8b949e]' : 'text-ink-3')}>{size}px</figcaption>
                  </figure>
                ))}
              </div>
            ))}
          </div>

          {/* Files */}
          <div class="px-3 pb-3">
            <div class="mb-1 text-xs font-medium text-ink-2">What the zip contains</div>
            <ul class="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <li class="flex justify-between gap-2 font-mono">
                <span>favicon.ico</span>
                <span class="text-ink-3">16, 32, 48 px</span>
              </li>
              {hasSvg && (
                <li class="flex justify-between gap-2 font-mono">
                  <span>icon.svg</span>
                  <span class="text-ink-3">your SVG</span>
                </li>
              )}
              {PNG_OUTPUTS.map((o) => (
                <li key={o.name} class="flex justify-between gap-2 font-mono" title={o.purpose}>
                  <span class="truncate">{o.name}</span>
                  <span class="shrink-0 text-ink-3">{o.purpose.split(' ').slice(0, 2).join(' ')}</span>
                </li>
              ))}
              <li class="flex justify-between gap-2 font-mono">
                <span>site.webmanifest</span>
                <span class="text-ink-3">PWA manifest</span>
              </li>
              <li class="flex justify-between gap-2 font-mono">
                <span>favicon-html.txt</span>
                <span class="text-ink-3">tags below</span>
              </li>
            </ul>
          </div>

          {/* HTML snippet */}
          <div class="mx-3 mb-3 flex h-[220px] shrink-0 flex-col overflow-hidden rounded-lg border border-line-strong">
            <div class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">HTML for your &lt;head&gt;</span>
              <span class="flex-1" />
              <HeaderButton icon="copy" title="Copy the HTML" onClick={() => void copyHtml()} />
            </div>
            <CodeEditor value={htmlSnippet} readOnly language={html()} wrap ariaLabel="Favicon HTML" class="flex-1" />
          </div>
        </section>
      </div>

      {(busy || dragOver) && (
        <div class="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-brand-500 bg-surface/80 text-sm text-ink-2">
          {busy ? (
            <>
              <Icon name="loader" size={16} class="mr-2 animate-spin" /> {busy}
            </>
          ) : (
            'Drop an image to use it as the favicon'
          )}
        </div>
      )}

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">{usingImage && image ? `Source: ${image.name}` : `Source: "${options.text.trim() || 'C'}" on ${options.background}`} · Everything is drawn in your browser. Nothing is uploaded.</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">S</span> download zip
        </span>
      </div>
    </div>
  );
}

function Group(p: { title: string; children: ComponentChildren }) {
  return (
    <section>
      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{p.title}</h3>
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

function ColorField(p: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={p.label}>
      <div class="flex items-center gap-2">
        <input type="color" class="h-8 w-10 cursor-pointer rounded border border-line-strong bg-surface p-0.5" value={normalizeHex(p.value, '#000000')} onInput={(e) => p.onChange((e.currentTarget as HTMLInputElement).value)} aria-label={`${p.label} picker`} />
        <input class="input h-8 flex-1 font-mono text-xs" value={p.value} onChange={(e) => p.onChange(normalizeHex((e.currentTarget as HTMLInputElement).value, p.value))} aria-label={p.label} />
      </div>
    </Field>
  );
}

function Range(p: { label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label class="block">
      <span class="flex items-center justify-between text-xs text-ink-2">
        <span>{p.label}</span>
        <span class="font-mono tabular-nums">
          {p.value}
          {p.unit}
        </span>
      </span>
      <input type="range" class="mt-1 w-full accent-brand-600" min={p.min} max={p.max} value={p.value} onInput={(e) => p.onChange(Number((e.currentTarget as HTMLInputElement).value))} aria-label={p.label} />
    </label>
  );
}
