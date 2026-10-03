/**
 * Text Diff Checker: two editors on top, the comparison underneath. Side-by-side or
 * inline view, line / word / character granularity, ignore-case and ignore-whitespace,
 * collapsed unchanged regions, change navigation and unified-diff export.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, formatBytes, toast, track } from '../shared/toast';
import {
  MAX_RENDERED_ROWS,
  SAMPLE_CHANGED,
  SAMPLE_ORIGINAL,
  TextDiffError,
  computeDiff,
  toInlineRows,
  toUnifiedDiff,
  type DiffOptions,
  type DiffResult,
  type DiffRow,
  type DiffSegment,
  type Granularity,
  type InlineRow,
} from './logic';

type View = 'split' | 'inline';

interface Prefs {
  granularity: Granularity;
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
  view: View;
  onlyChanges: boolean;
  wrap: boolean;
}

const PREFS_KEY = 'cuis-diff:prefs';
const DRAFT_KEY = 'cuis-diff:draft';
const MAX_DRAFT = 150 * 1024;
const MAX_FILE = 5 * 1024 * 1024;
const CONTEXT = 3;
const TOOL = 'text-diff-checker';

const DEFAULT_PREFS: Prefs = { granularity: 'words', ignoreCase: false, ignoreWhitespace: false, view: 'split', onlyChanges: false, wrap: true };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
    const p = { ...DEFAULT_PREFS };
    if (raw.granularity === 'lines' || raw.granularity === 'words' || raw.granularity === 'chars') p.granularity = raw.granularity;
    if (typeof raw.ignoreCase === 'boolean') p.ignoreCase = raw.ignoreCase;
    if (typeof raw.ignoreWhitespace === 'boolean') p.ignoreWhitespace = raw.ignoreWhitespace;
    if (raw.view === 'split' || raw.view === 'inline') p.view = raw.view;
    if (typeof raw.onlyChanges === 'boolean') p.onlyChanges = raw.onlyChanges;
    if (typeof raw.wrap === 'boolean') p.wrap = raw.wrap;
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadDraft(): [string, string] {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as unknown;
    if (Array.isArray(raw) && typeof raw[0] === 'string' && typeof raw[1] === 'string') return [raw[0], raw[1]];
  } catch {}
  return ['', ''];
}

/** A row of the rendered list: a diff row, or a collapsed run of unchanged rows. */
type Display<T> = { kind: 'row'; row: T; index: number } | { kind: 'collapsed'; from: number; to: number; count: number };

function collapse<T extends { kind: string }>(rows: readonly T[], enabled: boolean, expanded: ReadonlySet<number>): Display<T>[] {
  if (!enabled) return rows.map((row, index) => ({ kind: 'row', row, index }));
  const out: Display<T>[] = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i]?.kind !== 'equal') {
      out.push({ kind: 'row', row: rows[i] as T, index: i });
      i++;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j]?.kind === 'equal') j++;
    const runStart = i;
    const runEnd = j; // exclusive
    const keepHead = runStart === 0 ? 0 : CONTEXT;
    const keepTail = runEnd === rows.length ? 0 : CONTEXT;
    const hiddenFrom = runStart + keepHead;
    const hiddenTo = runEnd - keepTail;
    if (hiddenTo - hiddenFrom < 2 || expanded.has(hiddenFrom)) {
      for (let k = runStart; k < runEnd; k++) out.push({ kind: 'row', row: rows[k] as T, index: k });
    } else {
      for (let k = runStart; k < hiddenFrom; k++) out.push({ kind: 'row', row: rows[k] as T, index: k });
      out.push({ kind: 'collapsed', from: hiddenFrom, to: hiddenTo, count: hiddenTo - hiddenFrom });
      for (let k = hiddenTo; k < runEnd; k++) out.push({ kind: 'row', row: rows[k] as T, index: k });
    }
    i = j;
  }
  return out;
}

