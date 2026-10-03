/**
 * Cron Expression Parser workspace: type an expression, read it as an English sentence,
 * see each field explained (the field under the caret is highlighted), and list the next
 * run times in any time zone. cronstrue and croner load on first use (see logic.ts).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import {
  CronError,
  FIELD_SPECS,
  MACROS,
  PRESETS,
  SAMPLE,
  describe,
  fieldOrder,
  formatInZone,
  formatRelative,
  intervalSummary,
  listTimeZones,
  localTimeZone,
  nextRuns,
  splitFields,
  usesLegacyOr,
  zoneOffsetLabel,
  type FieldBreakdown,
  type FieldCount,
  type FieldId,
} from './logic';

const TOOL = 'cron-parser';
const DRAFT_KEY = 'cuis-cron:draft';
const COUNTS = [5, 10, 20] as const;
const SHORT_LABELS: Record<FieldId, string> = { second: 'sec', minute: 'min', hour: 'hour', dayOfMonth: 'day', month: 'month', dayOfWeek: 'weekday', year: 'year' };

interface Draft {
  expression: string;
  zone: string;
  count: number;
}

function loadDraft(): Draft {
  const d: Draft = { expression: SAMPLE, zone: localTimeZone(), count: 10 };
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<Draft> | null;
    if (!raw) return d;
    if (typeof raw.expression === 'string') d.expression = raw.expression.slice(0, 200);
    if (typeof raw.zone === 'string' && raw.zone) d.zone = raw.zone;
    if (typeof raw.count === 'number' && (COUNTS as readonly number[]).includes(raw.count)) d.count = raw.count;
  } catch {}
  return d;
}

/** Whitespace-separated tokens of the raw input with their character ranges. */
function tokenRanges(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

export default function CronParser() {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(() => (typeof window === 'undefined' ? { expression: SAMPLE, zone: 'UTC', count: 10 } : loadDraft()));
  const [caret, setCaret] = useState<number | null>(null);
  const [sentence, setSentence] = useState<string>('');
  const [runs, setRuns] = useState<Date[]>([]);
  const [legacyOr, setLegacyOr] = useState(false);
  const [loading, setLoading] = useState(false);
  const [asyncError, setAsyncError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [full, setFull] = useState(false);
  const seq = useRef(0);
  const zones = useMemo(() => (typeof window === 'undefined' ? ['UTC'] : listTimeZones()), []);
  const localZone = useMemo(() => (typeof window === 'undefined' ? 'UTC' : localTimeZone()), []);

  const { expression, zone, count } = draft;
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Synchronous parse: fields and errors
  const parsed = useMemo((): { fields: FieldBreakdown[]; count: FieldCount; macro?: string } | { error: CronError } | null => {
    if (expression.trim() === '') return null;
    try {
      const { normalized, fields } = splitFields(expression);
      return { fields, count: normalized.fieldCount, macro: normalized.macro };
    } catch (err) {
      return { error: err instanceof CronError ? err : new CronError(String(err)) };
    }
  }, [expression]);
  const fields = parsed && 'fields' in parsed ? parsed.fields : null;
  const syncError = parsed && 'error' in parsed ? parsed.error : null;
  const fieldCount: FieldCount | null = parsed && 'count' in parsed ? parsed.count : null;
  const macro = parsed && 'macro' in parsed ? parsed.macro : undefined;

  // Async: sentence and next runs
  useEffect(() => {
    if (!fields) {
      setSentence('');
      setRuns([]);
      setAsyncError(null);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const [s, r] = await Promise.all([describe(expression), nextRuns(expression, count, zone)]);
        if (id !== seq.current) return;
        setSentence(s);
        setRuns(r.dates);
        setLegacyOr(r.legacyOr);
        setAsyncError(null);
        setNow(Date.now());
      } catch (err) {
        if (id !== seq.current) return;
        setSentence('');
        setRuns([]);
        setAsyncError(err instanceof Error ? err.message : String(err));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [expression, count, zone, fields !== null]);

  // Which field is under the caret
  const tokens = useMemo(() => tokenRanges(expression), [expression]);
  const activeIndex = useMemo(() => {
    if (caret === null || macro) return -1;
    const i = tokens.findIndex((t) => caret >= t.start && caret <= t.end);
    return i;
  }, [caret, tokens, macro]);
  const order = fieldOrder(fieldCount ?? (tokens.length === 6 ? 6 : tokens.length === 7 ? 7 : 5));
  const activeField: FieldId | null = activeIndex >= 0 ? (order[activeIndex] ?? null) : null;
  const errorField = syncError?.field ?? null;

  const syncCaret = () => {
    const el = inputRef.current;
    if (el) setCaret(el.selectionStart);
  };

  // ------------------------------------------------------------------ actions

  const loadPreset = (expr: string, label?: string) => {
    update({ expression: expr });
    setShowPresets(false);
    track('tool_action', { tool: TOOL, action: label ? 'preset' : 'sample', preset: label });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', what });
  };

  const toggleSeconds = () => {
    if (!fields || macro) return;
    const parts = expression.trim().split(/\s+/);
    if (parts.length === 5) update({ expression: `0 ${parts.join(' ')}` });
    else if (parts.length === 6) update({ expression: parts.slice(1).join(' ') });
  };

  const runsText = runs.map((d) => `${formatInZone(d, zone)} (${zone})`).join('\n');

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showPresets) setShowPresets(false);
        else if (full) setFull(false);
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

  const error = syncError?.message ?? asyncError;
  const interval = intervalSummary(runs);
  const hasSeconds = fieldCount === 6 || fieldCount === 7;
  const legacy = legacyOr || (fields && fieldCount ? usesLegacyOr({ expression, fieldCount, fields: fields.map((f) => f.value) }) : false);

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen overflow-auto p-2' : 'relative min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2 pt-1">
        <button type="button" class={'btn-sm ' + (showPresets ? 'btn-primary' : 'btn-secondary')} onClick={() => setShowPresets((s) => !s)} aria-expanded={showPresets} title="Common schedules">
          <Icon name="list-tree" size={14} /> Presets
          <Icon name={showPresets ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
        <Chip on={hasSeconds} onClick={toggleSeconds} title={hasSeconds ? 'Remove the leading seconds field' : 'Add a leading seconds field (6-field cron, as used by Quartz, Spring and node-cron)'}>
          Seconds field
        </Chip>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-ghost btn-sm" onClick={() => loadPreset(SAMPLE)} title="Load an example">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button
            type="button"
            class="btn-ghost btn-sm"
            onClick={() => {
              update({ expression: '' });
              inputRef.current?.focus();
            }}
            disabled={!expression}
            title="Clear the expression"
          >
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Presets drawer */}
      {showPresets && (
        <div class="mb-2 grid gap-1 rounded-lg border border-line bg-surface p-2 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Preset schedules">
          {PRESETS.map((p) => (
            <button
              key={p.expression}
              type="button"
              role="listitem"
              class={'flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-surface-3 ' + (p.expression === expression.trim() ? 'bg-brand-50 dark:bg-brand-900/30' : '')}
              onClick={() => loadPreset(p.expression, p.label)}
            >
              <span class="text-ink-2">{p.label}</span>
              <code class="shrink-0 font-mono text-xs text-brand-700 dark:text-brand-300">{p.expression}</code>
            </button>
          ))}
          <div class="col-span-full mt-1 flex flex-wrap gap-x-3 gap-y-1 border-t border-line px-2.5 pt-2 text-xs text-ink-3">
            Shorthands:
            {Object.entries(MACROS)
              .filter(([k]) => k !== '@annually' && k !== '@midnight')
              .map(([k]) => (
                <button key={k} type="button" class="font-mono text-brand-700 hover:underline dark:text-brand-300" onClick={() => loadPreset(k, k)}>
                  {k}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Expression */}
      <section class="rounded-lg border border-line-strong bg-surface p-4" aria-label="Cron expression">
        <div class="flex items-center gap-2">
          <input
            ref={inputRef}
            class={'h-14 min-w-0 flex-1 rounded-md border bg-surface-2 px-4 text-center font-mono text-2xl tracking-wide text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-3xl ' + (error ? 'border-danger/60' : 'border-line-strong')}
            value={expression}
            onInput={(e) => {
              update({ expression: (e.currentTarget as HTMLInputElement).value });
              syncCaret();
            }}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onSelect={syncCaret}
            onFocus={syncCaret}
            onBlur={() => setCaret(null)}
            placeholder="*/15 * * * *"
            spellcheck={false}
            autocomplete="off"
            aria-label="Cron expression"
            aria-invalid={!!error}
            aria-describedby="cron-sentence"
          />
          <HeaderButton icon="copy" title="Copy expression" onClick={() => void copy(expression.trim(), 'Expression')} disabled={!expression.trim()} />
        </div>

        {/* Field labels under each token */}
        <div class="mt-2 flex flex-wrap justify-center gap-1.5" aria-hidden="true">
          {(macro ? fieldOrder(5) : order).map((id, i) => {
            const isActive = id === activeField;
            const isError = id === errorField;
            const value = macro ? (fields?.[i]?.value ?? '') : (tokens[i] ? expression.slice(tokens[i]!.start, tokens[i]!.end) : '');
            return (
              <span
                key={id}
                class={
                  'flex min-w-[4.5rem] flex-col items-center rounded-md border px-2 py-1 transition-colors ' +
                  (isError ? 'border-danger/50 bg-danger/10' : isActive ? 'border-brand-400 bg-brand-50 dark:border-brand-600 dark:bg-brand-900/40' : 'border-line bg-surface-2')
                }
              >
                <span class={'font-mono text-sm ' + (isError ? 'text-danger' : 'text-ink')}>{value || '·'}</span>
                <span class={'text-[10px] uppercase tracking-wide ' + (isActive ? 'text-brand-700 dark:text-brand-300' : 'text-ink-3')}>{SHORT_LABELS[id]}</span>
              </span>
            );
          })}
        </div>

        <p id="cron-sentence" class="mt-4 min-h-7 text-center text-lg font-medium" aria-live="polite">
          {error ? (
            <span class="inline-flex items-start gap-2 text-base text-danger">
              <Icon name="alert-circle" size={18} class="mt-0.5 shrink-0" />
              <span>
                {syncError?.field && <strong class="font-semibold">{FIELD_SPECS[syncError.field].name}: </strong>}
                {error}
              </span>
            </span>
          ) : sentence ? (
            <span class="text-ink">
              “{sentence}”{macro && <span class="ml-2 align-middle font-mono text-sm text-ink-3">{macro} = {fields?.map((f) => f.value).join(' ')}</span>}
            </span>
          ) : loading ? (
            <span class="inline-flex items-center gap-2 text-base text-ink-3">
              <Icon name="loader" size={16} class="animate-spin" /> Reading the schedule
            </span>
          ) : (
            <span class="text-base text-ink-3">Type a cron expression, or pick a preset.</span>
          )}
        </p>
      </section>

      <div class="mt-2 grid gap-2 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        {/* Field breakdown */}
        <section class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Field breakdown">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Fields</span>
            {fieldCount && <span class="ml-2 text-ink-3">{fieldCount}-field cron{fieldCount === 6 ? ' (with seconds)' : fieldCount === 7 ? ' (with seconds and year)' : ''}</span>}
          </header>
          {fields ? (
            <table class="w-full text-left text-[13px]">
              <thead class="sr-only">
                <tr>
                  <th>Field</th>
                  <th>Value</th>
                  <th>Meaning</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id} class={'border-b border-line align-top last:border-b-0 ' + (f.id === activeField ? 'bg-brand-50/70 dark:bg-brand-900/25' : '')}>
                    <th scope="row" class="w-[7.5rem] px-3 py-2 text-xs font-medium text-ink-2">
                      {f.name}
                      <div class="mt-0.5 font-normal text-ink-3">{f.allowed}</div>
                    </th>
                    <td class="w-24 px-2 py-2 font-mono text-sm text-brand-700 dark:text-brand-300">{f.value}</td>
                    <td class="px-2 py-2 text-ink">{f.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="p-4 text-sm text-ink-3">{syncError ? 'Fix the expression to see each field explained.' : 'Each field is explained here.'}</p>
          )}
        </section>

        {/* Next runs */}
        <section class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Next runs">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Next runs</span>
            {interval && <span class="ml-2 text-ink-3">{interval}</span>}
            {loading && <Icon name="loader" size={13} class="ml-2 animate-spin text-ink-3" />}
            <span class="flex-1" />
            <HeaderButton icon="copy" title="Copy the run list" onClick={() => void copy(runsText, 'Run list')} disabled={runs.length === 0} />
          </header>

          <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <select class="select h-8 min-w-0 flex-1 text-[13px]" value={zone} onChange={(e) => update({ zone: (e.currentTarget as HTMLSelectElement).value })} aria-label="Time zone">
              {(zones.includes(zone) ? zones : [zone, ...zones]).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
            <Chip on={zone === 'UTC'} onClick={() => update({ zone: 'UTC' })} title="Show runs in UTC">
              UTC
            </Chip>
            {localZone !== 'UTC' && (
              <Chip on={zone === localZone} onClick={() => update({ zone: localZone })} title={`Show runs in your zone (${localZone})`}>
                Local
              </Chip>
            )}
            <select class="select h-8 w-auto text-[13px]" value={String(count)} onChange={(e) => update({ count: Number((e.currentTarget as HTMLSelectElement).value) })} aria-label="Number of runs">
              {COUNTS.map((c) => (
                <option key={c} value={String(c)}>
                  {c} runs
                </option>
              ))}
            </select>
          </div>

          {runs.length > 0 ? (
            <ol class="scrollbar-thin max-h-[26rem] overflow-y-auto">
              {runs.map((d, i) => (
                <li key={d.getTime()} class="flex items-baseline gap-3 border-b border-line px-3 py-1.5 text-sm last:border-b-0">
                  <span class="w-6 shrink-0 text-right font-mono text-xs text-ink-3">{i + 1}</span>
                  <span class="font-mono text-[13px] text-ink">{formatInZone(d, zone)}</span>
                  <span class="ml-auto shrink-0 text-xs text-ink-3">{formatRelative(d.getTime(), now)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p class="p-4 text-sm text-ink-3">{error ? 'No runs to show.' : loading ? 'Calculating…' : 'Upcoming run times appear here.'}</p>
          )}

          {runs.length > 0 && (
            <p class="border-t border-line px-3 py-2 text-xs text-ink-3">
              Times in {zone} ({zoneOffsetLabel(runs[0]!, zone)}). Daylight saving changes are applied.
            </p>
          )}
          {legacy && fields && (
            <p class="m-3 mt-0 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-ink-2">
              Both day of month and day of week are set, so the job runs on days matching <strong>either</strong> one, as in classic cron. Use * in one of them to require only the other.
            </p>
          )}
        </section>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Parsed and scheduled in your browser. Nothing is uploaded.</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <Icon name="keyboard" size={13} /> Move the caret to highlight a field
        </span>
      </div>
    </div>
  );
}
