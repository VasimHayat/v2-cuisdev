/**
 * Regex Tester workspace: pattern and flags on top, test text on the left, highlighted
 * matches, a match list and live replacement on the right. Matching runs in a Web
 * Worker with a timeout so catastrophic backtracking never freezes the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import {
  CHEATSHEET,
  FLAG_MEANINGS,
  SAMPLE,
  USER_FLAGS,
  describeMatchCount,
  highlightSegments,
  matchesToText,
  runRegex,
  type RegexFlag,
  type RegexMatch,
  type RegexRequest,
  type RegexResult,
} from './logic';

const TOOL = 'regex-tester';
const DRAFT_KEY = 'cuis-regex:draft';
const WORKER_TIMEOUT = 1500;
const MAX_HIGHLIGHT_CHARS = 200_000;
type View = 'matches' | 'replace';

interface Draft {
  pattern: string;
  flags: string;
  text: string;
  replacement: string;
}

const EMPTY: Draft = { pattern: '', flags: 'g', text: '', replacement: '' };

function loadDraft(): Draft {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<Draft> | null;
    if (!raw || typeof raw !== 'object') return EMPTY;
    const d = { ...EMPTY };
    for (const k of ['pattern', 'flags', 'text', 'replacement'] as const) if (typeof raw[k] === 'string') d[k] = raw[k] as string;
    return d;
  } catch {
    return EMPTY;
  }
}

/** Runs requests in a worker, falling back to the main thread when workers are unavailable. */
class Runner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: RegexResult) => void; timer: ReturnType<typeof setTimeout> }>();

  private spawn(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    try {
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; result: RegexResult }>) => {
        const entry = this.pending.get(e.data.id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(e.data.id);
        entry.resolve(e.data.result);
      };
      w.onerror = () => {
        this.failAll('The matcher crashed. Please try again.');
        this.worker = null;
      };
      return w;
    } catch {
      return null;
    }
  }

  private failAll(error: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error });
    }
    this.pending.clear();
  }

  run(request: RegexRequest): Promise<RegexResult> {
    this.worker ??= this.spawn();
    if (!this.worker) return Promise.resolve(runRegex(request));
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.worker?.terminate();
        this.worker = null;
        this.failAll('This pattern took too long, likely catastrophic backtracking. Simplify nested quantifiers such as (a+)+.');
        resolve({ ok: false, error: 'This pattern took too long, likely catastrophic backtracking. Simplify nested quantifiers such as (a+)+.' });
      }, WORKER_TIMEOUT);
      this.pending.set(id, { resolve, timer });
      this.worker!.postMessage({ id, request });
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.failAll('Closed');
  }
}

