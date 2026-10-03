/**
 * UUID Generator workspace: version and formatting controls on the left, the generated
 * batch on the right, and an inspector underneath that explains any pasted UUID.
 * Everything runs locally with WebCrypto; v3 uses hash-wasm MD5.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  MAX_COUNT,
  NAMESPACES,
  UuidError,
  VERSIONS,
  describe,
  formatUuids,
  generateUuids,
  isValidUuid,
  parseUuid,
  type ParsedUuid,
  type Separator,
  type UuidVersion,
} from './logic';

const TOOL = 'uuid-generator';
const PREFS_KEY = 'cuis-uuid:prefs';

interface Prefs {
  version: UuidVersion;
  count: number;
  uppercase: boolean;
  removeHyphens: boolean;
  braces: boolean;
  quotes: boolean;
  urn: boolean;
  separator: Separator;
  namespace: string;
}

const DEFAULT_PREFS: Prefs = { version: 'v4', count: 10, uppercase: false, removeHyphens: false, braces: false, quotes: false, urn: false, separator: 'lines', namespace: 'dns' };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const p = { ...DEFAULT_PREFS };
    if (VERSIONS.some((v) => v.id === raw.version)) p.version = raw.version as UuidVersion;
    if (typeof raw.count === 'number' && raw.count >= 1 && raw.count <= MAX_COUNT) p.count = Math.round(raw.count);
    for (const k of ['uppercase', 'removeHyphens', 'braces', 'quotes', 'urn'] as const) if (typeof raw[k] === 'boolean') p[k] = raw[k] as boolean;
    if (raw.separator === 'lines' || raw.separator === 'comma' || raw.separator === 'json') p.separator = raw.separator;
    if (typeof raw.namespace === 'string') p.namespace = raw.namespace;
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function UuidGenerator() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === 'undefined' ? DEFAULT_PREFS : loadPrefs()));
  const [name, setName] = useState('www.example.com');
  const [customNs, setCustomNs] = useState('');
  const [uuids, setUuids] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [inspect, setInspect] = useState('');
  const [full, setFull] = useState(false);
  const seq = useRef(0);
  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  const nameBased = prefs.version === 'v5' || prefs.version === 'v3';
  const namespaceValue = prefs.namespace === 'custom' ? customNs : prefs.namespace;

  const run = async () => {
    const id = ++seq.current;
    const t0 = performance.now();
    try {
      const list = await generateUuids({ version: prefs.version, count: prefs.count, namespace: namespaceValue, name });
      if (id !== seq.current) return;
      setUuids(list);
      setError(null);
      setElapsed(performance.now() - t0);
    } catch (err) {
      if (id !== seq.current) return;
      setUuids([]);
      setError(err instanceof UuidError ? err.message : String(err));
      setElapsed(null);
    }
  };

  // Regenerate when generation inputs change (debounced). Formatting is applied live.
  useEffect(() => {
    const t = setTimeout(() => void run(), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.version, prefs.count, prefs.namespace, customNs, name]);

  const output = useMemo(() => formatUuids(uuids, prefs), [uuids, prefs.uppercase, prefs.removeHyphens, prefs.braces, prefs.quotes, prefs.urn, prefs.separator]);

  const parsed: { ok: true; value: ParsedUuid } | { ok: false; message: string } | null = useMemo(() => {
    if (inspect.trim() === '') return null;
    try {
      return { ok: true, value: parseUuid(inspect) };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }, [inspect]);

  const copy = async () => {
    if (!output) return;
    const ok = await copyText(output);
    toast(ok ? `${describe(prefs.version, uuids.length)} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', version: prefs.version, count: uuids.length });
  };
  const download = () => {
    if (!output) return;
    downloadText(output, prefs.separator === 'json' ? 'uuids.json' : 'uuids.txt', prefs.separator === 'json' ? 'application/json' : 'text/plain');
    track('tool_action', { tool: TOOL, action: 'download', version: prefs.version, count: uuids.length });
  };
  const regenerate = () => {
    void run();
    track('tool_action', { tool: TOOL, action: 'generate', version: prefs.version, count: prefs.count });
  };
  const setCount = (raw: string | number) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    update({ count: Math.min(MAX_COUNT, Math.max(1, n)) });
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        regenerate();
      } else if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copy();
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

  const versionInfo = VERSIONS.find((v) => v.id === prefs.version);

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen overflow-auto p-2' : 'relative min-h-[560px] md:h-[min(78vh,820px)] rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented value={prefs.version} onChange={(version) => update({ version })} options={VERSIONS.map((v) => ({ value: v.id, label: v.label, title: v.hint }))} label="UUID version" />
        <span class="hidden text-xs text-ink-3 md:inline">{versionInfo?.hint}</span>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-primary btn-sm" onClick={regenerate} title="Generate again (Ctrl+Enter)" disabled={nameBased}>
            <Icon name="redo" size={14} /> Regenerate
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 md:grid-cols-[18rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
        {/* Controls */}
        <aside class="scrollbar-thin flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-line-strong bg-surface p-3 text-sm" aria-label="Generator options">
          {nameBased ? (
            <>
              <Field label="Namespace">
                <select class="select h-8 text-[13px]" value={prefs.namespace} onChange={(e) => update({ namespace: (e.currentTarget as HTMLSelectElement).value })} aria-label="Namespace">
                  {NAMESPACES.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} ({n.uuid.slice(0, 8)}...)
                    </option>
                  ))}
                  <option value="custom">Custom UUID...</option>
                </select>
                {prefs.namespace === 'custom' && (
                  <input class={'input mt-1.5 h-8 font-mono text-xs ' + (customNs && !isValidUuid(customNs) ? 'border-danger' : '')} value={customNs} onInput={(e) => setCustomNs((e.currentTarget as HTMLInputElement).value)} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" aria-label="Custom namespace UUID" spellcheck={false} />
                )}
              </Field>
              <Field label="Name">
                <input class="input h-8 text-xs" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} placeholder="www.example.com" aria-label="Name to hash" spellcheck={false} />
                <p class="mt-1 text-xs text-ink-3">The same namespace and name always produce the same UUID.</p>
              </Field>
            </>
          ) : (
            <Field label="How many">
              <div class="flex items-center gap-1.5">
                <input type="number" class="input h-8 w-24 font-mono text-xs" min={1} max={MAX_COUNT} value={prefs.count} onChange={(e) => setCount((e.currentTarget as HTMLInputElement).value)} aria-label="Count" />
                {[1, 10, 100, 1000].map((n) => (
                  <button key={n} type="button" class={'rounded-md border px-2 py-1 text-xs ' + (prefs.count === n ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong text-ink-2 hover:bg-surface-3')} onClick={() => setCount(n)}>
                    {n.toLocaleString()}
                  </button>
                ))}
              </div>
              <p class="mt-1 text-xs text-ink-3">Up to {MAX_COUNT.toLocaleString()} at once.</p>
            </Field>
          )}

          <Field label="Format">
            <div class="flex flex-wrap gap-1.5">
              <Chip on={prefs.uppercase} onClick={() => update({ uppercase: !prefs.uppercase })} title="A-F instead of a-f">
                Uppercase
              </Chip>
              <Chip on={prefs.removeHyphens} onClick={() => update({ removeHyphens: !prefs.removeHyphens })} title="32 hex digits with no separators">
                No hyphens
              </Chip>
              <Chip on={prefs.braces} onClick={() => update({ braces: !prefs.braces })} title="Wrap in { } like .NET and SQL Server">
                Braces
              </Chip>
              <Chip on={prefs.quotes} onClick={() => update({ quotes: !prefs.quotes })} title="Wrap each UUID in double quotes">
                Quotes
              </Chip>
              <Chip on={prefs.urn} onClick={() => update({ urn: !prefs.urn })} title="Prefix with urn:uuid:">
                URN
              </Chip>
            </div>
          </Field>

          <Field label="Separator">
            <Segmented
              value={prefs.separator}
              onChange={(separator) => update({ separator })}
              options={[
                { value: 'lines', label: 'Lines' },
                { value: 'comma', label: 'Comma' },
                { value: 'json', label: 'JSON array' },
              ]}
              label="Separator"
            />
          </Field>

          <div class="mt-auto flex gap-2">
            <button type="button" class="btn-primary btn-sm flex-1" onClick={() => void copy()} disabled={!output} title="Copy all (Ctrl+Shift+C)">
              <Icon name="copy" size={14} /> Copy all
            </button>
            <button type="button" class="btn-secondary btn-sm" onClick={download} disabled={!output} title="Download as a file">
              <Icon name="download" size={14} />
            </button>
          </div>
        </aside>

        {/* Output + inspector */}
        <div class="flex min-h-0 flex-col gap-2">
          <section class="flex h-[360px] min-h-[260px] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface md:h-auto md:flex-1" aria-label="Generated UUIDs">
            <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
              <span class="font-semibold text-ink">Generated</span>
              <span class="ml-2 text-ink-3">{uuids.length ? describe(prefs.version, uuids.length) : ''}</span>
              <span class="flex-1" />
              <HeaderButton icon="download" title="Download" onClick={download} disabled={!output} />
              <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copy()} disabled={!output} title="Copy all (Ctrl+Shift+C)">
                <Icon name="copy" size={13} /> Copy
              </button>
            </header>
            <CodeEditor value={output} readOnly wrap={false} placeholder="UUIDs appear here" ariaLabel="Generated UUIDs" class="flex-1" />
          </section>

          <section class="rounded-lg border border-line-strong bg-surface" aria-label="Inspect a UUID">
            <header class="flex h-9 items-center gap-2 border-b border-line bg-surface-2 px-3 text-xs">
              <Icon name="search" size={13} class="text-ink-3" />
              <span class="font-semibold text-ink">Inspect a UUID</span>
              <span class="text-ink-3">version, variant and embedded time</span>
            </header>
            <div class="p-3">
              <input class={'input h-8 font-mono text-xs ' + (parsed && !parsed.ok ? 'border-danger' : '')} value={inspect} onInput={(e) => setInspect((e.currentTarget as HTMLInputElement).value)} placeholder="Paste any UUID, GUID with braces, or urn:uuid:..." aria-label="UUID to inspect" spellcheck={false} />
              {parsed && !parsed.ok && (
                <p class="mt-2 flex items-center gap-1.5 text-xs text-danger">
                  <Icon name="alert-circle" size={13} /> {parsed.message}
                </p>
              )}
              {parsed && parsed.ok && (
                <dl class="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
                  <dt class="text-ink-3">Canonical</dt>
                  <dd class="font-mono text-ink">{parsed.value.uuid}</dd>
                  <dt class="text-ink-3">Version</dt>
                  <dd class="text-ink">
                    {parsed.value.version ? `${parsed.value.version} ` : ''}
                    <span class="text-ink-2">{parsed.value.versionLabel}</span>
                  </dd>
                  <dt class="text-ink-3">Variant</dt>
                  <dd class="text-ink">{parsed.value.variant}</dd>
                  {parsed.value.timestamp && (
                    <>
                      <dt class="text-ink-3">Timestamp</dt>
                      <dd class="font-mono text-ink">{Number.isFinite(parsed.value.timestamp.getTime()) ? parsed.value.timestamp.toISOString() : 'out of range'}</dd>
                    </>
                  )}
                  <dt class="text-ink-3">Valid</dt>
                  <dd class="flex items-center gap-1 text-success">
                    <Icon name="check" size={13} /> Well formed
                  </dd>
                </dl>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <div class="min-w-0">
          {error ? (
            <span class="flex min-w-0 items-center gap-1.5 text-danger">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate">{error}</span>
            </span>
          ) : uuids.length ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="check" size={13} class="text-success" /> Generated {describe(prefs.version, uuids.length)}
              {elapsed !== null && ` in ${elapsed < 1 ? '<1' : Math.round(elapsed)} ms`} with WebCrypto. Nothing leaves your browser.
            </span>
          ) : (
            <span class="text-ink-3">Generated locally with the Web Crypto API.</span>
          )}
        </div>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> regenerate
        </span>
      </div>
    </div>
  );
}

function Field(p: { label: string; children: preact.ComponentChildren }) {
  return (
    <div>
      <div class="mb-1 text-xs text-ink-2">{p.label}</div>
      {p.children}
    </div>
  );
}
