/**
 * Image Editor workspace: a stage with the live preview and an interactive crop box,
 * and a sidebar with Crop, Resize, Adjust and Export panels. Edits are non-destructive
 * (see logic.ts) with undo, redo, reset and a hold-to-compare button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { toast, track } from '../shared/toast';
import { canEncode, copyCanvas, decodeFile, downloadBlob, encode, makeSample, releaseSource, renderOriented, renderOutput, supportsCanvasFilter, type Decoded } from './canvas';
import {
  ADJUSTMENT_RANGES,
  ASPECTS,
  DEFAULT_ADJUST,
  ImageError,
  OUTPUT_TYPES,
  SIZE_PRESETS,
  assertUsableFile,
  baseName,
  centeredCrop,
  clampRect,
  describeState,
  dragRect,
  filterString,
  fitScale,
  formatBytes,
  formatDimensions,
  initialState,
  isIdentity,
  matchAspect,
  normalizeHex,
  orientedSize,
  outputFileName,
  parseDimension,
  flipState,
  rotateState,
  scaleByPercent,
  withCrop,
  type Adjustments,
  type Dimensions,
  type EditState,
  type ExportOptions,
  type HandleId,
  type OutputType,
  type Rect,
} from './logic';

type Tab = 'crop' | 'resize' | 'adjust' | 'export';
const TOOL = 'image-editor';
const EXPORT_KEY = 'cuis-img:export';
const HANDLES: HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function loadExport(): ExportOptions {
  const d: ExportOptions = { type: 'image/png', quality: 90, background: '#ffffff' };
  try {
    const raw = JSON.parse(localStorage.getItem(EXPORT_KEY) ?? 'null') as Partial<ExportOptions> | null;
    if (!raw) return d;
    if (OUTPUT_TYPES.some((t) => t.type === raw.type)) d.type = raw.type as OutputType;
    if (typeof raw.quality === 'number' && raw.quality >= 1 && raw.quality <= 100) d.quality = Math.round(raw.quality);
    if (typeof raw.background === 'string') d.background = normalizeHex(raw.background);
  } catch {}
  return d;
}

export default function ImageEditor() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [state, setState] = useState<EditState | null>(null);
  const [past, setPast] = useState<EditState[]>([]);
  const [future, setFuture] = useState<EditState[]>([]);
  const [tab, setTab] = useState<Tab>('crop');
  const [aspectId, setAspectId] = useState('free');
  const [lockAspect, setLockAspect] = useState(true);
  const [exportOpts, setExportOpts] = useState<ExportOptions>(() => (typeof window === 'undefined' ? { type: 'image/png', quality: 90, background: '#ffffff' } : loadExport()));
  const [fileName, setFileName] = useState('');
  const [estimate, setEstimate] = useState<{ bytes: number; type: OutputType } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [full, setFull] = useState(false);
  const [stageBox, setStageBox] = useState<Dimensions>({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [filtersOk] = useState(() => (typeof window === 'undefined' ? true : supportsCanvasFilter()));
  const dragBase = useRef<EditState | null>(null);
  const estimateSeq = useRef(0);

  const source = decoded?.size ?? null;
  const oriented = useMemo(() => (decoded && state ? renderOriented(decoded.source, decoded.size, state) : null), [decoded, state?.rotation, state?.flipH, state?.flipV]);
  const osize: Dimensions = useMemo(() => (source && state ? orientedSize(source, state.rotation) : { width: 0, height: 0 }), [source, state?.rotation]);
  const scale = useMemo(() => fitScale(osize, stageBox, 1), [osize, stageBox]);
  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  // ---------------------------------------------------------------- history helpers

  const commit = useCallback((next: EditState | ((s: EditState) => EditState)) => {
    setState((cur) => {
      if (!cur) return cur;
      const n = typeof next === 'function' ? next(cur) : next;
      setPast((p) => [...p.slice(-49), cur]);
      setFuture([]);
      return n;
    });
  }, []);

  /** Live update without a history entry; call `endLive` once the gesture ends. */
  const live = useCallback((next: (s: EditState) => EditState) => {
    setState((cur) => {
      if (!cur) return cur;
      if (!dragBase.current) dragBase.current = cur;
      return next(cur);
    });
  }, []);
  const endLive = useCallback(() => {
    const base = dragBase.current;
    dragBase.current = null;
    if (!base) return;
    setState((cur) => {
      if (cur && cur !== base) {
        setPast((p) => [...p.slice(-49), base]);
        setFuture([]);
      }
      return cur;
    });
  }, []);

  const undo = () => {
    setPast((p) => {
      const prev = p[p.length - 1];
      if (!prev) return p;
      setState((cur) => {
        if (cur) setFuture((f) => [cur, ...f]);
        return prev;
      });
      return p.slice(0, -1);
    });
  };
  const redo = () => {
    setFuture((f) => {
      const next = f[0];
      if (!next) return f;
      setState((cur) => {
        if (cur) setPast((p) => [...p, cur]);
        return next;
      });
      return f.slice(1);
    });
  };
  const reset = () => {
    if (!source || !state) return;
    commit(initialState(source));
    setAspectId('free');
  };

  // ---------------------------------------------------------------- loading

  const open = useCallback(async (f: File) => {
    try {
      assertUsableFile(f);
      setBusy('Decoding image');
      const d = await decodeFile(f);
      releaseSource(decoded?.source ?? null);
      setDecoded(d);
      setFile(f);
      setState(initialState(d.size));
      setPast([]);
      setFuture([]);
      setAspectId('free');
      setFileName(baseName(f.name));
      setEstimate(null);
      track('tool_action', { tool: TOOL, action: 'open', type: f.type, bytes: f.size });
    } catch (err) {
      toast(err instanceof ImageError ? err.message : 'Could not open that file.', 'error', 4000);
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded]);

  const openSample = async () => {
    setBusy('Creating sample');
    try {
      await open(await makeSample());
    } finally {
      setBusy(null);
    }
  };

  // Paste an image from the clipboard anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) {
        e.preventDefault();
        void open(new File([f], f.name || `pasted.${f.type.split('/')[1] ?? 'png'}`, { type: f.type }));
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [open]);

  // Stage size
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const pad = 24;
      setStageBox({ width: Math.max(0, entry.contentRect.width - pad), height: Math.max(0, entry.contentRect.height - pad) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [decoded]);

  // Draw the preview
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !oriented || !state || scale <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(osize.width * scale));
    const h = Math.max(1, Math.round(osize.height * scale));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const filter = compare ? '' : filterString(state.adjust);
    if ('filter' in ctx) ctx.filter = filter || 'none';
    ctx.drawImage(oriented, 0, 0, canvas.width, canvas.height);
    if ('filter' in ctx) ctx.filter = 'none';
  }, [oriented, state?.adjust, scale, osize, compare]);

  // Estimate the exported size (debounced; skipped while dragging)
  useEffect(() => {
    if (!oriented || !state || dragging) return;
    const id = ++estimateSeq.current;
    const t = setTimeout(async () => {
      try {
        const canvas = renderOutput(oriented, state, exportOpts.type === 'image/jpeg' ? exportOpts.background : null);
        const { blob, type } = await encode(canvas, exportOpts);
        if (id === estimateSeq.current) setEstimate({ bytes: blob.size, type });
      } catch {
        if (id === estimateSeq.current) setEstimate(null);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [oriented, state, exportOpts, dragging]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(exportOpts));
    } catch {}
  }, [exportOpts]);

  // Keyboard shortcuts
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      const inField = (e.target as HTMLElement).matches?.('input, select, textarea');
      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        redo();
      } else if (meta && e.key === 's') {
        e.preventDefault();
        void download();
      } else if (e.key === 'Escape' && full) setFull(false);
      else if (!inField && (e.key === 'r' || e.key === 'R') && state && source) {
        commit((s) => rotateState(s, source, e.shiftKey ? 'ccw' : 'cw'));
      } else if (!inField && e.key.startsWith('Arrow') && state) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        commit((s) => withCrop(s, clampRect({ ...s.crop, x: s.crop.x + dx, y: s.crop.y + dy }, osize)));
      }
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

  useEffect(() => () => releaseSource(decoded?.source ?? null), [decoded]);

  // ---------------------------------------------------------------- crop interaction

  const aspectRatio = useMemo(() => {
    const a = ASPECTS.find((x) => x.id === aspectId);
    if (!a || a.ratio === null) return null;
    if (a.ratio === -1) return osize.height ? osize.width / osize.height : null;
    return a.ratio;
  }, [aspectId, osize]);

  const chooseAspect = (id: string) => {
    setAspectId(id);
    const a = ASPECTS.find((x) => x.id === id);
    if (!a || !state) return;
    const ratio = a.ratio === -1 ? osize.width / osize.height : a.ratio;
    commit((s) => withCrop(s, centeredCrop(osize, ratio)));
  };

  const onHandleDown = (handle: HandleId) => (e: PointerEvent) => {
    if (!state) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const start = state.crop;
    const x0 = e.clientX;
    const y0 = e.clientY;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale;
      const dy = (ev.clientY - y0) / scale;
      live((s) => withCrop(s, dragRect(start, handle, dx, dy, osize, aspectRatio)));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDragging(false);
      endLive();
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  /** Drawing a new crop box on the empty area of the preview. */
  const onStageDown = (e: PointerEvent) => {
    if (!state || !previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / scale;
    const py = (e.clientY - rect.top) / scale;
    if (px < 0 || py < 0 || px > osize.width || py > osize.height) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    // A 1 px box at the pointer; dragging grows it from whichever corner the pointer leaves.
    const base: Rect = { x: px, y: py, width: 1, height: 1 };
    setDragging(true);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - e.clientX) / scale;
      const dy = (ev.clientY - e.clientY) / scale;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
      moved = true;
      const handle: HandleId = dx >= 0 ? (dy >= 0 ? 'se' : 'ne') : dy >= 0 ? 'sw' : 'nw';
      live((s) => withCrop(s, dragRect(base, handle, dx, dy, osize, aspectRatio)));
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      setDragging(false);
      if (moved) endLive();
      else dragBase.current = null;
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const setCropField = (key: keyof Rect, raw: string) => {
    if (!state) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    commit((s) => withCrop(s, clampRect({ ...s.crop, [key]: n }, osize)));
  };

  // ---------------------------------------------------------------- resize

  const setResize = (changed: 'width' | 'height', raw: string) => {
    if (!state) return;
    const n = parseDimension(raw, changed === 'width' ? state.resize.width : state.resize.height);
    commit((s) => {
      const next = { ...s.resize, [changed]: n };
      const ratio = s.crop.width / s.crop.height;
      return { ...s, resize: lockAspect ? matchAspect(next, ratio, changed) : next };
    });
  };
  const applyPercent = (pct: number) => commit((s) => ({ ...s, resize: scaleByPercent(s.crop, pct) }));
  const applyPreset = (id: string) => {
    const p = SIZE_PRESETS.find((x) => x.id === id);
    if (!p || !state) return;
    setAspectId('free');
    commit((s) => ({ ...withCrop(s, centeredCrop(osize, p.width / p.height)), resize: { width: p.width, height: p.height } }));
  };

  // ---------------------------------------------------------------- export

  const render = () => {
    if (!oriented || !state) throw new ImageError('Open an image first.');
    return renderOutput(oriented, state, exportOpts.type === 'image/jpeg' ? exportOpts.background : null);
  };

  const download = async () => {
    if (!oriented || !state || !file) return;
    setBusy('Encoding');
    try {
      const { blob, type } = await encode(render(), exportOpts);
      const name = `${(fileName.trim() || baseName(file.name)).replace(/\.[a-z0-9]+$/i, '')}.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`;
      downloadBlob(blob, name);
      toast(`Saved ${name} (${formatBytes(blob.size)})`);
      track('tool_action', { tool: TOOL, action: 'download', type, bytes: blob.size });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Export failed', 'error');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!oriented || !state) return;
    const ok = await copyCanvas(render());
    toast(ok ? 'Image copied as PNG' : 'This browser blocks image clipboard writes', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy' });
  };

  const useAsNew = async () => {
    if (!oriented || !state || !file) return;
    setBusy('Applying');
    try {
      const { blob, type } = await encode(render(), { ...exportOpts, type: 'image/png', quality: 100 });
      await open(new File([blob], `${baseName(file.name)}.png`, { type }));
      toast('Edits applied. You can keep editing from here.');
    } finally {
      setBusy(null);
    }
  };

  // ---------------------------------------------------------------- render

  const lossy = OUTPUT_TYPES.find((t) => t.type === exportOpts.type)?.lossy ?? false;
  const pxRect = (r: Rect) => ({ left: r.x * scale, top: r.y * scale, width: r.width * scale, height: r.height * scale });
  const cropPx = state ? pxRect(state.crop) : null;
  const previewW = Math.round(osize.width * scale);
  const previewH = Math.round(osize.height * scale);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      class={
        'flex flex-col bg-surface-2 text-ink outline-none ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(82vh,900px)] min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
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
        <button type="button" class="btn-ghost btn-sm" onClick={() => void openSample()} title="Load a sample image">
          <Icon name="sparkles" size={14} /> Sample
        </button>
        <span class="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <ToolButton icon="rotate-ccw" title="Rotate left (Shift+R)" disabled={!state} onClick={() => source && commit((s) => rotateState(s, source, 'ccw'))} />
        <ToolButton icon="rotate-cw" title="Rotate right (R)" disabled={!state} onClick={() => source && commit((s) => rotateState(s, source, 'cw'))} />
        <ToolButton icon="flip-horizontal" title="Flip horizontally" disabled={!state} active={state?.flipH} onClick={() => source && commit((s) => flipState(s, source, 'h'))} />
        <ToolButton icon="flip-vertical" title="Flip vertically" disabled={!state} active={state?.flipV} onClick={() => source && commit((s) => flipState(s, source, 'v'))} />
        <span class="mx-1 hidden h-5 w-px bg-line-strong sm:block" />
        <ToolButton icon="undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
        <ToolButton icon="redo" title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo} />
        <button type="button" class="btn-ghost btn-sm" disabled={!state || !source || isIdentity(state, source)} onClick={reset} title="Discard every edit">
          <Icon name="eraser" size={14} /> Reset
        </button>
        <span class="flex-1" />
        <button
          type="button"
          class={'btn-sm ' + (compare ? 'btn-primary' : 'btn-secondary')}
          disabled={!state || !source || isIdentity(state, source)}
          title="Hold to see the original adjustments"
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
          onKeyDown={(e) => e.key === ' ' && setCompare(true)}
          onKeyUp={() => setCompare(false)}
        >
          <Icon name="eye" size={14} /> Compare
        </button>
        <button type="button" class="btn-primary btn-sm" disabled={!state || !!busy} onClick={() => void download()} title="Download (Ctrl+S)">
          <Icon name="download" size={14} /> Download
        </button>
        <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>

      {/* Body */}
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Stage */}
        <section
          ref={stageRef}
          class="relative flex min-h-[280px] min-w-0 items-center justify-center overflow-hidden rounded-lg border border-line-strong bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] bg-surface [background-size:14px_14px]"
          aria-label="Preview"
        >
          {!decoded ? (
            <div class="flex flex-col items-center gap-3 p-6 text-center">
              <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                <Icon name="image" size={26} />
              </span>
              <p class="text-sm font-medium">Drop an image here, paste one, or</p>
              <div class="flex gap-2">
                <button type="button" class="btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
                  <Icon name="folder-open" size={14} /> Open image
                </button>
                <button type="button" class="btn-secondary btn-sm" onClick={() => void openSample()}>
                  Try a sample
                </button>
              </div>
              <p class="text-xs text-ink-3">PNG, JPG, WebP, GIF, BMP or AVIF up to {formatBytes(50 * 1024 * 1024)}. Nothing is uploaded.</p>
            </div>
          ) : (
            <div class="relative select-none touch-none" style={{ width: `${previewW}px`, height: `${previewH}px` }} onPointerDown={onStageDown}>
              <canvas ref={previewRef} class="block" />
              {state && cropPx && !compare && (
                <>
                  {/* dim outside crop */}
                  <div class="pointer-events-none absolute inset-0" style={{ boxShadow: `inset 0 0 0 9999px rgba(0,0,0,0.45)`, clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${cropPx.left}px ${cropPx.top}px, ${cropPx.left}px ${cropPx.top + cropPx.height}px, ${cropPx.left + cropPx.width}px ${cropPx.top + cropPx.height}px, ${cropPx.left + cropPx.width}px ${cropPx.top}px, ${cropPx.left}px ${cropPx.top}px)` }} />
                  {/* crop box */}
                  <div
                    class="absolute cursor-move border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                    style={{ left: `${cropPx.left}px`, top: `${cropPx.top}px`, width: `${cropPx.width}px`, height: `${cropPx.height}px` }}
                    onPointerDown={onHandleDown('move')}
                    role="group"
                    aria-label="Crop area"
                  >
                    <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-60 [&>div]:border-white/50">
                      <div class="border-r border-b" /><div class="border-r border-b" /><div class="border-b" />
                      <div class="border-r border-b" /><div class="border-r border-b" /><div class="border-b" />
                      <div class="border-r" /><div class="border-r" /><div />
                    </div>
                    {HANDLES.map((h) => (
                      <div key={h} class={'absolute h-3.5 w-3.5 rounded-sm border border-black/40 bg-white ' + handleClass(h)} style={handleStyle(h)} onPointerDown={onHandleDown(h)} aria-hidden="true" />
                    ))}
                    <span class="absolute -top-6 left-0 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] text-white">
                      {formatDimensions(state.crop)}
                    </span>
                  </div>
                </>
              )}
              {compare && <span class="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">Original</span>}
            </div>
          )}
          {busy && (
            <div class="absolute inset-0 flex items-center justify-center bg-surface/70 text-sm text-ink-2">
              <Icon name="loader" size={16} class="mr-2 animate-spin" /> {busy}
            </div>
          )}
        </section>

        {/* Sidebar */}
        <aside class="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Edit panels">
          <div class="flex shrink-0 border-b border-line text-xs font-medium" role="tablist">
            {(['crop', 'resize', 'adjust', 'export'] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                class={'flex-1 py-2 capitalize transition-colors ' + (tab === t ? 'border-b-2 border-brand-600 text-brand-700 dark:text-brand-300' : 'text-ink-2 hover:text-ink')}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div class={'scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3 text-sm ' + (!state ? 'pointer-events-none opacity-50' : '')}>
            {tab === 'crop' && (
              <div class="space-y-3">
                <Field label="Aspect ratio">
                  <div class="flex flex-wrap gap-1">
                    {ASPECTS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        class={'rounded-md border px-2 py-1 text-xs ' + (aspectId === a.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong text-ink-2 hover:bg-surface-3')}
                        onClick={() => chooseAspect(a.id)}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <div class="grid grid-cols-2 gap-2">
                  <Num label="X" value={state?.crop.x ?? 0} onCommit={(v) => setCropField('x', v)} />
                  <Num label="Y" value={state?.crop.y ?? 0} onCommit={(v) => setCropField('y', v)} />
                  <Num label="Width" value={state?.crop.width ?? 0} onCommit={(v) => setCropField('width', v)} />
                  <Num label="Height" value={state?.crop.height ?? 0} onCommit={(v) => setCropField('height', v)} />
                </div>
                <div class="flex gap-2">
                  <button type="button" class="btn-secondary btn-sm flex-1" onClick={() => chooseAspect('free')} disabled={!state}>
                    Select all
                  </button>
                  <button type="button" class="btn-secondary btn-sm flex-1" onClick={() => void useAsNew()} disabled={!state || !source || isIdentity(state, source)} title="Bake the crop and edits into a new image">
                    Apply
                  </button>
                </div>
                <p class="text-xs leading-5 text-ink-3">Drag the box or its handles on the preview, or draw a new box. Arrow keys nudge it by 1 px (Shift for 10 px).</p>
              </div>
            )}

            {tab === 'resize' && state && (
              <div class="space-y-3">
                <div class="grid grid-cols-2 gap-2">
                  <Num label="Width" value={state.resize.width} onCommit={(v) => setResize('width', v)} />
                  <Num label="Height" value={state.resize.height} onCommit={(v) => setResize('height', v)} />
                </div>
                <Chip on={lockAspect} onClick={() => setLockAspect((v) => !v)} title="Keep width and height in proportion">
                  Lock aspect ratio
                </Chip>
                <Field label="Scale">
                  <div class="flex gap-1">
                    {[25, 50, 75, 100, 200].map((p) => (
                      <button key={p} type="button" class="btn-secondary btn-sm flex-1 px-0 text-xs" onClick={() => applyPercent(p)}>
                        {p}%
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Preset (crops to the preset's ratio)">
                  <select class="select h-8 text-[13px]" value="" onChange={(e) => applyPreset((e.currentTarget as HTMLSelectElement).value)} aria-label="Size preset">
                    <option value="" disabled>
                      Choose a size…
                    </option>
                    {SIZE_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <p class="text-xs leading-5 text-ink-3">
                  Crop area {formatDimensions(state.crop)} → output {formatDimensions(state.resize)}
                  {state.resize.width > state.crop.width && ' (upscaled, expect softness)'}.
                </p>
              </div>
            )}

            {tab === 'adjust' && state && (
              <div class="space-y-3">
                {!filtersOk && <p class="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-ink-2">This browser cannot apply adjustments on a canvas. Crop, resize and rotate still work.</p>}
                {(Object.keys(ADJUSTMENT_RANGES) as (keyof Adjustments)[]).map((k) => {
                  const r = ADJUSTMENT_RANGES[k];
                  return (
                    <label key={k} class="block">
                      <span class="flex items-center justify-between text-xs text-ink-2">
                        <span>{r.label}</span>
                        <span class="font-mono tabular-nums">
                          {state.adjust[k]}
                          {r.unit}
                        </span>
                      </span>
                      <input
                        type="range"
                        class="mt-1 w-full accent-brand-600"
                        min={r.min}
                        max={r.max}
                        step={r.step}
                        value={state.adjust[k]}
                        disabled={!filtersOk}
                        onInput={(e) => {
                          const v = Number((e.currentTarget as HTMLInputElement).value);
                          live((s) => ({ ...s, adjust: { ...s.adjust, [k]: v } }));
                        }}
                        onChange={endLive}
                        onDblClick={() => commit((s) => ({ ...s, adjust: { ...s.adjust, [k]: DEFAULT_ADJUST[k] } }))}
                        aria-label={r.label}
                      />
                    </label>
                  );
                })}
                <div class="flex gap-2">
                  <button type="button" class="btn-secondary btn-sm flex-1" onClick={() => commit((s) => ({ ...s, adjust: { ...DEFAULT_ADJUST } }))}>
                    Reset adjustments
                  </button>
                  <button type="button" class="btn-secondary btn-sm flex-1" onClick={() => commit((s) => ({ ...s, adjust: { ...DEFAULT_ADJUST, grayscale: 100, contrast: 110 } }))}>
                    B&amp;W
                  </button>
                </div>
                <p class="text-xs leading-5 text-ink-3">Double-click a slider to reset it. Hold Compare in the toolbar to see the unadjusted image.</p>
              </div>
            )}

            {tab === 'export' && state && (
              <div class="space-y-3">
                <Field label="Format">
                  <Segmented value={exportOpts.type} onChange={(type) => setExportOpts((o) => ({ ...o, type }))} options={OUTPUT_TYPES.map((t) => ({ value: t.type, label: t.label, disabled: !canEncode(t.type) }))} label="Output format" />
                </Field>
                {lossy && (
                  <label class="block">
                    <span class="flex items-center justify-between text-xs text-ink-2">
                      <span>Quality</span>
                      <span class="font-mono tabular-nums">{exportOpts.quality}</span>
                    </span>
                    <input type="range" class="mt-1 w-full accent-brand-600" min={1} max={100} value={exportOpts.quality} onInput={(e) => setExportOpts((o) => ({ ...o, quality: Number((e.currentTarget as HTMLInputElement).value) }))} aria-label="Quality" />
                  </label>
                )}
                {exportOpts.type === 'image/jpeg' && (
                  <Field label="Background for transparent areas">
                    <div class="flex items-center gap-2">
                      <input type="color" class="h-8 w-10 cursor-pointer rounded border border-line-strong bg-surface p-0.5" value={exportOpts.background} onInput={(e) => setExportOpts((o) => ({ ...o, background: normalizeHex((e.currentTarget as HTMLInputElement).value, o.background) }))} aria-label="Background colour" />
                      <input class="input h-8 flex-1 font-mono text-xs" value={exportOpts.background} onChange={(e) => setExportOpts((o) => ({ ...o, background: normalizeHex((e.currentTarget as HTMLInputElement).value, o.background) }))} aria-label="Background colour hex" />
                    </div>
                  </Field>
                )}
                <Field label="File name">
                  <div class="flex items-center gap-1">
                    <input class="input h-8 flex-1 text-xs" value={fileName} onInput={(e) => setFileName((e.currentTarget as HTMLInputElement).value)} aria-label="File name" />
                    <span class="text-xs text-ink-3">.{exportOpts.type === 'image/jpeg' ? 'jpg' : exportOpts.type.split('/')[1]}</span>
                  </div>
                </Field>
                <div class="rounded-md border border-line bg-surface-2 p-2.5 text-xs text-ink-2">
                  <div class="flex justify-between">
                    <span>Output</span>
                    <span class="font-mono">{formatDimensions(state.resize)}</span>
                  </div>
                  <div class="mt-1 flex justify-between">
                    <span>Estimated size</span>
                    <span class="font-mono">{estimate ? formatBytes(estimate.bytes) : '…'}</span>
                  </div>
                  {file && estimate && (
                    <div class="mt-1 flex justify-between">
                      <span>Original</span>
                      <span class="font-mono">
                        {formatBytes(file.size)}
                        {estimate.bytes < file.size && <span class="ml-1 text-success">(−{Math.round((1 - estimate.bytes / file.size) * 100)}%)</span>}
                      </span>
                    </div>
                  )}
                </div>
                <div class="flex gap-2">
                  <button type="button" class="btn-primary btn-sm flex-1" onClick={() => void download()} disabled={!!busy}>
                    <Icon name="download" size={14} /> Download
                  </button>
                  <button type="button" class="btn-secondary btn-sm" onClick={() => void copy()} title="Copy as PNG to the clipboard">
                    <Icon name="copy" size={14} /> Copy
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">
          {decoded && file && source && state ? (
            <>
              <span class="text-ink-2">{file.name}</span> · {formatDimensions(source)} · {formatBytes(file.size)} · {describeState(state, source)}
            </>
          ) : (
            'Your image stays in this browser tab. Nothing is uploaded.'
          )}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          {decoded && <span>Zoom {Math.round(scale * 100)}%</span>}
          <span class="kbd">R</span> rotate
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bits

function ToolButton(p: { icon: string; title: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return <HeaderButton icon={p.icon} title={p.title} onClick={p.onClick} disabled={p.disabled} active={p.active} />;
}

function Field(p: { label: string; children: ComponentChildren }) {
  return (
    <div>
      <div class="mb-1 text-xs text-ink-2">{p.label}</div>
      {p.children}
    </div>
  );
}

/** Numeric input that commits on blur or Enter, so typing does not spam history. */
function Num(p: { label: string; value: number; onCommit: (raw: string) => void }) {
  const [draft, setDraft] = useState(String(p.value));
  useEffect(() => setDraft(String(p.value)), [p.value]);
  return (
    <label class="block">
      <span class="text-xs text-ink-2">{p.label}</span>
      <input
        type="number"
        class="input mt-0.5 h-8 font-mono text-xs"
        value={draft}
        min={0}
        onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        onBlur={() => draft !== String(p.value) && p.onCommit(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            p.onCommit(draft);
          }
        }}
        aria-label={p.label}
      />
    </label>
  );
}

function handleClass(h: HandleId): string {
  const cursors: Record<string, string> = { n: 'cursor-ns-resize', s: 'cursor-ns-resize', e: 'cursor-ew-resize', w: 'cursor-ew-resize', ne: 'cursor-nesw-resize', sw: 'cursor-nesw-resize', nw: 'cursor-nwse-resize', se: 'cursor-nwse-resize' };
  return cursors[h] ?? '';
}

function handleStyle(h: HandleId): Record<string, string> {
  const s: Record<string, string> = {};
  if (h.includes('n')) s.top = '-7px';
  if (h.includes('s')) s.bottom = '-7px';
  if (h.includes('w')) s.left = '-7px';
  if (h.includes('e')) s.right = '-7px';
  if (h === 'n' || h === 's') s.left = 'calc(50% - 7px)';
  if (h === 'e' || h === 'w') s.top = 'calc(50% - 7px)';
  return s;
}
