/**
 * Slug Generator workspace: titles on the left (one per line), slugs on the right,
 * options in the toolbar and a settings strip for the URL preview and custom
 * replacements. Duplicate slugs are flagged.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import { DEFAULT_OPTIONS, DEFAULT_REPLACEMENTS, SAMPLE, duplicateSlugs, parseReplacement, previewUrl, slugifyLines, type Replacement, type Separator, type SlugOptions } from './logic';

const TOOL = 'slug-generator';
const PREFS_KEY = 'cuis-slug:prefs';
const DRAFT_KEY = 'cuis-slug:draft';

interface Prefs extends SlugOptions {
  base: string;
}

const DEFAULT_PREFS: Prefs = { ...DEFAULT_OPTIONS, base: 'https://example.com/blog/' };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const p: Prefs = { ...DEFAULT_PREFS };
    if (raw.separator === '-' || raw.separator === '_' || raw.separator === '.') p.separator = raw.separator;
    for (const k of ['lowercase', 'transliterate', 'germanUmlauts', 'removeStopWords', 'keepNumbers'] as const) if (typeof raw[k] === 'boolean') p[k] = raw[k] as boolean;
    if (typeof raw.maxLength === 'number' && raw.maxLength >= 0 && raw.maxLength <= 500) p.maxLength = Math.round(raw.maxLength);
    if (typeof raw.base === 'string') p.base = raw.base.slice(0, 300);
    if (Array.isArray(raw.replacements)) p.replacements = raw.replacements.filter((r): r is Replacement => !!r && typeof r.from === 'string' && typeof r.to === 'string').slice(0, 40);
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function SlugGenerator() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(loadDraft);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [newRule, setNewRule] = useState('');
  const [full, setFull] = useState(false);
  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (input.length <= 100 * 1024) localStorage.setItem(DRAFT_KEY, input);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [input]);

  const slugs = useMemo(() => slugifyLines(input, prefs), [input, prefs]);
  const output = input === '' ? '' : slugs.join('\n');
  const dupes = useMemo(() => duplicateSlugs(slugs), [slugs]);
  const count = slugs.filter(Boolean).length;
  const first = slugs.find(Boolean) ?? '';
  const longest = slugs.reduce((n, s) => Math.max(n, s.length), 0);

  // ------------------------------------------------------------------ actions

  const copy = async (text: string, what: string) => {
    if (!text) return;
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', what });
  };

  const addRule = () => {
    const rule = parseReplacement(newRule);
    if (!rule) {
      toast('Write a rule as from=to, for example #=sharp', 'error');
      return;
    }
    update({ replacements: [...prefs.replacements.filter((r) => r.from !== rule.from), rule] });
    setNewRule('');
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copy(output, 'Slugs');
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
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={prefs.separator}
          onChange={(separator: Separator) => update({ separator })}
          options={[
            { value: '-', label: 'hyphen -' },
            { value: '_', label: 'under _' },
            { value: '.', label: 'dot .' },
          ]}
          label="Separator"
        />
        <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Slug options">
          <Chip on={prefs.lowercase} onClick={() => update({ lowercase: !prefs.lowercase })} title="Lower-case every word">
            Lowercase
          </Chip>
          <Chip on={prefs.transliterate} onClick={() => update({ transliterate: !prefs.transliterate })} title="Replace accented, Cyrillic and Greek letters with ASCII">
            Transliterate
          </Chip>
          <Chip on={prefs.germanUmlauts} onClick={() => update({ germanUmlauts: !prefs.germanUmlauts })} title="Write ä, ö, ü as ae, oe, ue (German convention)">
            ä → ae
          </Chip>
          <Chip on={prefs.removeStopWords} onClick={() => update({ removeStopWords: !prefs.removeStopWords })} title="Drop words such as a, the, of, and, how, to">
            Remove stop words
          </Chip>
          <Chip on={prefs.keepNumbers} onClick={() => update({ keepNumbers: !prefs.keepNumbers })} title="Keep words that are only digits">
            Keep numbers
          </Chip>
        </div>
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span>Max length</span>
          <input
            type="number"
            min={0}
            max={500}
            class="input h-8 w-20 text-[13px]"
            value={prefs.maxLength || ''}
            placeholder="none"
            onInput={(e) => update({ maxLength: Math.max(0, Math.min(500, Number((e.currentTarget as HTMLInputElement).value) || 0)) })}
            aria-label="Maximum slug length"
          />
        </label>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={() => setInput(SAMPLE)} title="Load example titles">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input} title="Clear the titles">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Replacements and preview */}
      <div class="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs">
        <span class="text-ink-2">Replace</span>
        {prefs.replacements.map((r) => (
          <span key={r.from} class="inline-flex items-center gap-1 rounded-md border border-line-strong bg-surface-2 py-0.5 pl-2 pr-0.5 font-mono">
            {r.from} → {r.to || '(remove)'}
            <button type="button" class="rounded p-0.5 text-ink-3 hover:bg-surface-3 hover:text-ink" onClick={() => update({ replacements: prefs.replacements.filter((x) => x.from !== r.from) })} title={`Remove the ${r.from} rule`} aria-label={`Remove the ${r.from} rule`}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <form
          class="flex items-center gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            addRule();
          }}
        >
          <input class="input h-7 w-28 font-mono text-xs" value={newRule} onInput={(e) => setNewRule((e.currentTarget as HTMLInputElement).value)} placeholder="#=sharp" aria-label="New replacement rule, from=to" />
          <button type="submit" class="btn-ghost btn-sm h-7 px-2" title="Add the rule">
            <Icon name="plus" size={13} />
          </button>
        </form>
        {JSON.stringify(prefs.replacements) !== JSON.stringify(DEFAULT_REPLACEMENTS) && (
          <button type="button" class="text-[11px] text-brand-600 hover:underline dark:text-brand-400" onClick={() => update({ replacements: DEFAULT_REPLACEMENTS })}>
            Reset rules
          </button>
        )}
      </div>

      {/* Panes */}
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-2 md:grid-rows-[minmax(0,1fr)]">
        <section class="flex h-[240px] min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface md:h-auto" aria-label="Titles">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Titles</span>
            <span class="ml-2 text-ink-3">one per line</span>
          </header>
          <CodeEditor value={input} onChange={setInput} wrap placeholder="Paste one title per line" ariaLabel="Titles to turn into slugs" class="flex-1" />
        </section>
        <section class="flex h-[240px] min-h-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface md:h-auto" aria-label="Slugs">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Slugs</span>
            <span class="ml-2 text-ink-3">{count ? `${count} · longest ${longest} chars` : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="download" title="Download slugs.txt" onClick={() => downloadText(output, 'slugs.txt')} disabled={!output} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copy(output, 'Slugs')} disabled={!output} title="Copy all slugs (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy
            </button>
          </header>
          <CodeEditor value={output} readOnly wrap placeholder="Slugs appear here as you type" ariaLabel="Generated slugs" class="flex-1" />
        </section>
      </div>

      {/* Preview */}
      <div class="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs">
        <label class="flex items-center gap-2 text-ink-2">
          <span>Base URL</span>
          <input class="input h-7 w-56 font-mono text-xs" value={prefs.base} onInput={(e) => update({ base: (e.currentTarget as HTMLInputElement).value })} aria-label="Base URL for the preview" spellcheck={false} />
        </label>
        <span class="min-w-0 flex-1 truncate font-mono text-ink" title={first ? previewUrl(prefs.base, first) : ''}>
          {first ? previewUrl(prefs.base, first) : <span class="text-ink-3">The first slug is previewed here as a full URL</span>}
        </span>
        <HeaderButton icon="copy" title="Copy the preview URL" onClick={() => void copy(previewUrl(prefs.base, first), 'URL')} disabled={!first} />
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <span class="min-w-0 truncate">
          {dupes.length ? (
            <span class="text-warning">
              <Icon name="alert-circle" size={13} class="mr-1 inline" />
              {dupes.length} duplicate {dupes.length === 1 ? 'slug' : 'slugs'}: {dupes.slice(0, 3).join(', ')}
              {dupes.length > 3 ? ' and more' : ''}. Add a suffix to keep URLs unique.
            </span>
          ) : count ? (
            <span class="text-ink-3">
              <Icon name="check" size={13} class="mr-1 inline text-success" />
              {count} {count === 1 ? 'slug' : 'slugs'} generated in your browser.
            </span>
          ) : (
            <span class="text-ink-3">Paste titles to turn them into URL slugs. Nothing leaves your browser.</span>
          )}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy slugs
        </span>
      </div>
    </div>
  );
}
