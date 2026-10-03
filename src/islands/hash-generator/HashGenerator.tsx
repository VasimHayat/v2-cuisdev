/**
 * Hash Generator workspace: hash text or a file with several algorithms at once,
 * optionally as HMAC, show the digests as hex or Base64 and compare against an
 * expected value. hash-wasm (WebAssembly) is loaded on first use; files are streamed.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  ALGORITHMS,
  ALGORITHM_IDS,
  DEFAULT_ALGORITHMS,
  HashError,
  MAX_FILE_BYTES,
  SAMPLE_TEXT,
  compareHash,
  formatBytes,
  formatDigest,
  hashBlob,
  hashText,
  isAlgorithmId,
  isHashWasmReady,
  tableToText,
  type AlgorithmId,
  type DigestTable,
} from './logic';

const TOOL = 'hash-generator';
const PREFS_KEY = 'cuis-hash:prefs';
type Mode = 'text' | 'file';

interface Prefs {
  algorithms: AlgorithmId[];
  uppercase: boolean;
  base64: boolean;
  hexInput: boolean;
}

const DEFAULT_PREFS: Prefs = { algorithms: [...DEFAULT_ALGORITHMS], uppercase: false, base64: false, hexInput: false };

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const p: Prefs = { ...DEFAULT_PREFS, algorithms: [...DEFAULT_ALGORITHMS] };
    if (Array.isArray(raw.algorithms)) {
      const ids = raw.algorithms.filter(isAlgorithmId);
      if (ids.length) p.algorithms = ids;
    }
    for (const k of ['uppercase', 'base64', 'hexInput'] as const) if (typeof raw[k] === 'boolean') p[k] = raw[k] as boolean;
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function HashGenerator() {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [hmacKey, setHmacKey] = useState('');
  const [expected, setExpected] = useState('');
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === 'undefined' ? DEFAULT_PREFS : loadPrefs()));
  const [table, setTable] = useState<DigestTable>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [loadingLib, setLoadingLib] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [full, setFull] = useState(false);
  const seq = useRef(0);

  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  // Ordered selection, in catalogue order
  const selected = useMemo(() => ALGORITHM_IDS.filter((id) => prefs.algorithms.includes(id)), [prefs.algorithms]);
  const allOn = selected.length === ALGORITHM_IDS.length;
  const hmac = hmacKey !== '';

  // Compute digests (debounced for text, immediate for files)
  useEffect(() => {
    const id = ++seq.current;
    const source = mode === 'text' ? text : file;
    if (!source || (mode === 'text' && text === '' && !prefs.hexInput) || selected.length === 0) {
      setTable({});
      setError(null);
      setBusy(null);
      setElapsed(null);
      return;
    }
    const t = setTimeout(
      async () => {
        if (!isHashWasmReady()) setLoadingLib(true);
        const t0 = performance.now();
        try {
          let result: DigestTable;
          if (mode === 'file' && file) {
            setBusy({ done: 0, total: file.size });
            result = await hashBlob(file, selected, { hmacKey }, (done) => {
              if (id === seq.current) setBusy({ done, total: file.size });
            });
          } else {
            result = await hashText(text, selected, { hmacKey, hexInput: prefs.hexInput });
          }
          if (id !== seq.current) return;
          setTable(result);
          setError(null);
          setElapsed(performance.now() - t0);
        } catch (err) {
          if (id !== seq.current) return;
          setTable({});
          setError(err instanceof HashError ? err.message : err instanceof Error ? err.message : String(err));
          setElapsed(null);
        } finally {
          if (id === seq.current) {
            setBusy(null);
            setLoadingLib(false);
          }
        }
      },
      mode === 'text' ? 150 : 0,
    );
    return () => clearTimeout(t);
  }, [mode, text, file, selected, hmacKey, prefs.hexInput]);

  const compare = useMemo(() => compareHash(expected, table), [expected, table]);
  const format = { uppercase: prefs.uppercase, base64: prefs.base64 };
  const hasResults = selected.some((id) => table[id]);

  // ------------------------------------------------------------------ actions

  const toggleAlgo = (id: AlgorithmId) => {
    const next = prefs.algorithms.includes(id) ? prefs.algorithms.filter((a) => a !== id) : [...prefs.algorithms, id];
    update({ algorithms: next });
  };
  const toggleAll = () => update({ algorithms: allOn ? [...DEFAULT_ALGORITHMS] : [...ALGORITHM_IDS] });

  const copyAll = async () => {
    const out = tableToText(table, selected, format, hmac);
    if (!out) return;
    const ok = await copyText(out);
    toast(ok ? 'All digests copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy_all', count: selected.length });
  };
  const copyOne = async (id: AlgorithmId) => {
    const d = table[id];
    if (!d) return;
    const ok = await copyText(formatDigest(d, format));
    toast(ok ? `${id.toUpperCase()} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', algorithm: id });
  };
  const download = () => {
    const out = tableToText(table, selected, format, hmac);
    if (!out) return;
    const name = mode === 'file' && file ? `${file.name}.hashes.txt` : 'hashes.txt';
    downloadText(`${mode === 'file' && file ? `# ${file.name} (${formatBytes(file.size)})\n` : ''}${out}\n`, name);
    track('tool_action', { tool: TOOL, action: 'download' });
  };
  const loadSample = () => {
    setMode('text');
    setFile(null);
    setText(SAMPLE_TEXT);
    update({ hexInput: false });
    track('tool_action', { tool: TOOL, action: 'sample' });
  };
  const clear = () => {
    setText('');
    setFile(null);
    setExpected('');
    setHmacKey('');
  };
  const openFile = (f: File) => {
    if (f.size > MAX_FILE_BYTES) {
      toast(`File is larger than ${formatBytes(MAX_FILE_BYTES)}`, 'error');
      return;
    }
    setMode('file');
    setFile(f);
    track('tool_action', { tool: TOOL, action: 'open_file', bytes: f.size });
  };

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copyAll();
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

  const inputBytes = useMemo(() => (mode === 'text' ? new TextEncoder().encode(text).length : (file?.size ?? 0)), [mode, text, file]);

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen overflow-auto p-2' : 'relative min-h-[560px] lg:h-[min(80vh,880px)] rounded-xl border border-line-strong p-2 shadow-sm')}
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
        if (f) openFile(f);
      }}
    >
      <input
        ref={fileRef}
        type="file"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) openFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={mode}
          onChange={(m) => {
            setMode(m);
            if (m === 'file' && !file) fileRef.current?.click();
          }}
          options={[
            { value: 'text', label: 'Text', icon: 'align-left' },
            { value: 'file', label: 'File', icon: 'file-check' },
          ]}
          label="Input type"
        />
        <div class="flex items-center gap-1.5">
          <Chip on={prefs.uppercase && !prefs.base64} onClick={() => update({ uppercase: !prefs.uppercase, base64: false })} title="Upper-case hex digits">
            Uppercase
          </Chip>
          <Chip on={prefs.base64} onClick={() => update({ base64: !prefs.base64 })} title="Show digests as Base64 instead of hex">
            Base64
          </Chip>
          {mode === 'text' && (
            <Chip on={prefs.hexInput} onClick={() => update({ hexInput: !prefs.hexInput })} title="Interpret the input as hex-encoded bytes instead of UTF-8 text">
              Input is hex bytes
            </Chip>
          )}
        </div>
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">HMAC key</span>
          <input
            class="input h-8 w-40 font-mono text-xs"
            value={hmacKey}
            onInput={(e) => setHmacKey((e.currentTarget as HTMLInputElement).value)}
            placeholder="optional secret"
            autocomplete="off"
            spellcheck={false}
            aria-label="HMAC key"
          />
        </label>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={clear} disabled={!text && !file && !expected && !hmacKey} title="Clear input, key and comparison">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      <div class="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* Input */}
        <section
          class={'flex h-[360px] min-h-[260px] flex-col overflow-hidden rounded-lg border bg-surface transition-colors lg:h-auto ' + (dragOver ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-line-strong')}
          aria-label="Input"
        >
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{mode === 'text' ? (prefs.hexInput ? 'Hex bytes' : 'Text') : 'File'}</span>
            <span class="ml-2 truncate text-ink-3">{mode === 'file' && file ? `${file.name} · ${formatBytes(file.size)}` : inputBytes ? formatBytes(inputBytes) : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="folder-open" title="Hash a file" onClick={() => fileRef.current?.click()} />
          </header>
          {mode === 'text' ? (
            <CodeEditor value={text} onChange={setText} wrap placeholder={prefs.hexInput ? 'Paste hex bytes, e.g. 48 65 6c 6c 6f' : 'Type or paste text to hash. Drop a file anywhere to hash it instead.'} ariaLabel="Text to hash" class="flex-1" onDropFile={openFile} />
          ) : (
            <div class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
              {file ? (
                <>
                  <Icon name="file-check" size={28} class={busy ? 'text-ink-3' : 'text-success'} />
                  <p>
                    <span class="font-medium text-ink">{file.name}</span>
                    <br />
                    <span class="text-xs text-ink-3">
                      {formatBytes(file.size)}
                      {file.type ? ` · ${file.type}` : ''}
                    </span>
                  </p>
                  {busy && (
                    <div class="w-56">
                      <div class="h-1.5 overflow-hidden rounded-full bg-line">
                        <div class="h-full bg-brand-600 transition-[width]" style={{ width: `${busy.total ? Math.round((busy.done / busy.total) * 100) : 100}%` }} />
                      </div>
                      <p class="mt-1 text-xs text-ink-3">
                        Hashing {formatBytes(busy.done)} of {formatBytes(busy.total)}
                      </p>
                    </div>
                  )}
                  <div class="flex gap-2">
                    <button type="button" class="btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                      <Icon name="folder-open" size={14} /> Choose another
                    </button>
                    <button type="button" class="btn-ghost btn-sm" onClick={() => setFile(null)}>
                      Remove
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span class="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                    <Icon name="upload" size={26} />
                  </span>
                  <p class="font-medium">Drop a file here, or</p>
                  <button type="button" class="btn-primary btn-sm" onClick={() => fileRef.current?.click()}>
                    <Icon name="folder-open" size={14} /> Choose a file
                  </button>
                  <p class="text-xs text-ink-3">Up to {formatBytes(MAX_FILE_BYTES)}, streamed in chunks. Nothing is uploaded.</p>
                </>
              )}
            </div>
          )}
          <div class="border-t border-line p-2">
            <div class="mb-1.5 flex items-center justify-between text-[11px] uppercase tracking-wide text-ink-3">
              <span>Algorithms</span>
              <button type="button" class="text-brand-600 hover:underline dark:text-brand-400" onClick={toggleAll}>
                {allOn ? 'Default set' : 'All'}
              </button>
            </div>
            <div class="flex flex-wrap gap-1" role="group" aria-label="Algorithms">
              {ALGORITHMS.map((a) => (
                <Chip key={a.id} on={prefs.algorithms.includes(a.id)} onClick={() => toggleAlgo(a.id)} title={a.note}>
                  {a.label}
                </Chip>
              ))}
            </div>
          </div>
        </section>

        {/* Results */}
        <section class="flex min-h-[260px] flex-col overflow-hidden rounded-lg border border-line-strong bg-surface max-lg:max-h-[640px]" aria-label="Digests">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{hmac ? 'HMAC digests' : 'Digests'}</span>
            <span class="ml-2 text-ink-3">{hasResults ? `${selected.filter((id) => table[id]).length} of ${selected.length}` : ''}</span>
            {(busy || loadingLib) && <Icon name="loader" size={13} class="ml-2 animate-spin text-ink-3" />}
            <span class="flex-1" />
            <HeaderButton icon="download" title="Download as text" onClick={download} disabled={!hasResults} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copyAll()} disabled={!hasResults} title="Copy all digests (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy all
            </button>
          </header>

          <div class="scrollbar-thin min-h-0 flex-1 overflow-auto">
            {selected.length === 0 ? (
              <p class="p-4 text-sm text-ink-3">Pick at least one algorithm.</p>
            ) : (
              <table class="w-full text-left text-[13px]">
                <tbody>
                  {selected.map((id) => {
                    const algo = ALGORITHMS.find((a) => a.id === id)!;
                    const digest = table[id];
                    const matched = compare.status === 'match' && compare.algorithm === id;
                    return (
                      <tr key={id} class={'border-b border-line align-top last:border-b-0 ' + (matched ? 'bg-success/10' : '')}>
                        <th scope="row" class="w-[7.5rem] px-3 py-2 text-xs font-medium text-ink">
                          {hmac && algo.hmac && <span class="text-ink-3">HMAC-</span>}
                          {algo.label}
                          <div class="mt-0.5 flex flex-wrap items-center gap-1">
                            <span class="text-[11px] font-normal text-ink-3">{algo.bits} bit</span>
                            <span class={'badge ' + (algo.security === 'broken' ? 'border-danger/40 bg-danger/10 text-danger' : algo.security === 'checksum' ? 'border-line-strong text-ink-3' : 'border-success/40 bg-success/10 text-success')}>{algo.security === 'broken' ? 'broken' : algo.security === 'checksum' ? 'checksum' : 'secure'}</span>
                          </div>
                        </th>
                        <td class="px-2 py-2">
                          {digest === null ? (
                            <span class="text-xs text-ink-3">Not available as HMAC</span>
                          ) : digest === undefined ? (
                            <span class="text-xs text-ink-3">{busy || loadingLib ? 'Computing…' : '–'}</span>
                          ) : (
                            <div class="flex items-start gap-1">
                              <code class="min-w-0 flex-1 break-all font-mono text-[12px] leading-5 text-ink">{formatDigest(digest, format)}</code>
                              <HeaderButton icon="copy" title={`Copy ${algo.label}`} onClick={() => void copyOne(id)} />
                            </div>
                          )}
                          {matched && (
                            <span class="mt-1 inline-flex items-center gap-1 text-xs text-success">
                              <Icon name="check" size={12} /> Matches the expected hash
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Compare */}
          <div class="border-t border-line p-2">
            <label class="block text-xs text-ink-2">
              <span class="mb-1 block">Compare with an expected hash</span>
              <input
                class={'input h-8 font-mono text-xs ' + (compare.status === 'match' ? 'border-success' : compare.status === 'no-match' ? 'border-danger' : '')}
                value={expected}
                onInput={(e) => setExpected((e.currentTarget as HTMLInputElement).value)}
                placeholder="Paste a checksum from a download page, hex or Base64"
                autocomplete="off"
                spellcheck={false}
                aria-label="Expected hash"
              />
            </label>
            {compare.status === 'match' && (
              <p class="mt-1 flex items-center gap-1 text-xs text-success">
                <Icon name="check" size={13} /> Match: {compare.label}
              </p>
            )}
            {compare.status === 'no-match' && hasResults && (
              <p class="mt-1 flex items-center gap-1 text-xs text-danger">
                <Icon name="x" size={13} /> No algorithm matched. Check the input, the key, or whether the checksum uses another algorithm.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <div class="min-w-0">
          {error ? (
            <span class="flex min-w-0 items-center gap-1.5 text-danger">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate">{error}</span>
            </span>
          ) : loadingLib ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="loader" size={13} class="animate-spin" /> Loading hash engine (first use only)
            </span>
          ) : hasResults ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="check" size={13} class="text-success" />
              Hashed {formatBytes(inputBytes)}
              {elapsed !== null && ` in ${elapsed < 1 ? '<1' : Math.round(elapsed)} ms`}
              {hmac && ' · keyed with HMAC'}
            </span>
          ) : (
            <span class="text-ink-3">Hashing runs in your browser with WebAssembly. Nothing is uploaded.</span>
          )}
        </div>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy all
        </span>
      </div>
    </div>
  );
}
