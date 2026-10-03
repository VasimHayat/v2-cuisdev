/**
 * Encoder / decoder workspace shared by the Base64, URL and HTML entity pages. The
 * page passes `kind`; the island offers Encode and Decode with the options that make
 * sense for that codec, live as you type. Base64 also accepts files and can download
 * decoded binary.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, formatBytes, toast, track } from '../shared/toast';
import { Base64Error, base64ToBytes, bytesToBase64, dataUrlMime, decodeText, encodeText, looksLikeBase64, sniffType, toDataUrl } from './base64';
import { UrlEncodeError, looksEncoded, parseUrl, urlDecode, urlEncode, type ParsedUrl, type UrlMode } from './url';
import { HtmlEntityError, countEntities, entityDecode, entityEncode, findUnknownEntities, hasEntities, type EntityMode } from './entities';

export type CodecKind = 'base64' | 'url' | 'entities';
type Direction = 'encode' | 'decode';

interface Props {
  kind?: CodecKind;
}

interface Prefs {
  urlSafe: boolean;
  wrap: boolean;
  dataUrl: boolean;
  urlMode: UrlMode;
  untilStable: boolean;
  entityMode: EntityMode;
}

const DEFAULT_PREFS: Prefs = { urlSafe: false, wrap: false, dataUrl: false, urlMode: 'component', untilStable: true, entityMode: 'essential' };
const PREFS_KEY = 'cuis-codec:prefs';
const MAX_FILE = 10 * 1024 * 1024;

const LABELS: Record<CodecKind, { tool: string; name: string; encodeTitle: string; decodeTitle: string; placeholderEncode: string; placeholderDecode: string }> = {
  base64: { tool: 'base64-encode-decode', name: 'Base64', encodeTitle: 'Base64', decodeTitle: 'Decoded text', placeholderEncode: 'Paste text to encode, or drop a file onto this pane', placeholderDecode: 'Paste Base64 to decode (data: URLs and URL-safe input are fine)' },
  url: { tool: 'url-encode-decode', name: 'URL', encodeTitle: 'Encoded', decodeTitle: 'Decoded', placeholderEncode: 'Paste a URL, a query value or any text to percent-encode', placeholderDecode: 'Paste a percent-encoded URL or string to decode' },
  entities: { tool: 'html-entity-encoder', name: 'HTML entities', encodeTitle: 'Escaped HTML', decodeTitle: 'Decoded text', placeholderEncode: 'Paste text or markup to escape for HTML', placeholderDecode: 'Paste HTML with entities such as &amp; &lt; &#169; to decode' },
};

const SAMPLES: Record<CodecKind, Record<Direction, string>> = {
  base64: {
    encode: 'Hello, Cuisdev! Base64 turns bytes into text: ünïcödé ✓ 🚀',
    decode: 'SGVsbG8sIEN1aXNkZXYhIEJhc2U2NCB0dXJucyBieXRlcyBpbnRvIHRleHQ6IMO8bsOvY8O2ZMOpIOKckyDwn5qA',
  },
  url: {
    encode: 'https://example.com/search results?q=café & crème brûlée&page=2#top',
    decode: 'https://example.com/search%20results?q=caf%C3%A9%20%26%20cr%C3%A8me%20br%C3%BBl%C3%A9e&page=2#top',
  },
  entities: {
    encode: '<a href="/docs?x=1&y=2">Tom & Jerry\'s "Guide" — © 2026 • 5 € ≥ 4 £</a>',
    decode: '&lt;a href=&quot;/docs?x=1&amp;y=2&quot;&gt;Tom &amp; Jerry&#39;s &quot;Guide&quot; &mdash; &copy; 2026 &bull; 5 &euro; &ge; 4 &pound;&lt;/a&gt;',
  },
};

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const p = { ...DEFAULT_PREFS };
    for (const k of ['urlSafe', 'wrap', 'dataUrl', 'untilStable'] as const) if (typeof raw[k] === 'boolean') p[k] = raw[k] as boolean;
    if (raw.urlMode === 'component' || raw.urlMode === 'full' || raw.urlMode === 'form') p.urlMode = raw.urlMode;
    if (raw.entityMode === 'essential' || raw.entityMode === 'non-ascii' || raw.entityMode === 'decimal' || raw.entityMode === 'hex') p.entityMode = raw.entityMode;
    return p;
  } catch {
    return DEFAULT_PREFS;
  }
}

interface Result {
  output: string;
  summary: string;
  note?: string;
  /** Decoded binary for Base64 when the bytes are not text. */
  binary?: { bytes: Uint8Array; ext: string; mime: string };
  url?: ParsedUrl | null;
}

