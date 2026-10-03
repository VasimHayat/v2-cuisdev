/**
 * Mock JSON Generator workspace: a JSON template with {{placeholders}} on the left,
 * generated data on the right, live as you type. Seeded so output is reproducible;
 * a placeholder reference drawer copies any placeholder to the clipboard.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { json } from '@codemirror/lang-json';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, formatBytes, toast, track } from '../shared/toast';
import { MAX_REPEAT, MockError, SAMPLE_TEMPLATE, isFlatTable, parseTemplate, randomSeed, referenceGroups, repeatSpec, run, toCsv, todayBase } from './logic';

const TOOL = 'mock-json-generator';
const DRAFT_KEY = 'cuis-mock:draft';
const MAX_DRAFT = 200 * 1024;

interface Draft {
  template: string;
  seed: number;
  /** Root record count override; null follows the template's repeat. */
  count: number | null;
  minify: boolean;
}

function loadDraft(): Draft {
  const fallback: Draft = { template: SAMPLE_TEMPLATE, seed: 1234, count: null, minify: false };
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<Draft> | null;
    if (!raw) return fallback;
    return {
      template: typeof raw.template === 'string' ? raw.template : fallback.template,
      seed: typeof raw.seed === 'number' && Number.isFinite(raw.seed) ? Math.floor(raw.seed) : fallback.seed,
      count: typeof raw.count === 'number' && raw.count >= 0 ? Math.min(MAX_REPEAT, Math.floor(raw.count)) : null,
      minify: raw.minify === true,
    };
  } catch {
    return fallback;
  }
}