export default function TextDiff() {
  const rootRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileTarget = useRef<'original' | 'changed'>('original');
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === 'undefined' ? DEFAULT_PREFS : loadPrefs()));
  const [[original, changed], setTexts] = useState<[string, string]>(() => (typeof window === 'undefined' ? ['', ''] : loadDraft()));
  const [result, setResult] = useState<DiffResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(MAX_RENDERED_ROWS);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [current, setCurrent] = useState(-1);
  const [full, setFull] = useState(false);

  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  const setOriginal = (v: string) => setTexts(([, c]) => [v, c]);
  const setChanged = (v: string) => setTexts(([o]) => [o, v]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (original.length + changed.length <= MAX_DRAFT) localStorage.setItem(DRAFT_KEY, JSON.stringify([original, changed]));
        else localStorage.removeItem(DRAFT_KEY);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [original, changed]);

  const options: DiffOptions = useMemo(
    () => ({ granularity: prefs.granularity, ignoreCase: prefs.ignoreCase, ignoreWhitespace: prefs.ignoreWhitespace }),
    [prefs.granularity, prefs.ignoreCase, prefs.ignoreWhitespace],
  );

  // Compute the diff, debounced
  useEffect(() => {
    const t = setTimeout(() => {
      if (!original && !changed) {
        setResult(null);
        setError(null);
        return;
      }
      try {
        setResult(computeDiff(original, changed, options));
        setError(null);
      } catch (err) {
        setResult(null);
        setError(err instanceof TextDiffError ? err.message : 'The texts could not be compared.');
      }
      setLimit(MAX_RENDERED_ROWS);
      setExpanded(new Set());
      setCurrent(-1);
    }, 150);
    return () => clearTimeout(t);
  }, [original, changed, options]);

  const inlineRows = useMemo(() => (result && prefs.view === 'inline' ? toInlineRows(result.ops, options) : []), [result, prefs.view, options]);

  const display = useMemo(() => {
    if (!result) return [] as Display<DiffRow | InlineRow>[];
    const rows: readonly (DiffRow | InlineRow)[] = prefs.view === 'inline' ? inlineRows : result.rows;
    return collapse(rows, prefs.onlyChanges, expanded);
  }, [result, inlineRows, prefs.view, prefs.onlyChanges, expanded]);

  const totalRows = prefs.view === 'inline' ? inlineRows.length : (result?.rows.length ?? 0);

  /** Row indexes where a block of changes starts, for Prev / Next. */
  const changeStarts = useMemo(() => {
    const rows: readonly { kind: string }[] = prefs.view === 'inline' ? inlineRows : (result?.rows ?? []);
    const starts: number[] = [];
    rows.forEach((r, i) => {
      if (r.kind !== 'equal' && (i === 0 || rows[i - 1]?.kind === 'equal')) starts.push(i);
    });
    return starts;
  }, [result, inlineRows, prefs.view]);

  const goTo = useCallback(
    (which: number) => {
      if (changeStarts.length === 0) return;
      const next = ((which % changeStarts.length) + changeStarts.length) % changeStarts.length;
      setCurrent(next);
      const rowIndex = changeStarts[next] as number;
      requestAnimationFrame(() => {
        const el = resultRef.current?.querySelector<HTMLElement>(`[data-row="${rowIndex}"]`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    },
    [changeStarts],
  );

  // Keyboard
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape' && full) setFull(false);
      else if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copyPatch();
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        goTo(current + 1);
      } else if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        goTo(current - 1);
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

  // ------------------------------------------------------------------ actions

  const patch = () => toUnifiedDiff(original, changed, { ...options, oldName: 'original.txt', newName: 'changed.txt', context: CONTEXT });

  const copyPatch = async () => {
    if (!result) return;
    const text = patch();
    if (!text) {
      toast('The texts are identical, nothing to copy');
      return;
    }
    const ok = await copyText(text);
    toast(ok ? 'Unified diff copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy' });
  };

  const download = () => {
    if (!result) return;
    const text = patch();
    if (!text) {
      toast('The texts are identical, nothing to download');
      return;
    }
    downloadText(text, 'changes.diff', 'text/x-diff');
    track('tool_action', { tool: TOOL, action: 'download' });
  };

  const swap = () => {
    setTexts(([o, c]) => [c, o]);
    track('tool_action', { tool: TOOL, action: 'swap' });
  };

  const loadSample = () => {
    setTexts([SAMPLE_ORIGINAL, SAMPLE_CHANGED]);
    track('tool_action', { tool: TOOL, action: 'sample' });
  };

  const clearAll = () => setTexts(['', '']);

  const openFile = async (file: File, side: 'original' | 'changed') => {
    if (file.size > MAX_FILE) {
      toast(`File is larger than ${formatBytes(MAX_FILE)}`, 'error');
      return;
    }
    const text = await file.text();
    if (side === 'original') setOriginal(text);
    else setChanged(text);
    toast(`Opened ${file.name}`);
    track('tool_action', { tool: TOOL, action: 'open_file' });
  };

  const stats = result?.stats;
  const shown = display.slice(0, limit);
  const hiddenCount = Math.max(0, display.length - limit);

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(86vh,980px)] min-h-[640px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="text/*,.txt,.md,.json,.js,.ts,.css,.html,.xml,.yml,.yaml,.csv,.sql,.log,.diff,.patch"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void openFile(f, fileTarget.current);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">Compare by</span>
          <select
            class="select h-8 w-auto text-[13px]"
            value={prefs.granularity}
            onChange={(e) => update({ granularity: (e.currentTarget as HTMLSelectElement).value as Granularity })}
            aria-label="Compare by"
          >
            <option value="lines">Lines</option>
            <option value="words">Words</option>
            <option value="chars">Characters</option>
          </select>
        </label>

        <div class="flex items-center gap-1.5" role="group" aria-label="Comparison options">
          <Chip on={prefs.ignoreCase} onClick={() => update({ ignoreCase: !prefs.ignoreCase })} title="Treat Value and value as the same">
            Ignore case
          </Chip>
          <Chip on={prefs.ignoreWhitespace} onClick={() => update({ ignoreWhitespace: !prefs.ignoreWhitespace })} title="Ignore indentation and spacing changes">
            Ignore whitespace
          </Chip>
        </div>

        <Segmented
          value={prefs.view}
          onChange={(view) => update({ view })}
          options={[
            { value: 'split', label: 'Side by side', icon: 'columns' },
            { value: 'inline', label: 'Inline', icon: 'rows' },
          ]}
        />

        <Chip on={prefs.onlyChanges} onClick={() => update({ onlyChanges: !prefs.onlyChanges })} title={`Hide unchanged lines, keeping ${CONTEXT} lines of context`}>
          Only changes
        </Chip>

        <span class="flex-1" />

        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={swap} disabled={!original && !changed} title="Swap original and changed">
            <Icon name="arrow-left-right" size={14} /> Swap
          </button>
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={clearAll} disabled={!original && !changed} title="Clear both texts">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button
            type="button"
            class="btn-ghost btn-sm btn-icon h-8 w-8"
            onClick={() => setFull((f) => !f)}
            title={full ? 'Exit full screen (Esc)' : 'Full screen'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}
          >
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Inputs */}
      <div class={'grid shrink-0 gap-2 md:grid-cols-2 ' + (full ? 'h-[34%]' : 'h-[300px]')}>
        <InputPane
          label="Original"
          value={original}
          onChange={setOriginal}
          wrap={prefs.wrap}
          placeholder="Paste the original text here"
          onOpen={() => {
            fileTarget.current = 'original';
            fileRef.current?.click();
          }}
          onDrop={(f) => void openFile(f, 'original')}
          onClear={() => setOriginal('')}
        />
        <InputPane
          label="Changed"
          value={changed}
          onChange={setChanged}
          wrap={prefs.wrap}
          placeholder="Paste the changed text here"
          onOpen={() => {
            fileTarget.current = 'changed';
            fileRef.current?.click();
          }}
          onDrop={(f) => void openFile(f, 'changed')}
          onClear={() => setChanged('')}
        />
      </div>

      {/* Result */}
      <section class="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Differences">
        <header class="flex h-9 shrink-0 flex-wrap items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
          <span class="font-semibold text-ink">Differences</span>
          {stats && (
            <span class="ml-2 flex items-center gap-2">
              <span class="badge border-success/40 bg-success/10 text-success">+{stats.additions.toLocaleString('en-US')}</span>
              <span class="badge border-danger/40 bg-danger/10 text-danger">−{stats.deletions.toLocaleString('en-US')}</span>
              <span class="hidden text-ink-3 sm:inline">{stats.unchanged.toLocaleString('en-US')} unchanged</span>
              {result?.identical && (
                <span class="badge border-line-strong text-ink-2">
                  <Icon name="check" size={11} class="mr-1 text-success" /> Identical
                </span>
              )}
              {result?.approximate && (
                <span class="text-warning" title="The texts are too different to align line by line, so every line is shown as replaced.">
                  Approximate
                </span>
              )}
            </span>
          )}
          <span class="flex-1" />
          {changeStarts.length > 0 && (
            <span class="mr-1 flex items-center gap-0.5 text-ink-3">
              <HeaderButton icon="arrow-up" title="Previous change (Alt+Up)" onClick={() => goTo(current - 1)} />
              <span class="min-w-[3.5rem] text-center tabular-nums">
                {current < 0 ? '–' : current + 1} / {changeStarts.length}
              </span>
              <HeaderButton icon="arrow-down" title="Next change (Alt+Down)" onClick={() => goTo(current + 1)} />
            </span>
          )}
          <HeaderButton icon="wrap-text" title={prefs.wrap ? 'Disable line wrap' : 'Wrap long lines'} active={prefs.wrap} onClick={() => update({ wrap: !prefs.wrap })} />
          <HeaderButton icon="download" title="Download changes.diff" onClick={download} disabled={!result || result.identical} />
          <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copyPatch()} disabled={!result || result.identical} title="Copy unified diff (Ctrl+Shift+C)">
            <Icon name="copy" size={13} /> Copy diff
          </button>
        </header>

        <div ref={resultRef} class="scrollbar-thin min-h-0 flex-1 overflow-auto font-mono text-[12.5px] leading-[1.6]">
          {error ? (
            <p class="flex items-center gap-2 p-4 text-sm text-danger">
              <Icon name="alert-circle" size={15} /> {error}
            </p>
          ) : !result ? (
            <div class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center font-sans text-sm text-ink-3">
              <Icon name="git-compare" size={28} class="text-ink-3/60" />
              <p>Paste two texts above and the differences appear here.</p>
              <button type="button" class="btn-secondary btn-sm mt-1" onClick={loadSample}>
                Try the sample
              </button>
            </div>
          ) : result.identical && !prefs.onlyChanges ? (
            <div class="sticky top-0 z-10 border-b border-line bg-success/10 px-3 py-1.5 font-sans text-xs text-ink-2">The two texts are identical with the current options.</div>
          ) : null}

          {result && !error && (prefs.view === 'split' ? (
            <div class="grid min-w-full grid-cols-[2.75rem_minmax(0,1fr)_2.75rem_minmax(0,1fr)]">
              {shown.map((d) =>
                d.kind === 'collapsed' ? (
                  <CollapsedRow key={`c${d.from}`} count={d.count} span={4} onClick={() => setExpanded((e) => new Set(e).add(d.from))} />
                ) : (
                  <SplitRow key={d.index} row={d.row as DiffRow} index={d.index} wrap={prefs.wrap} active={current >= 0 && changeStarts[current] === d.index} />
                ),
              )}
            </div>
          ) : (
            <div class="grid min-w-full grid-cols-[2.75rem_2.75rem_1.25rem_minmax(0,1fr)]">
              {shown.map((d) =>
                d.kind === 'collapsed' ? (
                  <CollapsedRow key={`c${d.from}`} count={d.count} span={4} onClick={() => setExpanded((e) => new Set(e).add(d.from))} />
                ) : (
                  <InlineRowView key={d.index} row={d.row as InlineRow} index={d.index} wrap={prefs.wrap} active={current >= 0 && changeStarts[current] === d.index} />
                ),
              )}
            </div>
          ))}

          {hiddenCount > 0 && (
            <div class="flex items-center justify-center gap-3 border-t border-line p-3 font-sans text-xs text-ink-2">
              Showing {limit.toLocaleString('en-US')} of {totalRows.toLocaleString('en-US')} rows. Copy and Download always include the whole diff.
              <button type="button" class="btn-secondary btn-sm" onClick={() => setLimit((l) => l + MAX_RENDERED_ROWS)}>
                Show {Math.min(hiddenCount, MAX_RENDERED_ROWS).toLocaleString('en-US')} more
              </button>
            </div>
          )}
        </div>
      </section>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">
          {result && !error
            ? `Compared by ${prefs.granularity === 'chars' ? 'characters' : prefs.granularity}${prefs.ignoreCase ? ', ignoring case' : ''}${prefs.ignoreWhitespace ? ', ignoring whitespace' : ''}. Nothing leaves your browser.`
            : 'Both texts stay in your browser. Nothing is uploaded.'}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Alt</span>+<span class="kbd">↓</span> next change
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function InputPane(p: { label: string; value: string; onChange: (v: string) => void; wrap: boolean; placeholder: string; onOpen: () => void; onDrop: (f: File) => void; onClear: () => void }) {
  const lines = p.value ? p.value.split('\n').length : 0;
  return (
    <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label={`${p.label} text`}>
      <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
        <span class="font-semibold text-ink">{p.label}</span>
        <span class="ml-2 text-ink-3">
          {lines.toLocaleString('en-US')} {lines === 1 ? 'line' : 'lines'} · {formatBytes(new TextEncoder().encode(p.value).length)}
        </span>
        <span class="flex-1" />
        <HeaderButton icon="folder-open" title={`Open a file as ${p.label.toLowerCase()}`} onClick={p.onOpen} />
        <HeaderButton icon="x" title={`Clear ${p.label.toLowerCase()}`} onClick={p.onClear} disabled={!p.value} />
      </header>
      <CodeEditor value={p.value} onChange={p.onChange} wrap={p.wrap} placeholder={p.placeholder} ariaLabel={`${p.label} text`} class="flex-1" onDropFile={p.onDrop} />
    </section>
  );
}

