/**
 * Color Picker from Image: open an image, hover to see a pixel loupe, click (or press
 * Enter) to pick, zoom with the wheel, drag to pan, nudge the cursor with the arrow
 * keys. Every picked colour shows HEX, RGB, HSL, HSV, CMYK, the nearest CSS name and
 * its contrast against white and black. A dominant palette is extracted automatically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { HeaderButton, Segmented } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import { decodeFile, makeSample, releaseSource } from '../image-editor/canvas';
import {
  addToPalette,
  bestTextColor,
  contrastRatio,
  exportPalette,
  extractPalette,
  formats,
  grade,
  parseHex,
  sanitizePalette,
  toHex,
  type ExportFormat,
  type PaletteColor,
  type PickedColor,
  type Rgb,
} from './logic';

const TOOL = 'color-picker-from-image';
const PALETTE_KEY = 'cuis-picker:palette';
const MAX_WORK = 4096;
const LOUPE_CELLS = 11;
const LOUPE_PX = 12;
const MAX_FILE = 50 * 1024 * 1024;

interface Work {
  canvas: HTMLCanvasElement;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Original image size (the working copy may be scaled down). */
  origW: number;
  origH: number;
  name: string;
}

interface View {
  scale: number;
  x: number;
  y: number;
}

declare global {
  interface Window {
    EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> };
  }
}