export default function MockJsonGenerator() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [output, setOutput] = useState('');
  const [value, setValue] = useState<unknown>(null);
  const [error, setError] = useState<MockError | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [showRef, setShowRef] = useState(false);
  const [full, setFull] = useState(false);
  const [wrap, setWrap] = useState(false);
  const base = useMemo(() => todayBase(), []);
  const groups = useMemo(() => referenceGroups(), []);

  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  // Persist (template capped so localStorage never overflows)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (draft.template.length <= MAX_DRAFT) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        else localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, template: '' }));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [draft]);

  // Whether the root is a repeat array, for the record count control
  const rootSpec = useMemo(() => {
    try {
      return repeatSpec(parseTemplate(draft.template));
    } catch {
      return null;
    }
  }, [draft.template]);

  // Generate, debounced
  useEffect(() => {
    const t = setTimeout(() => {
      if (draft.template.trim() === '') {
        setOutput('');
        setValue(null);
        setError(null);
        setElapsed(null);
        return;
      }
      const t0 = performance.now();
      try {
        const r = run(draft.template, { seed: draft.seed, now: base, rootCount: rootSpec && draft.count !== null ? draft.count : undefined, minify: draft.minify });
        setOutput(r.json + '\n');
        setValue(r.value);
        setError(null);
        setElapsed(performance.now() - t0);
      } catch (err) {
        setError(err instanceof MockError ? err : new MockError(err instanceof Error ? err.message : String(err)));
        setElapsed(null);
      }
    }, 220);
    return () => clearTimeout(t);
  }, [draft, base, rootSpec]);

  const records = Array.isArray(value) ? value.length : null;
  const flat = isFlatTable(value);
  const bytes = useMemo(() => new TextEncoder().encode(output).length, [output]);

  // ------------------------------------------------------------------ actions

  const reroll = () => {
    update({ seed: randomSeed() });
    track('tool_action', { tool: TOOL, action: 'reroll' });
  };
  const copyOut = async () => {
    if (!output) return;
    const ok = await copyText(output);
    toast(ok ? 'JSON copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy' });
  };
  const download = () => {
    if (!output) return;
    downloadText(output, 'mock-data.json', 'application/json');
    track('tool_action', { tool: TOOL, action: 'download' });
  };
  const downloadCsv = () => {
    if (!flat) return;
    downloadText(toCsv(value as Record<string, unknown>[]), 'mock-data.csv', 'text/csv');
    track('tool_action', { tool: TOOL, action: 'download_csv' });
  };
  const copyPlaceholder = async (example: string) => {
    const ok = await copyText(example);
    toast(ok ? `Copied ${example}. Paste it into a string value.` : 'Copy failed', ok ? 'ok' : 'error');
  };

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        reroll();
      } else if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copyOut();
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

  const jsonExt = useMemo(() => json(), []);

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span>Seed</span>
          <input
            type="number"
            class="input h-8 w-24 font-mono text-xs"
            value={draft.seed}
            min={0}
            onInput={(e) => {
              const n = Number((e.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(n)) update({ seed: Math.floor(n) });
            }}
            aria-label="Seed"
          />
          <button type="button" class="btn-secondary btn-sm" onClick={reroll} title="New random seed (Ctrl+Enter)">
            <Icon name="redo" size={14} /> Reroll
          </button>
        </label>

        {rootSpec && (
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <span>Records</span>
            <input
              type="number"
              class="input h-8 w-20 font-mono text-xs"
              min={0}
              max={MAX_REPEAT}
              placeholder={rootSpec.min === rootSpec.max ? String(rootSpec.min) : `${rootSpec.min}-${rootSpec.max}`}
              value={draft.count ?? ''}
              onInput={(e) => {
                const raw = (e.currentTarget as HTMLInputElement).value;
                const n = Number(raw);
                update({ count: raw === '' || !Number.isFinite(n) ? null : Math.max(0, Math.min(MAX_REPEAT, Math.floor(n))) });
              }}
              aria-label="Number of records"
              title={`Overrides the root repeat. Up to ${MAX_REPEAT.toLocaleString('en-US')}.`}
            />
          </label>
        )}

        <Segmented
          value={draft.minify ? 'min' : 'pretty'}
          onChange={(v) => update({ minify: v === 'min' })}
          options={[
            { value: 'pretty', label: 'Pretty', icon: 'align-left' },
            { value: 'min', label: 'Minified', icon: 'chevrons-down-up' },
          ]}
          label="Output format"
        />

        <button type="button" class={'btn-sm ' + (showRef ? 'btn-primary' : 'btn-secondary')} onClick={() => setShowRef((s) => !s)} aria-expanded={showRef} title="Show every placeholder">
          <Icon name="list-tree" size={14} /> Placeholders
        </button>

        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="btn-secondary btn-sm"
            onClick={() => {
              update({ template: SAMPLE_TEMPLATE, count: null });
              track('tool_action', { tool: TOOL, action: 'sample' });
            }}
            title="Load the example template"
          >
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => update({ template: '', count: null })} disabled={!draft.template} title="Clear the template">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Placeholder reference */}
      {showRef && (
        <div class="scrollbar-thin mb-2 max-h-[38%] shrink-0 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3" aria-label="Placeholder reference">
          <p class="mb-2 text-xs text-ink-3">Click a placeholder to copy it, then paste it inside a string value in the template.</p>
          <div class="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {groups.map((g) => (
              <div key={g.group} class="min-w-0">
                <div class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-3">{g.group}</div>
                <ul class="space-y-0.5">
                  {g.items.map((it) => (
                    <li key={it.example}>
                      <button type="button" class="flex w-full min-w-0 items-baseline gap-2 rounded px-1.5 py-0.5 text-left hover:bg-surface-3" onClick={() => void copyPlaceholder(it.example)} title={it.description}>
                        <code class="shrink-0 font-mono text-[12px] text-brand-700 dark:text-brand-300">{it.example}</code>
                        <span class="truncate text-xs text-ink-3">{it.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Panes */}
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <section class="flex h-[340px] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto" aria-label="Template">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Template</span>
            <span class="ml-2 truncate text-ink-3">JSON with {'{{placeholders}}'}</span>
          </header>
          <CodeEditor
            value={draft.template}
            onChange={(t) => update({ template: t })}
            language={jsonExt}
            wrap={wrap}
            placeholder={'Write a JSON template, e.g. ["{{repeat(10)}}", {"name": "{{name.full}}"}]'}
            error={error && error.offset !== undefined ? { offset: error.offset, message: error.message } : null}
            ariaLabel="JSON template"
            class="flex-1"
          />
        </section>

        <section class="flex h-[340px] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto" aria-label="Generated JSON">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Generated</span>
            <span class="ml-2 truncate text-ink-3">{output ? `${records !== null ? `${records.toLocaleString()} ${records === 1 ? 'record' : 'records'} · ` : ''}${formatBytes(bytes)}` : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={wrap ? 'Disable line wrap' : 'Wrap long lines'} active={wrap} onClick={() => setWrap((w) => !w)} />
            <HeaderButton icon="file-text" title={flat ? 'Download as CSV' : 'CSV needs an array of flat objects'} onClick={downloadCsv} disabled={!flat} />
            <HeaderButton icon="download" title="Download mock-data.json" onClick={download} disabled={!output} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copyOut()} disabled={!output} title="Copy JSON (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy
            </button>
          </header>
          <CodeEditor value={output} readOnly language={jsonExt} wrap={wrap} placeholder="Generated JSON appears here" ariaLabel="Generated JSON" class="flex-1" />
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <div class="min-w-0">
          {error ? (
            <span class="flex min-w-0 items-center gap-1.5 text-danger">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate" title={error.message}>
                {error.message}
              </span>
            </span>
          ) : output ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="check" size={13} class="text-success" />
              Generated with seed {draft.seed}
              {elapsed !== null && ` in ${elapsed < 1 ? '<1' : Math.round(elapsed)} ms`}. Same seed, same data. Nothing leaves your browser.
            </span>
          ) : (
            <span class="text-ink-3">Write a template or load the sample. Everything is generated in your browser.</span>
          )}
        </div>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> reroll
        </span>
      </div>
    </div>
  );
}