const ROW_BG: Record<string, string> = {
  equal: '',
  added: 'bg-success/12',
  removed: 'bg-danger/12',
  changed: '',
};

function Segments({ segments, kind }: { segments: DiffSegment[]; kind: 'added' | 'removed' | 'equal' | 'changed' }) {
  return (
    <>
      {segments.map((s) =>
        s.kind === 'equal' ? (
          s.text
        ) : (
          <mark class={'rounded-[2px] text-inherit ' + (s.kind === 'added' ? 'bg-success/45' : 'bg-danger/45')} data-kind={kind}>
            {s.text}
          </mark>
        ),
      )}
    </>
  );
}

function SplitRow({ row, index, wrap, active }: { row: DiffRow; index: number; wrap: boolean; active: boolean }) {
  const textClass = (wrap ? 'whitespace-pre-wrap break-all ' : 'whitespace-pre ') + 'px-2 min-w-0';
  const leftBg = row.kind === 'changed' || row.kind === 'removed' ? 'bg-danger/12' : row.kind === 'added' ? 'bg-surface-3/60' : '';
  const rightBg = row.kind === 'changed' || row.kind === 'added' ? 'bg-success/12' : row.kind === 'removed' ? 'bg-surface-3/60' : '';
  const ring = active ? 'shadow-[inset_3px_0_0_var(--color-brand-500)]' : '';
  return (
    <div class="contents" data-row={index}>
      <div class={'select-none border-r border-line bg-surface-2 pr-2 text-right text-ink-3 ' + ring}>{row.left?.line ?? ''}</div>
      <div class={`${textClass} ${leftBg}`}>{row.left ? <Segments segments={row.left.segments} kind={row.kind} /> : null}{row.left && row.left.text === '' ? '​' : null}</div>
      <div class="select-none border-x border-line bg-surface-2 pr-2 text-right text-ink-3">{row.right?.line ?? ''}</div>
      <div class={`${textClass} ${rightBg}`}>{row.right ? <Segments segments={row.right.segments} kind={row.kind} /> : null}{row.right && row.right.text === '' ? '​' : null}</div>
    </div>
  );
}