export default function Codec({ kind = 'base64' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const L = LABELS[kind];
  const [direction, setDirection] = useState<Direction>('encode');
  const [input, setInput] = useState('');
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; mime: string } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === 'undefined' ? DEFAULT_PREFS : loadPrefs()));
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ message: string; offset?: number } | null>(null);
  const [wrapLines, setWrapLines] = useState(true);
  const [full, setFull] = useState(false);
  const update = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  // Run the codec, debounced
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (kind === 'base64' && direction === 'encode' && file) {
          const b64 = prefs.dataUrl ? toDataUrl(file.bytes, file.mime) : bytesToBase64(file.bytes, { urlSafe: prefs.urlSafe, wrapAt: prefs.wrap ? 76 : 0 });
          setResult({ output: b64, summary: `${file.name} · ${formatBytes(file.bytes.length)} → ${formatBytes(b64.length)}` });
          setError(null);
          return;
        }
        if (input === '') {
          setResult(null);
          setError(null);
          return;
        }
        setResult(run(kind, direction, input, prefs));
        setError(null);
      } catch (err) {
        setResult(null);
        const offset = err instanceof UrlEncodeError ? err.offset : undefined;
        setError({ message: err instanceof Error ? err.message : String(err), offset });
      }
    }, 120);
    return () => clearTimeout(t);
  }, [kind, direction, input, file, prefs]);

  const output = result?.output ?? '';

  // ------------------------------------------------------------------ actions

  const swap = () => {
    const next: Direction = direction === 'encode' ? 'decode' : 'encode';
    setDirection(next);
    setFile(null);
    if (output && !result?.binary) setInput(output);
    track('tool_action', { tool: L.tool, action: 'swap', direction: next });
  };

  const copy = async () => {
    if (!output) return;
    const ok = await copyText(output);
    toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: L.tool, action: 'copy', direction });
  };

  const download = () => {
    if (result?.binary) {
      const blob = new Blob([result.binary.bytes as BlobPart], { type: result.binary.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `decoded.${result.binary.ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } else if (output) downloadText(output, direction === 'encode' ? `${kind === 'base64' ? 'encoded.b64.txt' : 'encoded.txt'}` : 'decoded.txt');
    track('tool_action', { tool: L.tool, action: 'download', direction });
  };

  const loadSample = () => {
    setFile(null);
    setInput(SAMPLES[kind][direction]);
    track('tool_action', { tool: L.tool, action: 'sample' });
  };

  const openFile = async (f: File) => {
    if (f.size > MAX_FILE) {
      toast(`File is larger than ${formatBytes(MAX_FILE)}`, 'error');
      return;
    }
    if (kind === 'base64') {
      const bytes = new Uint8Array(await f.arrayBuffer());
      setDirection('encode');
      setFile({ name: f.name, bytes, mime: f.type || sniffType(bytes).mime });
      setInput('');
      toast(`Encoding ${f.name}`);
    } else {
      setInput(await f.text());
      toast(`Opened ${f.name}`);
    }
    track('tool_action', { tool: L.tool, action: 'open_file' });
  };

  const onPaste = (text: string, info: { wasEmpty: boolean }) => {
    if (!info.wasEmpty || direction === 'decode') return;
    const encoded = kind === 'base64' ? looksLikeBase64(text) : kind === 'url' ? looksEncoded(text) && !/\s/.test(text.trim()) : hasEntities(text);
    if (encoded) {
      setDirection('decode');
      toast(`Looks encoded, switched to Decode`);
    }
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
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

  const inputTitle = direction === 'encode' ? (kind === 'entities' ? 'Text' : 'Plain text') : kind === 'base64' ? 'Base64' : kind === 'url' ? 'Encoded' : 'HTML with entities';
  const outputTitle = direction === 'encode' ? L.encodeTitle : L.decodeTitle;
  const inputBytes = useMemo(() => new TextEncoder().encode(input).length, [input]);
  const parsedUrl = result?.url;

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(72vh,760px)] min-h-[520px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      <input
        ref={fileRef}
        type="file"
        class="hidden"
        onChange={(e) => {
          const f = (e.currentTarget as HTMLInputElement).files?.[0];
          if (f) void openFile(f);
          (e.currentTarget as HTMLInputElement).value = '';
        }}
      />

      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={direction}
          onChange={(d) => {
            setDirection(d);
            setFile(null);
          }}
          options={[
            { value: 'encode', label: 'Encode', icon: 'lock' },
            { value: 'decode', label: 'Decode', icon: 'eye' },
          ]}
          label="Direction"
        />

        {kind === 'base64' && direction === 'encode' && (
          <div class="flex items-center gap-1.5">
            <Chip on={prefs.urlSafe && !prefs.dataUrl} onClick={() => update({ urlSafe: !prefs.urlSafe, dataUrl: false })} title="Use - and _ instead of + and /, with no = padding (JWT, URLs)">
              URL-safe
            </Chip>
            <Chip on={prefs.wrap && !prefs.dataUrl} onClick={() => update({ wrap: !prefs.wrap, dataUrl: false })} title="Break lines every 76 characters (MIME)">
              Wrap at 76
            </Chip>
            <Chip on={prefs.dataUrl} onClick={() => update({ dataUrl: !prefs.dataUrl })} title="Prefix with data:<type>;base64, for use in src or CSS url()">
              Data URL
            </Chip>
          </div>
        )}

        {kind === 'url' && (
          <>
            <label class="flex items-center gap-2 text-xs text-ink-2">
              <span class="hidden sm:inline">Mode</span>
              <select class="select h-8 w-auto text-[13px]" value={prefs.urlMode} onChange={(e) => update({ urlMode: (e.currentTarget as HTMLSelectElement).value as UrlMode })} aria-label="Encoding mode">
                <option value="component">Component (encodeURIComponent)</option>
                <option value="full">Whole URL (encodeURI)</option>
                <option value="form">Form data (+ for spaces)</option>
              </select>
            </label>
            {direction === 'decode' && (
              <Chip on={prefs.untilStable} onClick={() => update({ untilStable: !prefs.untilStable })} title="Keep decoding while the text still changes (double-encoded input)">
                Decode repeatedly
              </Chip>
            )}
          </>
        )}

        {kind === 'entities' && direction === 'encode' && (
          <label class="flex items-center gap-2 text-xs text-ink-2">
            <span class="hidden sm:inline">Escape</span>
            <select class="select h-8 w-auto text-[13px]" value={prefs.entityMode} onChange={(e) => update({ entityMode: (e.currentTarget as HTMLSelectElement).value as EntityMode })} aria-label="Escape mode">
              <option value="essential">Only &amp; &lt; &gt; " ' (safe HTML)</option>
              <option value="non-ascii">Also non-ASCII, named where possible</option>
              <option value="decimal">Everything as decimal &amp;#NNN;</option>
              <option value="hex">Everything as hex &amp;#xHH;</option>
            </select>
          </label>
        )}

        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button
            type="button"
            class="btn-ghost btn-sm"
            onClick={() => {
              setInput('');
              setFile(null);
            }}
            disabled={!input && !file}
            title="Clear the input"
          >
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Panes */}
      <div class="grid min-h-0 flex-1 gap-2 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-rows-1">
        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Input">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{inputTitle}</span>
            <span class="ml-2 truncate text-ink-3">{file ? `${file.name} · ${formatBytes(file.bytes.length)}` : input ? formatBytes(inputBytes) : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="folder-open" title={kind === 'base64' ? 'Encode a file' : 'Open a text file'} onClick={() => fileRef.current?.click()} />
          </header>
          {file ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-2">
              <Icon name="file-check" size={28} class="text-success" />
              <p>
                <span class="font-medium text-ink">{file.name}</span> ({file.mime || 'unknown type'}) is being encoded.
              </p>
              <button type="button" class="btn-secondary btn-sm" onClick={() => setFile(null)}>
                Encode text instead
              </button>
            </div>
          ) : (
            <CodeEditor
              value={input}
              onChange={setInput}
              wrap={wrapLines}
              placeholder={direction === 'encode' ? L.placeholderEncode : L.placeholderDecode}
              error={error && error.offset !== undefined && error.offset >= 0 ? { offset: error.offset, message: error.message } : null}
              ariaLabel={`${inputTitle} input`}
              class="flex-1"
              onDropFile={(f) => void openFile(f)}
              onPaste={onPaste}
            />
          )}
        </section>

        <div class="flex items-center justify-center md:flex-col">
          <button type="button" class="btn-secondary btn-icon h-9 w-9" onClick={swap} title={`Switch to ${direction === 'encode' ? 'Decode' : 'Encode'} and use the output as input`} aria-label="Swap direction">
            <Icon name="arrow-left-right" size={16} class="md:rotate-0" />
          </button>
        </div>

        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Output">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{outputTitle}</span>
            <span class="ml-2 truncate text-ink-3">{result?.summary ?? ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={wrapLines ? 'Disable line wrap' : 'Wrap long lines'} active={wrapLines} onClick={() => setWrapLines((w) => !w)} />
            <HeaderButton icon="download" title={result?.binary ? `Download decoded.${result.binary.ext}` : 'Download as text'} onClick={download} disabled={!output && !result?.binary} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copy()} disabled={!output} title="Copy output (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy
            </button>
          </header>
          {result?.binary ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-2">
              <Icon name="file-image" size={28} class="text-ink-3" />
              <p>
                Decoded {formatBytes(result.binary.bytes.length)} of binary data ({result.binary.mime}).
                {result.binary.mime.startsWith('image/') && <img src={URL.createObjectURL(new Blob([result.binary.bytes as BlobPart], { type: result.binary.mime }))} alt="Decoded preview" class="mx-auto mt-3 max-h-40 rounded border border-line" />}
              </p>
              <button type="button" class="btn-primary btn-sm" onClick={download}>
                <Icon name="download" size={14} /> Download decoded.{result.binary.ext}
              </button>
            </div>
          ) : (
            <CodeEditor value={output} readOnly wrap={wrapLines} placeholder="Output appears here as you type" ariaLabel={`${outputTitle} output`} class="flex-1" />
          )}
        </section>
      </div>

      {/* URL breakdown */}
      {kind === 'url' && parsedUrl && (
        <div class="mt-2 grid gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-xs sm:grid-cols-2" aria-label="URL parts">
          <Part label="Protocol" value={parsedUrl.protocol} />
          <Part label="Host" value={parsedUrl.host + (parsedUrl.port ? `:${parsedUrl.port}` : '')} />
          <Part label="Path" value={parsedUrl.path} />
          {parsedUrl.hash && <Part label="Fragment" value={parsedUrl.hash} />}
          {parsedUrl.username && <Part label="User" value={parsedUrl.username} />}
          {parsedUrl.query.length > 0 && (
            <div class="sm:col-span-2">
              <span class="text-ink-3">Query</span>
              <ul class="mt-0.5 grid gap-x-4 gap-y-0.5 font-mono sm:grid-cols-2">
                {parsedUrl.query.map((q, i) => (
                  <li key={i} class="truncate">
                    <span class="text-brand-600 dark:text-brand-400">{q.key}</span> = <span class="text-ink">{q.value || <span class="text-ink-3">(empty)</span>}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <div class="min-w-0">
          {error ? (
            <span class="flex min-w-0 items-center gap-1.5 text-danger">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate">{error.message}</span>
            </span>
          ) : result?.note ? (
            <span class="flex min-w-0 items-center gap-1.5 text-warning">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate">{result.note}</span>
            </span>
          ) : result ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="check" size={13} class="text-success" /> {direction === 'encode' ? 'Encoded' : 'Decoded'} · {result.summary}
            </span>
          ) : (
            <span class="text-ink-3">Nothing leaves your browser. Paste to begin.</span>
          )}
        </div>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy output
        </span>
      </div>
    </div>
  );
}

function Part({ label, value }: { label: string; value: string }) {
  return (
    <div class="flex min-w-0 gap-2">
      <span class="w-16 shrink-0 text-ink-3">{label}</span>
      <span class="truncate font-mono text-ink" title={value}>
        {value || <span class="text-ink-3">(none)</span>}
      </span>
    </div>
  );
}

/** Run the selected codec. Throws Base64Error, UrlEncodeError or HtmlEntityError. */
export function run(kind: CodecKind, direction: Direction, input: string, prefs: Prefs): Result {
  const bytesOf = (s: string) => new TextEncoder().encode(s).length;
  if (kind === 'base64') {
    if (direction === 'encode') {
      const output = prefs.dataUrl ? toDataUrl(new TextEncoder().encode(input), 'text/plain;charset=utf-8') : encodeText(input, { urlSafe: prefs.urlSafe, wrapAt: prefs.wrap ? 76 : 0 });
      return { output, summary: `${formatBytes(bytesOf(input))} → ${formatBytes(output.length)} (+${Math.round((output.length / Math.max(1, bytesOf(input)) - 1) * 100)}%)` };
    }
    const bytes = base64ToBytes(input);
    const mime = dataUrlMime(input);
    try {
      const text = decodeText(input);
      if (mime && !mime.startsWith('text/') && mime !== 'application/json' && !mime.includes('xml') && !mime.includes('javascript')) throw new Base64Error('binary');
      return { output: text, summary: `${formatBytes(input.replace(/\s+/g, '').length)} → ${formatBytes(bytes.length)}${mime ? ` · ${mime}` : ''}` };
    } catch {
      const sniffed = sniffType(bytes);
      const type = mime ? { mime, ext: mime.split('/')[1]?.split('+')[0] ?? sniffed.ext } : sniffed;
      return { output: '', summary: `${formatBytes(bytes.length)} of ${type.mime}`, binary: { bytes, ...type }, note: 'The decoded bytes are not text. Download them as a file.' };
    }
  }
  if (kind === 'url') {
    if (direction === 'encode') {
      const output = urlEncode(input, prefs.urlMode);
      return { output, summary: `${input.length} → ${output.length} chars`, url: parseUrl(input) ?? parseUrl(output) };
    }
    const { text, passes } = urlDecode(input, prefs.urlMode, prefs.untilStable);
    const note = passes > 1 ? `The input was encoded ${passes} times; all layers were removed.` : passes === 0 ? 'Nothing to decode: the input contains no percent-escapes.' : undefined;
    return { output: text, summary: `${input.length} → ${text.length} chars${passes > 1 ? ` · ${passes} passes` : ''}`, note, url: parseUrl(text) };
  }
  if (direction === 'encode') {
    const output = entityEncode(input, prefs.entityMode);
    const n = countEntities(output);
    return { output, summary: `${n.toLocaleString()} ${n === 1 ? 'entity' : 'entities'} written` };
  }
  const output = entityDecode(input);
  const unknown = findUnknownEntities(input);
  const n = countEntities(input) - unknown.length;
  return { output, summary: `${Math.max(0, n).toLocaleString()} ${n === 1 ? 'entity' : 'entities'} decoded`, note: unknown.length ? `Unknown entities left as-is: ${unknown.slice(0, 5).join(' ')}${unknown.length > 5 ? ` and ${unknown.length - 5} more` : ''}` : undefined };
}

export { HtmlEntityError };
