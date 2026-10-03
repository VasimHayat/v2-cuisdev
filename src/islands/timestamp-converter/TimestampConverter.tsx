/**
 * Timestamp Converter workspace: a live clock strip, one input that accepts any
 * timestamp or date, a zone picker, every representation of the instant in a table,
 * a date and time picker that edits the instant in the chosen zone, and a batch mode
 * for many lines at once. Logic lives in logic.ts.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  QUICK_ZONES,
  SAMPLE_INPUT,
  TimestampError,
  UNIT_LABELS,
  batchToCsv,
  convertBatch,
  formatAll,
  isValidZone,
  listTimeZones,
  localZone,
  msToZonedParts,
  parseInput,
  toIsoUtc,
  unixSeconds,
  zoneOffsetLabel,
  zonedPartsToMs,
  type TimestampUnit,
  type UnitChoice,
} from './logic';

const TOOL = 'timestamp-converter';
const PREFS_KEY = 'cuis-time:prefs';
type Mode = 'single' | 'batch';

interface Prefs {
  zone: string;
  assume: UnitChoice;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { zone: localZone(), assume: 'auto' };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return fallback;
    const p = { ...fallback };
    if (typeof raw.zone === 'string' && isValidZone(raw.zone)) p.zone = raw.zone;
    if (raw.assume === 'auto' || (typeof raw.assume === 'string' && raw.assume in UNIT_LABELS)) p.assume = raw.assume;
    return p;
  } catch {
    return fallback;
  }
}

export default function TimestampConverter() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === 'undefined' ? { zone: 'UTC', assume: 'auto' } : loadPrefs()));
  const [mode, setMode] = useState<Mode>('single');
  const [input, setInput] = useState('');
  const [batchText, setBatchText] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [full, setFull] = useState(false);
  const zones = useMemo(() => (typeof window === 'undefined' ? ['UTC'] : listTimeZones()), []);
  const userZone = useMemo(() => (typeof window === 'undefined' ? 'UTC' : localZone()), []);

  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Start with "now" so the table is never empty on first visit
  useEffect(() => {
    if (input === '') setInput(String(unixSeconds(Date.now())));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = useMemo(() => {
    if (input.trim() === '') return { ok: false as const, error: null };
    try {
      return { ok: true as const, value: parseInput(input, { assume: prefs.assume, now: new Date(), timeZone: prefs.zone }) };
    } catch (err) {
      return { ok: false as const, error: err instanceof TimestampError ? err.message : String(err) };
    }
    // Recompute relative rows each tick only through `rows` below.
  }, [input, prefs.assume, prefs.zone]);

  const rows = useMemo(() => (parsed.ok ? formatAll(parsed.value.ms, prefs.zone, new Date(now)) : []), [parsed, prefs.zone, now]);
  const parts = useMemo(() => (parsed.ok ? msToZonedParts(parsed.value.ms, prefs.zone) : null), [parsed, prefs.zone]);
  const batch = useMemo(() => (mode === 'batch' ? convertBatch(batchText, prefs.zone, { assume: prefs.assume }) : []), [mode, batchText, prefs.zone, prefs.assume]);
  const batchErrors = batch.filter((r) => r.error).length;

  // ------------------------------------------------------------------ actions

  const copy = async (text: string, what: string) => {
    const ok = await copyText(text);
    toast(ok ? `${what} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', what });
  };

  const useNow = () => {
    setMode('single');
    setInput(String(unixSeconds(Date.now())));
    track('tool_action', { tool: TOOL, action: 'now' });
  };

  const loadSample = () => {
    if (mode === 'batch') setBatchText(`${SAMPLE_INPUT}\n1767225600000\n2026-03-29T01:30:00Z\nTue, 14 Nov 2023 22:13:20 GMT\n+90m\nnot a date`);
    else setInput(SAMPLE_INPUT);
    track('tool_action', { tool: TOOL, action: 'sample', mode });
  };

  const onPicker = (date: string, time: string) => {
    try {
      const ms = zonedPartsToMs(date, time, prefs.zone);
      setInput(String(prefs.assume === 'milliseconds' ? ms : unixSeconds(ms)));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Invalid date', 'error');
    }
  };

  const copyBatch = () => {
    const text = batch.map((r) => (r.error ? `${r.input}\tERROR: ${r.error}` : `${r.input}\t${r.iso}\t${r.seconds}`)).join('\n');
    void copy(text, 'Results');
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && full) setFull(false);
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

  const zoneOptions = zones.includes(prefs.zone) ? zones : [prefs.zone, ...zones];

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen overflow-auto p-2' : 'relative min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      {/* Live clock */}
      <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs" aria-label="Current time">
        <span class="flex items-center gap-1.5 font-semibold text-ink">
          <span class="h-2 w-2 animate-pulse rounded-full bg-success" aria-hidden="true" /> Now
        </span>
        <ClockValue label="Unix" value={String(unixSeconds(now))} onCopy={() => void copy(String(unixSeconds(now)), 'Unix time')} />
        <ClockValue label="UTC" value={toIsoUtc(now).replace(/\.\d{3}Z$/, 'Z')} onCopy={() => void copy(toIsoUtc(now), 'UTC time')} />
        <ClockValue label={userZone} value={msToZonedParts(now, userZone).date + ' ' + msToZonedParts(now, userZone).time} onCopy={() => void copy(formatAll(now, userZone)[3]!.value, 'Local time')} />
        <span class="flex-1" />
        <button type="button" class="btn-secondary btn-sm h-7" onClick={useNow} title="Convert the current time">
          <Icon name="redo" size={13} /> Use now
        </button>
      </div>

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2">
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            track('tool_action', { tool: TOOL, action: 'mode', mode: m });
          }}
          options={[
            { value: 'single', label: 'Single', icon: 'list-tree' },
            { value: 'batch', label: 'Batch', icon: 'rows' },
          ]}
          label="Mode"
        />
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">Numbers are</span>
          <select class="select h-8 w-auto text-[13px]" value={prefs.assume} onChange={(e) => update({ assume: (e.currentTarget as HTMLSelectElement).value as UnitChoice })} aria-label="Assume units">
            <option value="auto">Auto-detect</option>
            {(Object.keys(UNIT_LABELS) as TimestampUnit[]).map((u) => (
              <option key={u} value={u}>
                {u[0]!.toUpperCase() + u.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">Time zone</span>
          <select class="select h-8 w-auto max-w-[15rem] text-[13px]" value={prefs.zone} onChange={(e) => update({ zone: (e.currentTarget as HTMLSelectElement).value })} aria-label="Time zone">
            {zoneOptions.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => (mode === 'batch' ? setBatchText('') : setInput(''))} title="Clear the input">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-1.5 px-1 pb-2" role="group" aria-label="Quick time zones">
        <Chip on={prefs.zone === userZone} onClick={() => update({ zone: userZone })} title={`Your zone: ${userZone}`}>
          Local
        </Chip>
        {QUICK_ZONES.map((q) => (
          <Chip key={q.zone} on={prefs.zone === q.zone} onClick={() => update({ zone: q.zone })} title={q.zone}>
            {q.label}
          </Chip>
        ))}
      </div>

      {mode === 'single' ? (
        <div class="grid gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Input */}
          <section class="flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Timestamp input">
            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">Timestamp or date</span>
              <span class="flex-1" />
              <HeaderButton icon="copy" title="Copy the input" onClick={() => void copy(input, 'Input')} disabled={!input} />
            </header>
            <div class="space-y-3 p-3">
              <input
                class={'input h-12 font-mono text-lg ' + (parsed.ok || !input ? '' : 'border-danger')}
                value={input}
                onInput={(e) => setInput((e.currentTarget as HTMLInputElement).value)}
                placeholder="1767225600, 2026-01-01T09:30:00Z, now, +2h"
                spellcheck={false}
                autocomplete="off"
                aria-label="Timestamp or date to convert"
              />
              <p class={'flex min-h-5 items-center gap-1.5 text-xs ' + (parsed.ok ? 'text-ink-3' : 'text-danger')}>
                {parsed.ok ? (
                  <>
                    <Icon name="check" size={13} class="text-success" /> Read as {parsed.value.detected}
                  </>
                ) : parsed.error ? (
                  <>
                    <Icon name="alert-circle" size={13} class="shrink-0" /> {parsed.error}
                  </>
                ) : null}
              </p>
              <div>
                <div class="mb-1 text-xs text-ink-2">Pick a date and time in {prefs.zone}</div>
                <div class="flex gap-2">
                  <input
                    type="date"
                    class="input h-9 flex-1"
                    value={parts?.date ?? ''}
                    onChange={(e) => onPicker((e.currentTarget as HTMLInputElement).value, parts?.time ?? '00:00:00')}
                    aria-label="Date"
                  />
                  <input
                    type="time"
                    step={1}
                    class="input h-9 w-36"
                    value={parts?.time ?? ''}
                    onChange={(e) => onPicker(parts?.date ?? msToZonedParts(Date.now(), prefs.zone).date, (e.currentTarget as HTMLInputElement).value)}
                    aria-label="Time"
                  />
                </div>
              </div>
              <p class="text-xs leading-5 text-ink-3">
                Accepts Unix seconds, milliseconds, microseconds or nanoseconds, ISO 8601, RFC 2822, <span class="font-mono">YYYY-MM-DD HH:mm</span> and shortcuts such as <span class="font-mono">now</span>, <span class="font-mono">today</span>,{' '}
                <span class="font-mono">+2h</span> or <span class="font-mono">-3d</span>.
              </p>
            </div>
          </section>

          {/* Results */}
          <section class="flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Converted values">
            <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">Converted</span>
              {parsed.ok && <span class="badge border-line-strong text-ink-2">{zoneOffsetLabel(parsed.value.ms, prefs.zone)}</span>}
              <span class="flex-1" />
              <HeaderButton icon="copy" title="Copy all values" onClick={() => void copy(rows.map((r) => `${r.label}: ${r.value}`).join('\n'), 'All values')} disabled={!rows.length} />
            </header>
            {rows.length === 0 ? (
              <div class="flex flex-1 items-center justify-center p-6 text-sm text-ink-3">Enter a timestamp or date to see every format.</div>
            ) : (
              <table class="w-full text-left text-[13px]">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} class="group border-b border-line last:border-b-0">
                      <th scope="row" class="w-[11rem] px-3 py-1.5 align-top text-xs font-medium text-ink-2">
                        {r.label}
                        {r.hint && <div class="font-normal text-ink-3">{r.hint}</div>}
                      </th>
                      <td class="break-all px-2 py-1.5 font-mono text-xs text-ink">{r.value}</td>
                      <td class="w-9 pr-1 align-top">
                        <HeaderButton icon="copy" title={`Copy ${r.label}`} onClick={() => void copy(r.value, r.label)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      ) : (
        <div class="grid gap-2 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <section class="flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Batch input">
            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">One per line</span>
              <span class="ml-2 text-ink-3">{batch.length ? `${batch.length} ${batch.length === 1 ? 'line' : 'lines'}` : ''}</span>
            </header>
            <textarea
              class="min-h-[320px] flex-1 resize-none bg-surface p-3 font-mono text-[12.5px] leading-6 text-ink outline-none placeholder:text-ink-3"
              value={batchText}
              onInput={(e) => setBatchText((e.currentTarget as HTMLTextAreaElement).value)}
              placeholder={'1767225600\n1767225600000\n2026-01-01T09:30:00Z'}
              spellcheck={false}
              aria-label="Timestamps to convert, one per line"
            />
          </section>
          <section class="flex flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Batch results">
            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">Results</span>
              {batchErrors > 0 && <span class="badge ml-2 border-danger/40 bg-danger/10 text-danger">{batchErrors} not readable</span>}
              <span class="flex-1" />
              <HeaderButton
                icon="download"
                title="Download CSV"
                onClick={() => {
                  downloadText(batchToCsv(batch), 'timestamps.csv', 'text/csv');
                  track('tool_action', { tool: TOOL, action: 'download_csv' });
                }}
                disabled={!batch.length}
              />
              <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={copyBatch} disabled={!batch.length}>
                <Icon name="copy" size={13} /> Copy all
              </button>
            </header>
            {batch.length === 0 ? (
              <div class="flex flex-1 items-center justify-center p-6 text-sm text-ink-3">Paste timestamps or dates, one per line.</div>
            ) : (
              <div class="scrollbar-thin max-h-[420px] overflow-auto">
                <table class="w-full text-left text-xs">
                  <thead class="sticky top-0 bg-surface-2 text-ink-3">
                    <tr>
                      <th class="px-3 py-1.5 font-medium">Input</th>
                      <th class="px-2 py-1.5 font-medium">ISO 8601 (UTC)</th>
                      <th class="px-2 py-1.5 font-medium">{prefs.zone}</th>
                      <th class="px-2 py-1.5 font-medium">Unix seconds</th>
                    </tr>
                  </thead>
                  <tbody class="font-mono">
                    {batch.map((r, i) => (
                      <tr key={i} class={'border-t border-line ' + (r.error ? 'bg-danger/5' : '')}>
                        <td class="break-all px-3 py-1.5 text-ink">{r.input}</td>
                        {r.error ? (
                          <td colSpan={3} class="px-2 py-1.5 font-sans text-danger">
                            {r.error}
                          </td>
                        ) : (
                          <>
                            <td class="px-2 py-1.5 text-ink">{r.iso}</td>
                            <td class="px-2 py-1.5 text-ink-2">{r.zone}</td>
                            <td class="px-2 py-1.5 text-ink-2">{r.seconds}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Conversions run in your browser using its time zone database. Nothing is uploaded.</span>
        <span class="hidden shrink-0 sm:inline">Your zone: {userZone}</span>
      </div>
    </div>
  );
}

function ClockValue(p: { label: string; value: string; onCopy: () => void }) {
  return (
    <span class="flex items-center gap-1.5">
      <span class="text-ink-3">{p.label}</span>
      <button type="button" class="rounded px-1 font-mono text-ink tabular-nums hover:bg-surface-3" onClick={p.onCopy} title={`Copy ${p.label}`}>
        {p.value}
      </button>
    </span>
  );
}