function InlineRowView({ row, index, wrap, active }: { row: InlineRow; index: number; wrap: boolean; active: boolean }) {
  const textClass = (wrap ? 'whitespace-pre-wrap break-all ' : 'whitespace-pre ') + 'px-2 min-w-0 ' + ROW_BG[row.kind];
  const ring = active ? 'shadow-[inset_3px_0_0_var(--color-brand-500)]' : '';
  const sign = row.kind === 'added' ? 'text-success' : row.kind === 'removed' ? 'text-danger' : 'text-ink-3';
  return (
    <div class="contents" data-row={index}>
      <div class={'select-none bg-surface-2 pr-2 text-right text-ink-3 ' + ring}>{row.oldLine ?? ''}</div>
      <div class="select-none border-r border-line bg-surface-2 pr-2 text-right text-ink-3">{row.newLine ?? ''}</div>
      <div class={'select-none text-center ' + sign + ' ' + ROW_BG[row.kind]}>{row.sign.trim()}</div>
      <div class={textClass}>
        <Segments segments={row.segments} kind={row.kind} />
        {row.text === '' ? '​' : null}
      </div>
    </div>
  );
}

function CollapsedRow({ count, span, onClick }: { count: number; span: number; onClick: () => void }) {
  return (
    <button
      type="button"
      class="col-span-full flex items-center justify-center gap-2 border-y border-line bg-brand-50/60 py-1 font-sans text-[11px] text-brand-700 hover:bg-brand-100/70 dark:bg-brand-900/20 dark:text-brand-200 dark:hover:bg-brand-900/40"
      style={{ gridColumn: `span ${span}` }}
      onClick={onClick}
      title="Show these lines"
    >
      <Icon name="chevrons-up-down" size={12} /> {count.toLocaleString('en-US')} unchanged {count === 1 ? 'line' : 'lines'} hidden
    </button>
  );
}
