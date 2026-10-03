/**
 * Word Counter workspace: text on the left, live statistics on the right (count tiles,
 * length targets, keyword and phrase density). Everything is computed in the browser.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, formatBytes, toast, track } from '../shared/toast';
import { LIMITS, SAMPLE_TEXT, analyze, formatDuration, keywordDensity, limitStatus, phraseDensity, type DensityRow } from './logic';

const TOOL = 'word-counter';
const DRAFT_KEY = 'cuis-wc:draft';
const PREFS_KEY = 'cuis-wc:prefs';
const MAX_DRAFT = 200 * 1024;
const MAX_FILE = 5 * 1024 * 1024;

type DensityView = 'words' | 'phrases';
interface Prefs {
  excludeStop: boolean;
  minLength: number;
  view: DensityView;
}
const DEFAULT_PREFS: Prefs = { excludeStop: true, minLength: 3, view: 'words' };

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    return {
      excludeStop: typeof raw.excludeStop === 'boolean' ? raw.excludeStop : DEFAULT_PREFS.excludeStop,
      minLength: raw.minLength === 1 || raw.minLength === 2 || raw.minLength === 3 || raw.minLength === 4 || raw.minLength === 5 ? raw.minLength : DEFAULT_PREFS.minLength,
      view: raw.view === 'phrases' ? 'phrases' : 'words',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function WordCounter() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string>(loadDraft);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [deferred, setDeferred] = useState(text);
  const [full, setFull] = useState(false);
  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  // Large texts are analysed slightly after typing stops; small ones immediately.
  useEffect(() => {
    if (text.length < 20_000) {
      setDeferred(text);
      return;
    }
    const t = setTimeout(() => setDeferred(text), 200);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (text.length <= MAX_DRAFT) localStorage.setItem(DRAFT_KEY, text);
        else localStorage.removeItem(DRAFT_KEY);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  const stats = useMemo(() => analyze(deferred), [deferred]);
  const density: DensityRow[] = useMemo(
    () => (prefs.view === 'words' ? keywordDensity : phraseDensity)(deferred, { excludeStopWords: prefs.excludeStop, minLength: prefs.minLength, limit: 15 }),
    [deferred, prefs.view, prefs.excludeStop, prefs.minLength],
  );
  const bytes = useMemo(() => new TextEncoder().encode(deferred).length, [deferred]);

  // ------------------------------------------------------------------ actions

  const loadSample = () => {
    setText(SAMPLE_TEXT);
    track('tool_action', { tool: TOOL, action: 'sample' });
  };

  const openFile = async (file: File) => {
    if (file.size > MAX_FILE) {
      toast(`File is larger than ${formatBytes(MAX_FILE)}`, 'error');
      return;
    }
    setText(await file.text());
    toast(`Opened ${file.name}`);
    track('tool_action', { tool: TOOL, action: 'open_file' });
  };

  const reportText = () =>
    [
      `Words: ${stats.words}`,
      `Characters: ${stats.characters}`,
      `Characters without spaces: ${stats.charactersNoSpaces}`,
      `Sentences: ${stats.sentences}`,
      `Paragraphs: ${stats.paragraphs}`,
      `Lines: ${stats.lines}`,
      `Reading time: ${formatDuration(stats.readingSeconds)}`,
      `Speaking time: ${formatDuration(stats.speakingSeconds)}`,
      `Average word length: ${stats.averageWordLength}`,
      `Longest word: ${stats.longestWord || '-'}`,
    ].join('\n');

  const copyStats = async () => {
    const ok = await copyText(reportText());
    toast(ok ? 'Statistics copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy_stats' });
  };

  const downloadDensity = () => {
    const rows = [['term', 'count', 'percent'], ...density.map((r) => [r.term, String(r.count), String(r.percent)])];
    downloadText(rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n') + '\n', `keyword-density-${prefs.view}.csv`, 'text/csv');
    track('tool_action', { tool: TOOL, action: 'download_density' });
  };

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copyStats();
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

  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: 'Words', value: stats.words.toLocaleString('en-US') },
    { label: 'Characters', value: stats.characters.toLocaleString('en-US'), hint: formatBytes(bytes) },
    { label: 'Without spaces', value: stats.charactersNoSpaces.toLocaleString('en-US') },
    { label: 'Sentences', value: stats.sentences.toLocaleString('en-US') },
    { label: 'Paragraphs', value: stats.paragraphs.toLocaleString('en-US') },
    { label: 'Lines', value: stats.lines.toLocaleString('en-US') },
    { label: 'Reading time', value: formatDuration(stats.readingSeconds), hint: '238 words per minute' },
    { label: 'Speaking time', value: formatDuration(stats.speakingSeconds), hint: '150 words per minute' },
    { label: 'Avg word length', value: stats.averageWordLength ? `${stats.averageWordLength}` : '0', hint: 'letters' },
    { label: 'Longest word', value: stats.longestWord || '-', hint: stats.longestWord ? `${[...stats.longestWord].length} letters` : undefined },
  ];

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.md,.markdown,.csv,.html,.htm,text/*"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void openFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <div class="flex flex-wrap items-center gap-1.5" aria-label="Length targets">
          {LIMITS.map((target) => {
            const st = limitStatus(stats.characters, target);
            const tone = st.state === 'over' ? 'border-danger/40 bg-danger/10 text-danger' : st.state === 'short' ? 'border-warning/50 bg-warning/10 text-ink-2' : 'border-line-strong bg-surface text-ink-2';
            return (
              <span key={target.id} class={'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs ' + tone} title={`${target.label}: ${target.min ? `${target.min} to ` : 'up to '}${target.max} characters`}>
                <span class="font-medium">{target.label}</span>
                <span class="tabular-nums">{st.text}</span>
              </span>
            );
          })}
        </div>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example text">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => setText('')} disabled={!text} title="Clear the text">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Main */}
      <div class="grid min-h-0 flex-1 gap-2 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-visible">
        <section class="flex h-[340px] min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:min-h-0" aria-label="Text">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Text</span>
            <span class="ml-2 text-ink-3">{text ? `${stats.words.toLocaleString('en-US')} words` : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="folder-open" title="Open a text file" onClick={() => fileRef.current?.click()} />
            <HeaderButton icon="clipboard-paste" title="Paste from clipboard" onClick={() => void pasteFromClipboard(setText)} />
          </header>
          <CodeEditor value={text} onChange={setText} wrap placeholder="Type or paste your text here. Counts update as you type." ariaLabel="Text to count" class="flex-1" onDropFile={(f) => void openFile(f)} />
        </section>

        <section class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:min-h-0" aria-label="Statistics">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Statistics</span>
            <span class="flex-1" />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copyStats()} disabled={!text} title="Copy statistics (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy stats
            </button>
          </header>
          <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3">
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
              {tiles.map((t) => (
                <div key={t.label} class="rounded-lg border border-line bg-surface-2 px-3 py-2">
                  <div class="text-[11px] font-medium uppercase tracking-wide text-ink-3">{t.label}</div>
                  <div class="mt-0.5 truncate font-display text-xl font-bold tabular-nums text-ink" title={t.value}>
                    {t.value}
                  </div>
                  {t.hint && <div class="text-[11px] text-ink-3">{t.hint}</div>}
                </div>
              ))}
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <h3 class="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Keyword density</h3>
              <Segmented
                value={prefs.view}
                onChange={(view) => update({ view })}
                options={[
                  { value: 'words', label: 'Words' },
                  { value: 'phrases', label: 'Phrases' },
                ]}
                label="Density view"
              />
              <Chip on={prefs.excludeStop} onClick={() => update({ excludeStop: !prefs.excludeStop })} title="Leave out common English words such as the, and, of">
                Skip stop words
              </Chip>
              <label class="flex items-center gap-1.5 text-xs text-ink-2">
                Min length
                <select class="select h-8 w-auto text-[13px]" value={String(prefs.minLength)} onChange={(e) => update({ minLength: Number((e.currentTarget as HTMLSelectElement).value) })} aria-label="Minimum word length">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <span class="flex-1" />
              <HeaderButton icon="download" title="Download the table as CSV" onClick={downloadDensity} disabled={density.length === 0} />
            </div>

            {density.length === 0 ? (
              <p class="mt-3 text-xs text-ink-3">{text ? (prefs.view === 'phrases' ? 'No two-word phrase appears more than once yet.' : 'No keywords match the current filters.') : 'Keywords appear here once you add some text.'}</p>
            ) : (
              <table class="mt-2 w-full text-left text-[13px]" aria-label="Keyword density">
                <thead>
                  <tr class="border-b border-line text-xs text-ink-3">
                    <th class="py-1.5 pr-2 font-medium">{prefs.view === 'words' ? 'Word' : 'Phrase'}</th>
                    <th class="py-1.5 pr-2 text-right font-medium">Count</th>
                    <th class="w-1/3 py-1.5 font-medium">Density</th>
                  </tr>
                </thead>
                <tbody>
                  {density.map((r) => (
                    <tr key={r.term} class="border-b border-line last:border-b-0">
                      <td class="py-1 pr-2 font-mono text-xs text-ink">{r.term}</td>
                      <td class="py-1 pr-2 text-right tabular-nums text-ink-2">{r.count}</td>
                      <td class="py-1">
                        <div class="flex items-center gap-2">
                          <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                            <span class="block h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, (r.percent / (density[0]?.percent || 1)) * 100)}%` }} />
                          </span>
                          <span class="w-12 text-right text-xs tabular-nums text-ink-2">{r.percent}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">
          {text ? (
            <span class="flex items-center gap-1.5">
              <Icon name="check" size={13} class="text-success" />
              {stats.words.toLocaleString('en-US')} words · {stats.characters.toLocaleString('en-US')} characters · about {formatDuration(stats.readingSeconds)} to read
            </span>
          ) : (
            'Counting happens in your browser. Nothing is uploaded.'
          )}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy stats
        </span>
      </div>
    </div>
  );
}

async function pasteFromClipboard(set: (t: string) => void): Promise<void> {
  try {
    const t = await navigator.clipboard.readText();
    if (!t) {
      toast('Clipboard is empty', 'error');
      return;
    }
    set(t);
  } catch {
    toast('Clipboard access blocked. Press Ctrl+V in the editor instead.', 'error');
  }
}