function loadPalette(): PickedColor[] {
  try {
    return sanitizePalette(JSON.parse(localStorage.getItem(PALETTE_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

let idSeq = 0;
const newId = () => `${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

export default function ColorPicker() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [work, setWork] = useState<Work | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ x: number; y: number; px: number; py: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [palette, setPalette] = useState<PickedColor[]>(loadPalette);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dominant, setDominant] = useState<PaletteColor[]>([]);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('css');
  const [busy, setBusy] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number; moved: boolean } | null>(null);
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  useEffect(() => {
    try {
      localStorage.setItem(PALETTE_KEY, JSON.stringify(palette));
    } catch {}
  }, [palette]);

  // ------------------------------------------------------------------ loading

  const fit = useCallback((w: Work, box = stage) => {
    if (box.w <= 0 || box.h <= 0) return;
    const scale = Math.min(box.w / w.width, box.h / w.height, 8);
    setView({ scale, x: (box.w - w.width * scale) / 2, y: (box.h - w.height * scale) / 2 });
  }, [stage]);

  const open = useCallback(async (file: File) => {
    if (file.size > MAX_FILE) {
      toast('Images up to 50 MB, please', 'error');
      return;
    }
    setBusy('Reading image');
    try {
      const d = await decodeFile(file);
      const ratio = Math.min(1, MAX_WORK / Math.max(d.size.width, d.size.height));
      const width = Math.max(1, Math.round(d.size.width * ratio));
      const height = Math.max(1, Math.round(d.size.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(d.source, 0, 0, width, height);
      releaseSource(d.source);
      const data = ctx.getImageData(0, 0, width, height).data;
      const next: Work = { canvas, data, width, height, origW: d.size.width, origH: d.size.height, name: file.name || 'pasted image' };
      setWork(next);
      setCursor({ x: Math.floor(width / 2), y: Math.floor(height / 2) });
      fit(next);
      // Dominant palette from a small copy
      const small = document.createElement('canvas');
      const sr = Math.min(1, 220 / Math.max(width, height));
      small.width = Math.max(1, Math.round(width * sr));
      small.height = Math.max(1, Math.round(height * sr));
      const sctx = small.getContext('2d')!;
      sctx.drawImage(canvas, 0, 0, small.width, small.height);
      setDominant(extractPalette(sctx.getImageData(0, 0, small.width, small.height).data, 8));
      track('tool_action', { tool: TOOL, action: 'open' });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open that image', 'error', 4000);
    } finally {
      setBusy(null);
    }
  }, [fit]);

  const loadSample = async () => {
    await open(await makeSample());
    track('tool_action', { tool: TOOL, action: 'sample' });
  };

  // Stage size
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setStage({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Refit when the stage first gets a size
  const fittedFor = useRef<Work | null>(null);
  useEffect(() => {
    if (work && stage.w > 0 && fittedFor.current !== work) {
      fittedFor.current = work;
      fit(work, stage);
    }
  }, [work, stage, fit]);

  // Draw the view
  useEffect(() => {
    const c = viewRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.max(1, stage.w * dpr);
    c.height = Math.max(1, stage.h * dpr);
    c.style.width = `${stage.w}px`;
    c.style.height = `${stage.h}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, stage.w, stage.h);
    if (!work) return;
    ctx.imageSmoothingEnabled = view.scale < 3;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(work.canvas, view.x, view.y, work.width * view.scale, work.height * view.scale);
    // Keyboard cursor
    const cur = hover ?? cursor;
    if (cur && view.scale >= 4) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(view.x + cur.x * view.scale, view.y + cur.y * view.scale, view.scale, view.scale);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.strokeRect(view.x + cur.x * view.scale - 1.5, view.y + cur.y * view.scale - 1.5, view.scale + 3, view.scale + 3);
    } else if (cur && !hover) {
      const cx = view.x + (cur.x + 0.5) * view.scale;
      const cy = view.y + (cur.y + 0.5) * view.scale;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [work, view, stage, hover, cursor]);

  // ------------------------------------------------------------------ pixels

  const pixelAt = useCallback(
    (x: number, y: number): Rgb | null => {
      if (!work || x < 0 || y < 0 || x >= work.width || y >= work.height) return null;
      const o = (y * work.width + x) * 4;
      return { r: work.data[o]!, g: work.data[o + 1]!, b: work.data[o + 2]! };
    },
    [work],
  );

  const toImage = (clientX: number, clientY: number) => {
    const rect = stageRef.current!.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return { x: Math.floor((px - view.x) / view.scale), y: Math.floor((py - view.y) / view.scale), px, py };
  };

  // Loupe
  const loupePos = hover ?? null;
  useEffect(() => {
    const c = loupeRef.current;
    if (!c || !work || !loupePos) return;
    const size = LOUPE_CELLS * LOUPE_PX;
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    const half = Math.floor(LOUPE_CELLS / 2);
    ctx.drawImage(work.canvas, loupePos.x - half, loupePos.y - half, LOUPE_CELLS, LOUPE_CELLS, 0, 0, size, size);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    for (let i = 1; i < LOUPE_CELLS; i++) {
      ctx.beginPath();
      ctx.moveTo(i * LOUPE_PX + 0.5, 0);
      ctx.lineTo(i * LOUPE_PX + 0.5, size);
      ctx.moveTo(0, i * LOUPE_PX + 0.5);
      ctx.lineTo(size, i * LOUPE_PX + 0.5);
      ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(half * LOUPE_PX + 1, half * LOUPE_PX + 1, LOUPE_PX - 2, LOUPE_PX - 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(half * LOUPE_PX - 0.5, half * LOUPE_PX - 0.5, LOUPE_PX + 1, LOUPE_PX + 1);
  }, [work, loupePos?.x, loupePos?.y]);

  // ------------------------------------------------------------------ picking

  const pick = useCallback(
    (x: number, y: number) => {
      const c = pixelAt(x, y);
      if (!c) return;
      const item: PickedColor = { ...c, id: newId(), x, y };
      setPalette((p) => addToPalette(p, item));
      setSelectedId(item.id);
      track('tool_action', { tool: TOOL, action: 'pick' });
    },
    [pixelAt],
  );

  const addColor = (c: Rgb) => {
    const item: PickedColor = { r: c.r, g: c.g, b: c.b, id: newId() };
    setPalette((p) => addToPalette(p, item));
    setSelectedId(item.id);
  };

  const eyeDropper = async () => {
    if (!window.EyeDropper) return;
    try {
      const res = await new window.EyeDropper().open();
      const c = parseHex(res.sRGBHex);
      if (c) addColor(c);
      track('tool_action', { tool: TOOL, action: 'eyedropper' });
    } catch {
      /* cancelled */
    }
  };

  // ------------------------------------------------------------------ pointer and wheel

  const onPointerDown = (e: PointerEvent) => {
    if (!work) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panRef.current = { startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!work) return;
    const p = panRef.current;
    if (p) {
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (!p.moved && Math.hypot(dx, dy) > 4) p.moved = true;
      if (p.moved) {
        setView((v) => ({ ...v, x: p.vx + dx, y: p.vy + dy }));
        setHover(null);
        return;
      }
    }
    const pos = toImage(e.clientX, e.clientY);
    if (pos.x >= 0 && pos.y >= 0 && pos.x < work.width && pos.y < work.height) {
      setHover(pos);
      setCursor({ x: pos.x, y: pos.y });
    } else setHover(null);
  };
  const onPointerUp = (e: PointerEvent) => {
    const p = panRef.current;
    panRef.current = null;
    if (!work || (p && p.moved)) return;
    const pos = toImage(e.clientX, e.clientY);
    pick(pos.x, pos.y);
  };

  const zoomAt = (factor: number, px: number, py: number) => {
    setView((v) => {
      const scale = Math.min(64, Math.max(0.05, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!work) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [work]);

  // ------------------------------------------------------------------ keyboard, paste, full screen

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.matches?.('input, select, textarea')) return;
      if (e.key === 'Escape' && full) {
        setFull(false);
        return;
      }
      if (!work || !cursor) return;
      const step = e.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const mv = moves[e.key];
      if (mv) {
        e.preventDefault();
        setHover(null);
        setCursor((c) => (c ? { x: Math.min(work.width - 1, Math.max(0, c.x + mv[0])), y: Math.min(work.height - 1, Math.max(0, c.y + mv[1])) } : c));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        pick(cursor.x, cursor.y);
      } else if (e.key === '+' || e.key === '=') zoomAt(1.25, stage.w / 2, stage.h / 2);
      else if (e.key === '-') zoomAt(0.8, stage.w / 2, stage.h / 2);
      else if (e.key === '0') fit(work);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });

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

  // ------------------------------------------------------------------ derived

  const selected = palette.find((p) => p.id === selectedId) ?? null;
  const live = hover ? pixelAt(hover.x, hover.y) : null;
  const focus: Rgb | null = live ?? selected ?? (cursor && work ? pixelAt(cursor.x, cursor.y) : null) ?? palette[0] ?? null;
  const focusLabel = live ? `Pixel ${hover!.x}, ${hover!.y}` : selected ? 'Picked colour' : cursor && work ? `Cursor ${cursor.x}, ${cursor.y}` : palette[0] ? 'Last picked' : '';
  const focusFormats = useMemo(() => (focus ? formats(focus) : []), [focus?.r, focus?.g, focus?.b]);
  const exportText = useMemo(() => exportPalette(palette.length ? [...palette].reverse() : dominant, exportFormat), [palette, dominant, exportFormat]);

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Copy failed', ok ? 'ok' : 'error');
  };

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
        accept="image/*"
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
          <Icon name="folder-open" size={14} /> Open
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => void loadSample()} title="Load a sample image">
          <Icon name="sparkles" size={14} /> Sample
        </button>
        {hasEyeDropper && (
          <button type="button" class="btn-ghost btn-sm" onClick={() => void eyeDropper()} title="Pick a colour from anywhere on your screen">
            <Icon name="eye" size={14} /> Screen picker
          </button>
        )}
        <span class="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <HeaderButton icon="minus" title="Zoom out (-)" onClick={() => zoomAt(0.8, stage.w / 2, stage.h / 2)} disabled={!work} />
        <span class="min-w-[3.25rem] text-center font-mono text-xs tabular-nums text-ink-2">{work ? `${Math.round(view.scale * 100)}%` : '–'}</span>
        <HeaderButton icon="plus" title="Zoom in (+)" onClick={() => zoomAt(1.25, stage.w / 2, stage.h / 2)} disabled={!work} />
        <button type="button" class="btn-ghost btn-sm" onClick={() => work && fit(work)} disabled={!work} title="Fit to view (0)">
          Fit
        </button>
        <button
          type="button"
          class="btn-ghost btn-sm"
          disabled={!work}
          onClick={() => work && setView({ scale: 1, x: (stage.w - work.width) / 2, y: (stage.h - work.height) / 2 })}
          title="Actual pixels"
        >
          100%
        </button>
        <span class="flex-1" />
        <button
          type="button"
          class="btn-ghost btn-sm"
          onClick={() => {
            setPalette([]);
            setSelectedId(null);
          }}
          disabled={palette.length === 0}
          title="Remove every picked colour"
        >
          <Icon name="eraser" size={14} /> Clear
        </button>
        <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[minmax(0,1fr)]">
        {/* Stage */}
        <section
          ref={stageRef}
          class={'relative h-[360px] min-h-0 min-w-0 select-none overflow-hidden rounded-lg border border-line-strong bg-[repeating-conic-gradient(var(--color-surface-3)_0%_25%,var(--color-surface)_0%_50%)] [background-size:18px_18px] lg:h-auto ' + (work ? 'cursor-crosshair touch-none' : '')}
          aria-label="Image"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            if (!panRef.current) setHover(null);
          }}
        >
          <canvas ref={viewRef} class="absolute inset-0 block" />
          {!work && (
            <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Icon name="image" size={26} />
              </span>
              <p class="text-sm font-medium">Drop an image here, paste one, or</p>
              <div class="flex gap-2">
                <button type="button" class="btn-primary btn-sm" onPointerDown={(e) => e.stopPropagation()} onClick={() => fileRef.current?.click()}>
                  <Icon name="folder-open" size={14} /> Open image
                </button>
                <button type="button" class="btn-secondary btn-sm" onPointerDown={(e) => e.stopPropagation()} onClick={() => void loadSample()}>
                  Try a sample
                </button>
              </div>
              <p class="text-xs text-ink-3">Click to pick, scroll to zoom, drag to pan, arrows and Enter for pixel precision.</p>
            </div>
          )}
          {work && hover && live && (
            <div
              class="pointer-events-none absolute z-10 overflow-hidden rounded-lg border border-line-strong bg-surface shadow-float"
              style={{
                left: `${Math.min(stage.w - LOUPE_CELLS * LOUPE_PX - 14, hover.px + 18)}px`,
                top: `${hover.py + 18 + LOUPE_CELLS * LOUPE_PX + 30 > stage.h ? hover.py - LOUPE_CELLS * LOUPE_PX - 48 : hover.py + 18}px`,
              }}
            >
              <canvas ref={loupeRef} class="block" style={{ width: `${LOUPE_CELLS * LOUPE_PX}px`, height: `${LOUPE_CELLS * LOUPE_PX}px` }} />
              <div class="flex items-center gap-1.5 px-2 py-1 font-mono text-[11px]">
                <span class="h-3 w-3 rounded-sm border border-line-strong" style={{ background: toHex(live) }} />
                {toHex(live)}
              </div>
            </div>
          )}
          {busy && (
            <div class="absolute inset-0 flex items-center justify-center bg-surface/70 text-sm text-ink-2">
              <Icon name="loader" size={16} class="mr-2 animate-spin" /> {busy}
            </div>
          )}
          {dragOver && <div class="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-brand-500 bg-surface/70 text-sm text-ink-2">Drop the image to open it</div>}
        </section>

        {/* Colours */}
        <aside class="scrollbar-thin flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3 text-sm max-lg:max-h-[560px]" aria-label="Colours">
          {/* Current */}
          <section aria-label="Current colour">
            <div class="mb-2 flex items-center justify-between text-xs">
              <span class="font-semibold uppercase tracking-wide text-ink-3">Colour</span>
              <span class="text-ink-3">{focusLabel}</span>
            </div>
            {focus ? (
              <>
                <div class="flex h-16 items-center justify-center rounded-lg border border-line-strong font-mono text-lg font-semibold" style={{ background: toHex(focus), color: bestTextColor(focus) }}>
                  {toHex(focus)}
                </div>
                <ul class="mt-2 divide-y divide-line rounded-md border border-line">
                  {focusFormats.map((f) => (
                    <li key={f.id} class="flex items-center gap-2 px-2 py-1">
                      <span class="w-[4.5rem] shrink-0 text-xs text-ink-3">{f.label}</span>
                      <span class="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={f.value}>
                        {f.value}
                      </span>
                      <HeaderButton icon="copy" title={`Copy ${f.label}`} onClick={() => void copy(f.value.replace(/ \(closest\)$/, ''), f.label)} />
                    </li>
                  ))}
                </ul>
                <div class="mt-2 grid grid-cols-2 gap-2">
                  {[
                    { label: 'On white', other: { r: 255, g: 255, b: 255 }, bg: '#ffffff' },
                    { label: 'On black', other: { r: 0, g: 0, b: 0 }, bg: '#000000' },
                  ].map(({ label, other, bg }) => {
                    const g = grade(contrastRatio(focus, other));
                    return (
                      <div key={label} class="rounded-md border border-line p-2">
                        <div class="flex items-center justify-between">
                          <span class="rounded px-1.5 py-0.5 text-xs font-semibold" style={{ background: bg, color: toHex(focus) }}>
                            Aa
                          </span>
                          <span class="font-mono text-xs tabular-nums">{g.ratio.toFixed(2)}:1</span>
                        </div>
                        <div class="mt-1.5 flex flex-wrap gap-1">
                          <Badge ok={g.aa} label="AA" />
                          <Badge ok={g.aaa} label="AAA" />
                          <Badge ok={g.aaLarge} label="Large" />
                        </div>
                        <div class="mt-1 text-[10px] text-ink-3">{label}</div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p class="rounded-md border border-dashed border-line-strong p-4 text-center text-xs text-ink-3">Open an image and hover over it to read colours.</p>
            )}
          </section>

          {/* Picked */}
          <section aria-label="Picked colours">
            <div class="mb-2 flex items-center justify-between text-xs">
              <span class="font-semibold uppercase tracking-wide text-ink-3">Picked ({palette.length}/24)</span>
              {selected && (
                <button type="button" class="text-ink-3 hover:text-danger" onClick={() => setPalette((p) => p.filter((x) => x.id !== selected.id))}>
                  Remove selected
                </button>
              )}
            </div>
            {palette.length ? (
              <div class="grid grid-cols-8 gap-1.5">
                {palette.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    class={'aspect-square rounded-md border transition-transform hover:scale-110 ' + (p.id === selectedId ? 'border-ink ring-2 ring-brand-500' : 'border-line-strong')}
                    style={{ background: toHex(p) }}
                    title={toHex(p)}
                    aria-label={`Select ${toHex(p)}`}
                    onClick={() => {
                      setSelectedId(p.id);
                      if (typeof p.x === 'number' && typeof p.y === 'number') setCursor({ x: p.x, y: p.y });
                    }}
                  />
                ))}
              </div>
            ) : (
              <p class="text-xs text-ink-3">Click the image or press Enter to add colours here.</p>
            )}
          </section>

          {/* Dominant */}
          {dominant.length > 0 && (
            <section aria-label="Dominant colours">
              <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Dominant colours</div>
              <div class="flex h-9 overflow-hidden rounded-md border border-line-strong">
                {dominant.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    class="h-full transition-[flex] hover:brightness-110"
                    style={{ background: toHex(d), flex: `${Math.max(0.04, d.share)} 1 0` }}
                    title={`${toHex(d)} · ${Math.round(d.share * 100)}% of the image. Click to add.`}
                    aria-label={`Add ${toHex(d)}`}
                    onClick={() => addColor(d)}
                  />
                ))}
              </div>
              <div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px] text-ink-3">
                {dominant.map((d, i) => (
                  <span key={i}>
                    {toHex(d)} {Math.round(d.share * 100)}%
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Export */}
          <section aria-label="Export palette">
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-ink-3">Export</span>
              <Segmented
                value={exportFormat}
                onChange={setExportFormat}
                options={[
                  { value: 'css', label: 'CSS' },
                  { value: 'json', label: 'JSON' },
                  { value: 'tailwind', label: 'Tailwind' },
                  { value: 'hex', label: 'HEX' },
                ]}
                label="Export format"
              />
            </div>
            <div class="relative">
              <pre class="scrollbar-thin max-h-40 overflow-auto rounded-md border border-line bg-surface-2 p-2 font-mono text-[11px] leading-5 text-ink">{palette.length || dominant.length ? exportText : 'Pick colours or open an image first.'}</pre>
              <button
                type="button"
                class="btn-primary btn-sm absolute right-1.5 top-1.5 h-7"
                onClick={() => {
                  void copy(exportText, 'Palette');
                  track('tool_action', { tool: TOOL, action: 'export', format: exportFormat });
                }}
                disabled={!palette.length && !dominant.length}
              >
                <Icon name="copy" size={12} /> Copy
              </button>
            </div>
            <p class="mt-1 text-[11px] text-ink-3">{palette.length ? 'Exports your picked colours in the order you picked them.' : 'Nothing picked yet, so this exports the dominant colours.'}</p>
          </section>
        </aside>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">
          {work
            ? `${work.name} · ${work.origW} × ${work.origH}${work.width !== work.origW ? ` (sampled at ${work.width} × ${work.height})` : ''} · nothing is uploaded`
            : 'Your image stays in this browser tab. Nothing is uploaded.'}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">←</span>
          <span class="kbd">→</span> nudge · <span class="kbd">Enter</span> pick
        </span>
      </div>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return <span class={'rounded px-1.5 py-0.5 text-[10px] font-semibold ' + (ok ? 'bg-success/15 text-success' : 'bg-danger/10 text-danger line-through decoration-1')}>{label}</span>;
}