export default function RegexTester() {
  const rootRef = useRef<HTMLDivElement>(null);
  const runner = useRef<Runner | null>(null);
  const seq = useRef(0);
  const [draft, setDraft] = useState<Draft>(() => (typeof window === 'undefined' ? EMPTY : loadDraft()));
  const [result, setResult] = useState<RegexResult | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>('matches');
  const [cheat, setCheat] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [full, setFull] = useState(false);
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    runner.current = new Runner();
    return () => runner.current?.dispose();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [draft]);

  // Run the match, debounced
  useEffect(() => {
    const id = ++seq.current;
    if (draft.pattern === '' || draft.text === '') {
      setResult(draft.pattern === '' ? null : { ok: true, matches: [], truncated: false, replaced: draft.text });
      setElapsed(null);
      setBusy(false);
      return;
    }
    const t = setTimeout(async () => {
      setBusy(true);
      const t0 = performance.now();
      const r = await (runner.current ?? new Runner()).run({ pattern: draft.pattern, flags: draft.flags, text: draft.text, replacement: draft.replacement });
      if (id !== seq.current) return;
      setResult(r);
      setElapsed(performance.now() - t0);
      setBusy(false);
    }, 150);
    return () => clearTimeout(t);
  }, [draft.pattern, draft.flags, draft.text, draft.replacement]);

  const matches: RegexMatch[] = result?.ok ? result.matches : [];
  const error = result && !result.ok ? result.error : null;
  const segments = useMemo(() => (draft.text.length <= MAX_HIGHLIGHT_CHARS ? highlightSegments(draft.text, matches) : null), [draft.text, matches]);

  // ------------------------------------------------------------------ actions

  const toggleFlag = (f: RegexFlag) => {
    const has = draft.flags.includes(f);
    update({ flags: has ? draft.flags.replace(f, '') : draft.flags + f });
  };

  const loadSample = () => {
    setDraft({ ...SAMPLE });
    track('tool_action', { tool: TOOL, action: 'sample' });
  };

  const clear = () => setDraft({ ...EMPTY, flags: draft.flags });

  const copyMatches = useCallback(async () => {
    if (matches.length === 0) return;
    const ok = await copyText(matchesToText(matches));
    toast(ok ? `${matches.length} match${matches.length === 1 ? '' : 'es'} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy_matches', count: matches.length });
  }, [matches]);

  const copyReplaced = async () => {
    if (!result?.ok || result.replaced === null) return;
    const ok = await copyText(result.replaced);
    toast(ok ? 'Replaced text copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy_replaced' });
  };

  const copyPattern = async () => {
    const ok = await copyText(`/${draft.pattern}/${draft.flags}`);
    toast(ok ? 'Pattern copied' : 'Copy failed', ok ? 'ok' : 'error');
  };

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copyMatches();
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

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <div class="flex items-center gap-1" role="group" aria-label="Flags">
          {USER_FLAGS.map((f) => (
            <Chip key={f} on={draft.flags.includes(f)} onClick={() => toggleFlag(f)} title={FLAG_MEANINGS[f]}>
              <span class="font-mono">{f}</span>
            </Chip>
          ))}
        </div>
        <span class="flex-1" />
        <div class="flex flex-wrap items-center gap-1">
          <button type="button" class={'btn-sm ' + (cheat ? 'btn-primary' : 'btn-secondary')} onClick={() => setCheat((c) => !c)} title="Show a regex cheat sheet" aria-pressed={cheat}>
            <Icon name="keyboard" size={14} /> Cheat sheet
          </button>
          <button type="button" class="btn-secondary btn-sm" onClick={() => void copyMatches()} disabled={matches.length === 0} title="Copy every match, one per line (Ctrl+Shift+C)">
            <Icon name="copy" size={14} /> Copy matches
          </button>
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={clear} disabled={!draft.pattern && !draft.text && !draft.replacement} title="Clear pattern, text and replacement">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Pattern */}
      <div class={'mb-2 rounded-lg border bg-surface ' + (error ? 'border-danger/60' : 'border-line-strong')}>
        <div class="flex items-center gap-1 px-3">
          <span class="select-none font-mono text-lg text-ink-3" aria-hidden="true">
            /
          </span>
          <input
            class="h-10 min-w-0 flex-1 bg-transparent font-mono text-[14px] text-ink outline-none placeholder:text-ink-3"
            value={draft.pattern}
            onInput={(e) => update({ pattern: (e.currentTarget as HTMLInputElement).value })}
            placeholder="Type a pattern, e.g. (?<year>\d{4})-(?<month>\d{2})"
            spellcheck={false}
            autocomplete="off"
            autocapitalize="off"
            aria-label="Regular expression pattern"
            aria-invalid={!!error}
          />
          <span class="select-none font-mono text-lg text-ink-3" aria-hidden="true">
            /
          </span>
          <span class="min-w-[2ch] font-mono text-[14px] text-brand-600 dark:text-brand-400" aria-label="Active flags">
            {draft.flags}
          </span>
          <HeaderButton icon="copy" title="Copy /pattern/flags" onClick={() => void copyPattern()} disabled={!draft.pattern} />
        </div>
        {error && (
          <p class="flex items-start gap-1.5 border-t border-danger/30 px-3 py-1.5 text-xs text-danger">
            <Icon name="alert-circle" size={13} class="mt-0.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}
      </div>

      {/* Cheat sheet drawer */}
      {cheat && (
        <div class="mb-2 grid gap-x-4 gap-y-1 rounded-lg border border-line bg-surface p-3 text-xs sm:grid-cols-2 lg:grid-cols-3" aria-label="Regex cheat sheet">
          {CHEATSHEET.map((row) => (
            <div key={row.token} class="flex gap-2">
              <code class="w-[9.5rem] shrink-0 whitespace-pre rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink">{row.token}</code>
              <span class="text-ink-2">{row.meaning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Panes */}
      <div class="grid min-h-0 flex-1 gap-2 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:grid-cols-2 md:grid-rows-1">
        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Test text">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Test text</span>
            <span class="ml-2 text-ink-3">{draft.text ? `${draft.text.length.toLocaleString()} chars` : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={wrap ? 'Disable line wrap' : 'Wrap long lines'} active={wrap} onClick={() => setWrap((w) => !w)} />
          </header>
          <CodeEditor value={draft.text} onChange={(text) => update({ text })} wrap={wrap} placeholder="Paste the text to search, or load the sample" ariaLabel="Test text" class="flex-1" />
        </section>

        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Results">
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{result?.ok ? describeMatchCount(matches.length, result.truncated) : 'Results'}</span>
            {busy && <Icon name="loader" size={13} class="animate-spin text-ink-3" />}
            <span class="flex-1" />
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'matches', label: 'Matches', icon: 'search' },
                { value: 'replace', label: 'Replace', icon: 'pencil' },
              ]}
              label="Result view"
            />
          </header>

          {view === 'matches' ? (
            <div class="scrollbar-thin min-h-0 flex-1 overflow-auto">
              {/* Highlighted text */}
              <div class="border-b border-line">
                <div class="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Highlighted</div>
                {draft.text === '' ? (
                  <p class="px-3 py-2 text-xs text-ink-3">Add some test text to see matches highlighted.</p>
                ) : segments === null ? (
                  <p class="px-3 py-2 text-xs text-ink-3">The text is too long to highlight inline; the match list below is complete.</p>
                ) : (
                  <pre class={'max-h-64 overflow-auto px-3 py-2 font-mono text-[12.5px] leading-6 text-ink ' + (wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>
                    {segments.map((s, i) =>
                      s.matchIndex === null ? (
                        s.text
                      ) : (
                        <mark key={i} class={'rounded-[2px] text-inherit ' + (s.matchIndex % 2 === 0 ? 'bg-brand-500/25' : 'bg-warning/35')} title={`Match ${s.matchIndex + 1}`}>
                          {s.text}
                        </mark>
                      ),
                    )}
                  </pre>
                )}
              </div>

              {/* Match list */}
              <div class="px-3 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Matches</div>
              {matches.length === 0 ? (
                <p class="px-3 py-2 text-xs text-ink-3">{draft.pattern && draft.text ? 'Nothing matched. Check the flags, or try the cheat sheet.' : 'Matches and their capture groups appear here.'}</p>
              ) : (
                <ol class="divide-y divide-line">
                  {matches.slice(0, 500).map((m) => (
                    <li key={m.index} class="px-3 py-2 text-xs">
                      <div class="flex items-baseline gap-2">
                        <span class={'shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] ' + (m.index % 2 === 0 ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'bg-warning/25 text-ink')}>#{m.index + 1}</span>
                        <span class="shrink-0 text-ink-3">
                          {m.start}-{m.end}
                        </span>
                        <code class="min-w-0 break-all font-mono text-ink">{m.value === '' ? <em class="text-ink-3">(empty match)</em> : m.value}</code>
                      </div>
                      {m.groups.length > 0 && (
                        <dl class="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 pl-1">
                          {m.groups.map((g) => (
                            <>
                              <dt key={`k${g.index}`} class="font-mono text-[11px] text-brand-700 dark:text-brand-300">
                                {g.name ? g.name : `$${g.index}`}
                              </dt>
                              <dd key={`v${g.index}`} class="break-all font-mono text-[11px] text-ink-2">
                                {g.value === undefined ? <em class="text-ink-3">did not participate</em> : g.value === '' ? <em class="text-ink-3">(empty)</em> : g.value}
                              </dd>
                            </>
                          ))}
                        </dl>
                      )}
                    </li>
                  ))}
                  {matches.length > 500 && <li class="px-3 py-2 text-xs text-ink-3">Showing the first 500 of {matches.length.toLocaleString()} matches. Copy matches includes all of them.</li>}
                </ol>
              )}
            </div>
          ) : (
            <div class="flex min-h-0 flex-1 flex-col">
              <div class="flex items-center gap-2 border-b border-line px-3 py-2">
                <label class="shrink-0 text-xs text-ink-2" for="regex-replacement">
                  Replace with
                </label>
                <input
                  id="regex-replacement"
                  class="input h-8 flex-1 font-mono text-xs"
                  value={draft.replacement}
                  onInput={(e) => update({ replacement: (e.currentTarget as HTMLInputElement).value })}
                  placeholder="$1, $<name>, $& for the whole match, $$ for a dollar sign"
                  spellcheck={false}
                  autocomplete="off"
                  aria-label="Replacement string"
                />
                <button type="button" class="btn-primary btn-sm h-8" onClick={() => void copyReplaced()} disabled={!result?.ok || !draft.text} title="Copy the replaced text">
                  <Icon name="copy" size={13} /> Copy
                </button>
              </div>
              <CodeEditor value={result?.ok && result.replaced !== null ? result.replaced : ''} readOnly wrap={wrap} placeholder="The text with every match replaced appears here" ariaLabel="Replaced text" class="flex-1" />
              {!draft.flags.includes('g') && draft.pattern && <p class="border-t border-line px-3 py-1.5 text-xs text-ink-3">Without the g flag only the first match is replaced.</p>}
            </div>
          )}
        </section>
      </div>

      {/* Status bar */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <div class="flex min-w-0 items-center gap-2">
          {error ? (
            <span class="flex min-w-0 items-center gap-1.5 text-danger">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate">{error}</span>
            </span>
          ) : result?.ok && draft.pattern ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="check" size={13} class="text-success" />
              {describeMatchCount(matches.length, result.truncated)}
              {elapsed !== null && ` in ${elapsed < 1 ? '<1' : Math.round(elapsed)} ms`}
              {result.truncated && ' · narrow the pattern or the text to see the rest'}
            </span>
          ) : (
            <span class="text-ink-3">Matching runs in your browser, in a worker that is stopped if a pattern runs away.</span>
          )}
        </div>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy matches
        </span>
      </div>
    </div>
  );
}
