/**
 * API Request Tester: build a request (params, headers, body, auth), send it with fetch
 * straight from the browser, and inspect the status, timing, headers and body. Requests
 * never pass through Cuisdev. Blocked cross-origin responses are explained, with a cURL
 * command to run instead. Auth values stay in memory unless the user opts in.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Extension } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { xml } from '@codemirror/lang-xml';
import { javascript } from '@codemirror/lang-javascript';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, formatBytes, toast, track } from '../shared/toast';
import {
  COMMON_HEADERS,
  CurlParseError,
  FAILURE_TEXT,
  METHODS,
  SAMPLES,
  bodyKind,
  buildUrl,
  classifyFailure,
  emptyRequest,
  forbiddenHeaders,
  formatDuration,
  formatSize,
  hasBody,
  isMethod,
  parseCurl,
  prettyJson,
  pushHistory,
  resolveRequest,
  sanitizeSpec,
  splitUrl,
  statusClass,
  stripSecrets,
  toCurl,
  toFetch,
  toPython,
  validateJson,
  validateUrl,
  type AuthMode,
  type BodyKind,
  type BodyMode,
  type FailureKind,
  type HistoryEntry,
  type KV,
  type Method,
  type RequestSpec,
} from './logic';

const TOOL = 'api-request-tester';
const DRAFT_KEY = 'cuis-api:draft';
const HISTORY_KEY = 'cuis-api:history';
const PREFS_KEY = 'cuis-api:prefs';
const MAX_DISPLAY = 2 * 1024 * 1024;
const TIMEOUTS = [5, 10, 30, 60, 120];

type ReqTab = 'params' | 'headers' | 'body' | 'auth';
type ResTab = 'body' | 'headers';
type View = 'pretty' | 'raw' | 'preview';
type ExportLang = 'curl' | 'fetch' | 'python';

interface Prefs {
  timeout: number;
  rememberAuth: boolean;
}

interface ResponseState {
  status: number;
  statusText: string;
  ms: number;
  bytes: number;
  headers: [string, string][];
  contentType: string;
  kind: BodyKind;
  text: string;
  blob: Blob;
  redirected: boolean;
  finalUrl: string;
}

interface Failure {
  kind: FailureKind;
  message: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function loadPrefs(): Prefs {
  const p = read<Partial<Prefs>>(PREFS_KEY, {});
  return {
    timeout: typeof p.timeout === 'number' && TIMEOUTS.includes(p.timeout) ? p.timeout : 30,
    rememberAuth: p.rememberAuth === true,
  };
}

function loadHistory(): HistoryEntry[] {
  const list = read<unknown>(HISTORY_KEY, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((e): e is HistoryEntry => !!e && typeof e === 'object' && typeof (e as HistoryEntry).url === 'string' && isMethod((e as HistoryEntry).method))
    .slice(0, 20)
    .map((e) => ({ ...e, spec: stripSecrets(sanitizeSpec(e.spec)) }));
}

function langFor(kind: BodyKind): Extension | null {
  if (kind === 'json') return json();
  if (kind === 'html') return html();
  if (kind === 'xml') return xml();
  return null;
}

const STATUS_TONE: Record<ReturnType<typeof statusClass>, string> = {
  info: 'border-line-strong bg-surface-3 text-ink-2',
  success: 'border-success/40 bg-success/10 text-success',
  redirect: 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-200',
  client: 'border-warning/50 bg-warning/10 text-ink',
  server: 'border-danger/40 bg-danger/10 text-danger',
  unknown: 'border-line-strong bg-surface-3 text-ink-2',
};

export default function ApiRequestTester() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [spec, setSpec] = useState<RequestSpec>(() => {
    const d = read<unknown>(DRAFT_KEY, null);
    return d ? sanitizeSpec(d) : { ...SAMPLES[0]!.spec };
  });
  const [urlText, setUrlText] = useState(() => buildUrl(splitUrl(spec.url).base, spec.params, splitUrl(spec.url).hash));
  const [reqTab, setReqTab] = useState<ReqTab>('params');
  const [resTab, setResTab] = useState<ResTab>('body');
  const [view, setView] = useState<View>('pretty');
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [response, setResponse] = useState<ResponseState | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [dialog, setDialog] = useState<null | 'import' | 'export'>(null);
  const [menu, setMenu] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [full, setFull] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const previewUrl = useRef<string | null>(null);

  const update = (patch: Partial<RequestSpec>) => setSpec((s) => ({ ...s, ...patch }));

  // Persist the draft without secrets unless the user opted in.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(prefs.rememberAuth ? spec : stripSecrets(spec)));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [spec, prefs.rememberAuth]);
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {}
  }, [history]);

  // URL text <-> params table
  const onUrlInput = (text: string) => {
    setUrlText(text);
    const { base, params, hash } = splitUrl(text);
    setSpec((s) => ({ ...s, url: base + hash, params: [...params, ...s.params.filter((p) => !p.enabled)] }));
  };
  const setParams = (params: KV[]) => {
    const { base, hash } = splitUrl(spec.url);
    setSpec((s) => ({ ...s, params }));
    setUrlText(buildUrl(base, params, hash));
  };
  const loadSpec = (next: RequestSpec) => {
    setSpec(next);
    const { base, hash } = splitUrl(next.url);
    setUrlText(buildUrl(base, next.params, hash));
    setResponse(null);
    setFailure(null);
  };

  const urlError = urlText.trim() ? validateUrl(urlText) : null;
  const jsonError = spec.bodyMode === 'json' && hasBody(spec.method) ? validateJson(spec.json) : null;
  const dropped = useMemo(() => forbiddenHeaders(spec.headers), [spec.headers]);
  const curlCommand = useMemo(() => {
    try {
      return toCurl(spec);
    } catch {
      return '';
    }
  }, [spec]);

  // ------------------------------------------------------------------ send

  const send = async () => {
    if (sending) {
      abortRef.current?.abort();
      return;
    }
    const err = validateUrl(urlText);
    if (err) {
      toast(err, 'error');
      return;
    }
    if (jsonError) {
      toast(jsonError, 'error', 4000);
      return;
    }
    const r = resolveRequest(spec);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, prefs.timeout * 1000);
    setSending(true);
    setFailure(null);
    setResponse(null);
    const t0 = performance.now();
    try {
      const res = await fetch(r.url, {
        method: r.method,
        headers: r.headers,
        body: r.body ?? undefined,
        signal: ctrl.signal,
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
      });
      const blob = r.method === 'HEAD' ? new Blob([]) : await res.blob();
      const ms = performance.now() - t0;
      const contentType = res.headers.get('content-type') ?? blob.type ?? '';
      const kind = bodyKind(contentType);
      const text = kind === 'image' || kind === 'binary' ? '' : await blob.slice(0, MAX_DISPLAY).text();
      const headers: [string, string][] = [];
      res.headers.forEach((v, k) => headers.push([k, v]));
      setResponse({ status: res.status, statusText: res.statusText, ms, bytes: blob.size, headers, contentType, kind, text, blob, redirected: res.redirected, finalUrl: res.url });
      setView(kind === 'image' ? 'preview' : 'pretty');
      record(r.method, r.url, res.status, ms);
      track('tool_action', { tool: TOOL, action: 'send', method: r.method, status_class: statusClass(res.status) });
    } catch (e) {
      const kind = classifyFailure(e, r.url, location.origin, timedOut);
      setFailure({ kind, message: e instanceof Error ? e.message : String(e) });
      if (kind !== 'aborted') record(r.method, r.url, null, performance.now() - t0);
      track('tool_action', { tool: TOOL, action: 'send_failed', method: r.method, failure: kind });
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      setSending(false);
    }
  };

  const record = (method: Method, url: string, status: number | null, ms: number) => {
    setHistory((h) => pushHistory(h, { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), method, url, status, ms, spec: stripSecrets(spec) }));
  };

  // Blob URL for image previews
  const imageUrl = useMemo(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = response && response.kind === 'image' ? URL.createObjectURL(response.blob) : null;
    return previewUrl.current;
  }, [response]);
  useEffect(() => () => void (previewUrl.current && URL.revokeObjectURL(previewUrl.current)), []);

  const bodyText = useMemo(() => {
    if (!response) return '';
    if (view === 'pretty' && response.kind === 'json') return prettyJson(response.text) ?? response.text;
    return response.text;
  }, [response, view]);

  const copyBody = async () => {
    if (!response) return;
    const ok = await copyText(bodyText);
    toast(ok ? 'Response copied' : 'Copy failed', ok ? 'ok' : 'error');
  };
  const downloadBody = () => {
    if (!response) return;
    const ext = response.kind === 'json' ? 'json' : response.kind === 'html' ? 'html' : response.kind === 'xml' ? 'xml' : response.kind === 'image' ? (response.contentType.split('/')[1]?.split(';')[0] ?? 'img') : response.kind === 'text' ? 'txt' : 'bin';
    if (response.kind === 'image' || response.kind === 'binary') {
      const url = URL.createObjectURL(response.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `response.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } else downloadText(bodyText, `response.${ext}`, response.contentType.split(';')[0] || 'text/plain');
  };

  const reset = () => {
    loadSpec(emptyRequest());
    setReqTab('params');
  };

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void send();
      } else if (e.key === 'Escape') {
        if (dialog) setDialog(null);
        else if (menu) setMenu(false);
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

  const counts = {
    params: spec.params.filter((p) => p.enabled && p.key).length,
    headers: spec.headers.filter((h) => h.enabled && h.key).length,
    body: spec.bodyMode !== 'none' && hasBody(spec.method) ? 1 : 0,
    auth: spec.auth !== 'none' ? 1 : 0,
  };

  return (
    <div
      ref={rootRef}
      class={'flex flex-col bg-surface-2 text-ink ' + (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(82vh,900px)] min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm')}
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-2 gap-y-2 px-1 pb-2 pt-1">
        <div class="relative">
          <button type="button" class="btn-secondary btn-sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">
            <Icon name="sparkles" size={14} /> Sample <Icon name="chevron-down" size={13} />
          </button>
          {menu && (
            <div class="absolute left-0 top-9 z-30 w-56 rounded-md border border-line-strong bg-surface p-1 shadow-float" role="menu">
              {SAMPLES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  role="menuitem"
                  class="block w-full rounded px-2.5 py-1.5 text-left text-sm hover:bg-surface-3"
                  onClick={() => {
                    loadSpec({ ...s.spec });
                    setReqTab(s.spec.bodyMode !== 'none' ? 'body' : 'params');
                    setMenu(false);
                    track('tool_action', { tool: TOOL, action: 'sample' });
                  }}
                >
                  <span class="mr-2 font-mono text-xs text-ink-3">{s.spec.method}</span>
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" class="btn-ghost btn-sm" onClick={() => setDialog('import')} title="Paste a cURL command">
          <Icon name="clipboard-paste" size={14} /> Import cURL
        </button>
        <button type="button" class="btn-ghost btn-sm" onClick={() => setDialog('export')} disabled={!urlText.trim()} title="Copy this request as cURL, fetch or Python">
          <Icon name="code" size={14} /> Export
        </button>
        <button type="button" class={'btn-sm ' + (showHistory ? 'btn-secondary' : 'btn-ghost')} onClick={() => setShowHistory((v) => !v)} aria-pressed={showHistory}>
          <Icon name="rows" size={14} /> History{history.length ? ` (${history.length})` : ''}
        </button>
        <span class="flex-1" />
        <button type="button" class="btn-ghost btn-sm" onClick={reset} title="Start a new empty request">
          <Icon name="eraser" size={14} /> Clear
        </button>
        <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
          <Icon name={full ? 'minimize' : 'maximize'} size={15} />
        </button>
      </div>

      {/* Request bar */}
      <form
        class="flex flex-wrap items-stretch gap-2 px-1 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <select class="select h-10 w-[7.5rem] shrink-0 font-mono text-[13px] font-semibold" value={spec.method} onChange={(e) => update({ method: (e.currentTarget as HTMLSelectElement).value as Method })} aria-label="HTTP method">
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <div class="min-w-0 flex-1 basis-60">
          <input
            class={'input h-10 font-mono text-[13px] ' + (urlError ? 'border-danger' : '')}
            value={urlText}
            onInput={(e) => onUrlInput((e.currentTarget as HTMLInputElement).value)}
            placeholder="https://api.example.com/v1/items?limit=10"
            spellcheck={false}
            autocomplete="off"
            aria-label="Request URL"
            aria-invalid={!!urlError}
          />
        </div>
        <select class="select h-10 w-auto shrink-0 text-[13px]" value={String(prefs.timeout)} onChange={(e) => setPrefs((p) => ({ ...p, timeout: Number((e.currentTarget as HTMLSelectElement).value) }))} aria-label="Timeout" title="Timeout">
          {TIMEOUTS.map((t) => (
            <option key={t} value={String(t)}>
              {t} s
            </option>
          ))}
        </select>
        <button type="submit" class={'h-10 shrink-0 px-5 ' + (sending ? 'btn-secondary' : 'btn-primary')} title="Send (Ctrl+Enter)">
          {sending ? (
            <>
              <Icon name="x" size={15} /> Cancel
            </>
          ) : (
            <>
              <Icon name="play" size={15} /> Send
            </>
          )}
        </button>
        {urlError && <p class="w-full text-xs text-danger">{urlError}</p>}
      </form>

      {/* Main */}
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 max-lg:overflow-y-auto lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* Request */}
        <section class="flex h-[380px] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto" aria-label="Request">
          {showHistory ? (
            <>
              <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
                <span class="font-semibold text-ink">History</span>
                <span class="ml-2 text-ink-3">last 20, auth values never saved</span>
                <span class="flex-1" />
                <HeaderButton icon="trash" title="Clear history" onClick={() => setHistory([])} disabled={!history.length} />
                <HeaderButton icon="x" title="Close history" onClick={() => setShowHistory(false)} />
              </header>
              <ol class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5">
                {history.length === 0 && <li class="p-3 text-sm text-ink-3">Requests you send appear here.</li>}
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-surface-3"
                      onClick={() => {
                        loadSpec({ ...h.spec, auth: spec.auth, token: spec.token, user: spec.user, pass: spec.pass });
                        setShowHistory(false);
                      }}
                      title="Restore this request"
                    >
                      <span class="w-14 shrink-0 font-mono font-semibold text-ink-2">{h.method}</span>
                      <span class="min-w-0 flex-1 truncate font-mono text-ink">{h.url}</span>
                      <span class={'badge shrink-0 ' + (h.status === null ? STATUS_TONE.server : STATUS_TONE[statusClass(h.status)])}>{h.status ?? 'failed'}</span>
                      <span class="w-14 shrink-0 text-right text-ink-3">{h.ms === null ? '' : formatDuration(h.ms)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <div class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 px-1.5 text-xs" role="tablist">
                {(['params', 'headers', 'body', 'auth'] as ReqTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={reqTab === t}
                    class={'rounded px-2.5 py-1 font-medium capitalize ' + (reqTab === t ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink')}
                    onClick={() => setReqTab(t)}
                  >
                    {t}
                    {counts[t] > 0 && <span class="ml-1 text-brand-600 dark:text-brand-300">{t === 'body' || t === 'auth' ? '•' : counts[t]}</span>}
                  </button>
                ))}
              </div>
              <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-3 text-sm">
                {reqTab === 'params' && (
                  <KvTable rows={spec.params} onChange={setParams} keyLabel="Parameter" addLabel="Add parameter" empty="No query parameters. Type them in the URL or add them here." />
                )}
                {reqTab === 'headers' && (
                  <>
                    <KvTable rows={spec.headers} onChange={(headers) => update({ headers })} keyLabel="Header" addLabel="Add header" suggestions={COMMON_HEADERS} empty="No custom headers. Content-Type and Authorization are added from the Body and Auth tabs." />
                    {dropped.length > 0 && (
                      <p class="mt-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-ink-2">
                        Browsers do not let pages set {dropped.join(', ')}, so {dropped.length === 1 ? 'it is' : 'they are'} dropped from the request. Use the cURL export to send {dropped.length === 1 ? 'it' : 'them'}.
                      </p>
                    )}
                  </>
                )}
                {reqTab === 'body' && (
                  <div class="space-y-3">
                    {!hasBody(spec.method) && <p class="rounded-md border border-line bg-surface-2 p-2 text-xs text-ink-3">{spec.method} requests do not send a body. Pick POST, PUT or PATCH to send one.</p>}
                    <Segmented
                      value={spec.bodyMode}
                      onChange={(bodyMode: BodyMode) => update({ bodyMode })}
                      options={[
                        { value: 'none', label: 'None' },
                        { value: 'json', label: 'JSON' },
                        { value: 'form', label: 'Form' },
                        { value: 'raw', label: 'Raw' },
                      ]}
                      label="Body type"
                    />
                    {spec.bodyMode === 'json' && (
                      <>
                        <div class="flex h-[240px] flex-col overflow-hidden rounded-md border border-line-strong">
                          <CodeEditor value={spec.json} onChange={(v) => update({ json: v })} language={json()} placeholder='{ "name": "value" }' ariaLabel="JSON body" class="flex-1" error={null} />
                        </div>
                        <div class="flex items-center gap-2 text-xs">
                          {jsonError ? <span class="text-danger">{jsonError}</span> : spec.json.trim() ? <span class="text-success">Valid JSON</span> : null}
                          <span class="flex-1" />
                          <button
                            type="button"
                            class="btn-ghost btn-sm"
                            disabled={!!jsonError || !spec.json.trim()}
                            onClick={() => {
                              const p = prettyJson(spec.json);
                              if (p) update({ json: p });
                            }}
                          >
                            <Icon name="align-left" size={13} /> Format
                          </button>
                        </div>
                      </>
                    )}
                    {spec.bodyMode === 'form' && <KvTable rows={spec.form} onChange={(form) => update({ form })} keyLabel="Field" addLabel="Add field" empty="Add fields to send as application/x-www-form-urlencoded." />}
                    {spec.bodyMode === 'raw' && (
                      <>
                        <label class="flex items-center gap-2 text-xs text-ink-2">
                          Content-Type
                          <input class="input h-8 flex-1 font-mono text-xs" value={spec.rawType} onInput={(e) => update({ rawType: (e.currentTarget as HTMLInputElement).value })} list="cuis-api-types" aria-label="Raw body content type" />
                          <datalist id="cuis-api-types">
                            {['text/plain', 'application/xml', 'text/csv', 'application/graphql', 'text/html', 'application/x-ndjson'].map((t) => (
                              <option key={t} value={t} />
                            ))}
                          </datalist>
                        </label>
                        <div class="flex h-[240px] flex-col overflow-hidden rounded-md border border-line-strong">
                          <CodeEditor value={spec.raw} onChange={(v) => update({ raw: v })} wrap placeholder="Request body" ariaLabel="Raw body" class="flex-1" />
                        </div>
                      </>
                    )}
                  </div>
                )}
                {reqTab === 'auth' && (
                  <div class="space-y-3">
                    <Segmented
                      value={spec.auth}
                      onChange={(auth: AuthMode) => update({ auth })}
                      options={[
                        { value: 'none', label: 'None' },
                        { value: 'bearer', label: 'Bearer token' },
                        { value: 'basic', label: 'Basic' },
                      ]}
                      label="Auth type"
                    />
                    {spec.auth === 'bearer' && (
                      <Field label="Token">
                        <SecretInput value={spec.token} onInput={(token) => update({ token })} show={showSecret} onToggle={() => setShowSecret((s) => !s)} label="Bearer token" placeholder="eyJhbGciOi..." />
                      </Field>
                    )}
                    {spec.auth === 'basic' && (
                      <>
                        <Field label="Username">
                          <input class="input h-9 font-mono text-xs" value={spec.user} onInput={(e) => update({ user: (e.currentTarget as HTMLInputElement).value })} autocomplete="off" aria-label="Username" />
                        </Field>
                        <Field label="Password">
                          <SecretInput value={spec.pass} onInput={(pass) => update({ pass })} show={showSecret} onToggle={() => setShowSecret((s) => !s)} label="Password" />
                        </Field>
                      </>
                    )}
                    {spec.auth !== 'none' && (
                      <>
                        <Chip on={prefs.rememberAuth} onClick={() => setPrefs((p) => ({ ...p, rememberAuth: !p.rememberAuth }))} title="Save auth values in this browser's local storage">
                          Remember auth on this device
                        </Chip>
                        <p class="text-xs leading-5 text-ink-3">
                          {prefs.rememberAuth
                            ? 'Auth values are saved in this browser only. They are never sent anywhere except to the API you call, and never kept in history.'
                            : 'Auth values stay in memory and are forgotten when you close the tab. They are never kept in history.'}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* Response */}
        <section class="flex h-[460px] min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto" aria-label="Response" aria-live="polite">
          <header class="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Response</span>
            {response && (
              <>
                <span class={'badge ' + STATUS_TONE[statusClass(response.status)]}>
                  {response.status} {response.statusText}
                </span>
                <span class="text-ink-3">{formatDuration(response.ms)}</span>
                <span class="text-ink-3">{formatSize(response.bytes)}</span>
              </>
            )}
            {sending && (
              <span class="flex items-center gap-1.5 text-ink-3">
                <Icon name="loader" size={13} class="animate-spin" /> Waiting for the server
              </span>
            )}
            <span class="flex-1" />
            {response && (
              <>
                <Segmented
                  value={resTab}
                  onChange={setResTab}
                  options={[
                    { value: 'body', label: 'Body' },
                    { value: 'headers', label: `Headers (${response.headers.length})` },
                  ]}
                  label="Response view"
                />
                <HeaderButton icon="copy" title="Copy body" onClick={() => void copyBody()} disabled={response.kind === 'image' || response.kind === 'binary'} />
                <HeaderButton icon="download" title="Download body" onClick={downloadBody} />
              </>
            )}
          </header>

          {failure ? (
            <div class="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-4 text-sm">
              <p class="flex items-start gap-2 text-danger">
                <Icon name="alert-circle" size={16} class="mt-0.5 shrink-0" />
                <span>{FAILURE_TEXT[failure.kind]}</span>
              </p>
              <p class="mt-2 text-xs text-ink-3">Browser message: {failure.message}</p>
              {(failure.kind === 'cors' || failure.kind === 'mixed-content' || failure.kind === 'network') && curlCommand && (
                <div class="mt-4">
                  <div class="mb-1 flex items-center justify-between text-xs text-ink-2">
                    <span>Run this in a terminal instead</span>
                    <button type="button" class="btn-ghost btn-sm" onClick={() => void copyText(curlCommand).then((ok) => toast(ok ? 'cURL command copied' : 'Copy failed', ok ? 'ok' : 'error'))}>
                      <Icon name="copy" size={13} /> Copy
                    </button>
                  </div>
                  <pre class="overflow-x-auto whitespace-pre rounded-md border border-line bg-surface-2 p-3 font-mono text-xs leading-5 text-ink">{curlCommand}</pre>
                </div>
              )}
            </div>
          ) : !response ? (
            <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-3">
              <Icon name="play" size={26} class="text-ink-3/60" />
              <p>Press Send to see the status, timing, headers and body here.</p>
              <p class="max-w-sm text-xs">The request goes straight from your browser to the API. Nothing passes through Cuisdev.</p>
            </div>
          ) : resTab === 'headers' ? (
            <div class="scrollbar-thin min-h-0 flex-1 overflow-auto">
              <table class="w-full text-left text-xs">
                <tbody>
                  {response.headers.map(([k, v]) => (
                    <tr key={k} class="border-b border-line align-top last:border-b-0">
                      <th scope="row" class="w-[40%] px-3 py-1.5 font-mono font-medium text-brand-700 dark:text-brand-300">
                        {k}
                      </th>
                      <td class="break-all px-2 py-1.5 font-mono text-ink">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p class="p-3 text-xs text-ink-3">Browsers only show the headers the server exposes to scripts (Access-Control-Expose-Headers), so some may be missing compared with cURL.</p>
            </div>
          ) : (
            <div class="flex min-h-0 flex-1 flex-col">
              <div class="flex shrink-0 items-center gap-2 border-b border-line px-2 py-1.5 text-xs">
                <Segmented
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'pretty', label: 'Pretty', disabled: response.kind === 'image' || response.kind === 'binary' },
                    { value: 'raw', label: 'Raw', disabled: response.kind === 'image' || response.kind === 'binary' },
                    { value: 'preview', label: 'Preview', disabled: response.kind !== 'image' && response.kind !== 'html' },
                  ]}
                  label="Body view"
                />
                <span class="min-w-0 truncate text-ink-3">{response.contentType || 'no content type'}</span>
                {response.redirected && <span class="truncate text-ink-3">· redirected to {response.finalUrl}</span>}
              </div>
              {view === 'preview' && response.kind === 'image' && imageUrl ? (
                <div class="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[radial-gradient(var(--color-line)_1px,transparent_1px)] p-4 [background-size:14px_14px]">
                  <img src={imageUrl} alt="Response image" class="max-h-full max-w-full" />
                </div>
              ) : view === 'preview' && response.kind === 'html' ? (
                <iframe title="HTML preview" sandbox="" srcdoc={response.text} class="min-h-0 flex-1 bg-white" />
              ) : response.kind === 'binary' ? (
                <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-ink-3">
                  <p>Binary response of {formatBytes(response.bytes)}.</p>
                  <button type="button" class="btn-secondary btn-sm" onClick={downloadBody}>
                    <Icon name="download" size={14} /> Download
                  </button>
                </div>
              ) : (
                <>
                  <CodeEditor value={bodyText} readOnly wrap language={view === 'pretty' ? langFor(response.kind) : null} ariaLabel="Response body" class="min-h-0 flex-1" placeholder="Empty body" />
                  {response.bytes > MAX_DISPLAY && <p class="shrink-0 border-t border-line px-3 py-1.5 text-xs text-ink-3">Showing the first 2 MB. Download for the full body.</p>}
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs text-ink-3">
        <span class="truncate">Requests go directly from your browser to the API. Cuisdev never sees them.</span>
        <span class="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> send
        </span>
      </div>

      {dialog === 'import' && (
        <ImportDialog
          onClose={() => setDialog(null)}
          onImport={(s) => {
            loadSpec(s);
            setReqTab(s.bodyMode !== 'none' ? 'body' : s.auth !== 'none' ? 'auth' : 'params');
            setDialog(null);
            toast('cURL command imported');
            track('tool_action', { tool: TOOL, action: 'import_curl' });
          }}
        />
      )}
      {dialog === 'export' && <ExportDialog spec={spec} onClose={() => setDialog(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ pieces

function Field(p: { label: string; children: ComponentChildren }) {
  return (
    <label class="block">
      <span class="mb-1 block text-xs text-ink-2">{p.label}</span>
      {p.children}
    </label>
  );
}

function SecretInput(p: { value: string; onInput: (v: string) => void; show: boolean; onToggle: () => void; label: string; placeholder?: string }) {
  return (
    <div class="flex gap-2">
      <input
        type={p.show ? 'text' : 'password'}
        class="input h-9 flex-1 font-mono text-xs"
        value={p.value}
        onInput={(e) => p.onInput((e.currentTarget as HTMLInputElement).value)}
        autocomplete="off"
        spellcheck={false}
        placeholder={p.placeholder}
        aria-label={p.label}
      />
      <HeaderButton icon={p.show ? 'eye-off' : 'eye'} title={p.show ? 'Hide' : 'Show'} onClick={p.onToggle} />
    </div>
  );
}

function KvTable(p: { rows: KV[]; onChange: (rows: KV[]) => void; keyLabel: string; addLabel: string; empty: string; suggestions?: string[] }) {
  const listId = useMemo(() => `kv-${Math.random().toString(36).slice(2, 8)}`, []);
  const set = (i: number, patch: Partial<KV>) => p.onChange(p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div>
      {p.rows.length === 0 ? (
        <p class="text-xs text-ink-3">{p.empty}</p>
      ) : (
        <div class="space-y-1.5">
          {p.rows.map((r, i) => (
            <div key={i} class="flex items-center gap-1.5">
              <input type="checkbox" class="h-4 w-4 shrink-0 accent-brand-600" checked={r.enabled} onChange={() => set(i, { enabled: !r.enabled })} aria-label={`Enable ${r.key || p.keyLabel.toLowerCase()}`} />
              <input class="input h-8 min-w-0 flex-[2] font-mono text-xs" value={r.key} placeholder={p.keyLabel} list={p.suggestions ? listId : undefined} onInput={(e) => set(i, { key: (e.currentTarget as HTMLInputElement).value })} aria-label={`${p.keyLabel} name`} />
              <input class="input h-8 min-w-0 flex-[3] font-mono text-xs" value={r.value} placeholder="Value" onInput={(e) => set(i, { value: (e.currentTarget as HTMLInputElement).value })} aria-label={`${p.keyLabel} value`} />
              <HeaderButton icon="x" title={`Remove ${r.key || 'row'}`} onClick={() => p.onChange(p.rows.filter((_, j) => j !== i))} />
            </div>
          ))}
        </div>
      )}
      {p.suggestions && (
        <datalist id={listId}>
          {p.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
      <button type="button" class="btn-ghost btn-sm mt-2" onClick={() => p.onChange([...p.rows, { key: '', value: '', enabled: true }])}>
        <Icon name="plus" size={13} /> {p.addLabel}
      </button>
    </div>
  );
}

function Modal(p: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="absolute inset-0 z-40 flex items-start justify-center bg-black/30 p-3 pt-10" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-line-strong bg-surface shadow-float" role="dialog" aria-modal="true" aria-label={p.title}>
        <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface-2 pl-4 pr-1.5 text-sm">
          <span class="font-semibold">{p.title}</span>
          <span class="flex-1" />
          <HeaderButton icon="x" title="Close (Esc)" onClick={p.onClose} />
        </header>
        <div class="scrollbar-thin min-h-0 overflow-y-auto p-4">{p.children}</div>
      </div>
    </div>
  );
}

function ImportDialog(p: { onClose: () => void; onImport: (s: RequestSpec) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = () => {
    try {
      p.onImport(parseCurl(text));
    } catch (e) {
      setError(e instanceof CurlParseError ? e.message : 'That command could not be read.');
    }
  };
  return (
    <Modal title="Import a cURL command" onClose={p.onClose}>
      <p class="mb-2 text-xs text-ink-2">Paste a command copied from browser dev tools (Copy as cURL), API docs or a terminal. Method, URL, headers, body and -u credentials are read.</p>
      <div class="flex h-[220px] flex-col overflow-hidden rounded-md border border-line-strong">
        <CodeEditor
          value={text}
          onChange={(v) => {
            setText(v);
            setError(null);
          }}
          wrap
          placeholder={"curl -X POST 'https://api.example.com/items' \\\n  -H 'Content-Type: application/json' \\\n  --data-raw '{\"name\":\"pen\"}'"}
          ariaLabel="cURL command"
          class="flex-1"
        />
      </div>
      {error && <p class="mt-2 text-xs text-danger">{error}</p>}
      <div class="mt-3 flex justify-end gap-2">
        <button type="button" class="btn-ghost btn-sm" onClick={p.onClose}>
          Cancel
        </button>
        <button type="button" class="btn-primary btn-sm" onClick={run} disabled={!text.trim()}>
          Import
        </button>
      </div>
    </Modal>
  );
}

function ExportDialog(p: { spec: RequestSpec; onClose: () => void }) {
  const [lang, setLang] = useState<ExportLang>('curl');
  const code = useMemo(() => (lang === 'curl' ? toCurl(p.spec) : lang === 'fetch' ? toFetch(p.spec) : toPython(p.spec)), [lang, p.spec]);
  const hasSecret = p.spec.auth !== 'none' || p.spec.headers.some((h) => /^(authorization|cookie|x-api-key)$/i.test(h.key));
  return (
    <Modal title="Export request" onClose={p.onClose}>
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={lang}
          onChange={setLang}
          options={[
            { value: 'curl', label: 'cURL' },
            { value: 'fetch', label: 'JavaScript fetch' },
            { value: 'python', label: 'Python requests' },
          ]}
          label="Export format"
        />
        <span class="flex-1" />
        <button
          type="button"
          class="btn-primary btn-sm"
          onClick={() =>
            void copyText(code).then((ok) => {
              toast(ok ? 'Code copied' : 'Copy failed', ok ? 'ok' : 'error');
              track('tool_action', { tool: TOOL, action: 'export', format: lang });
            })
          }
        >
          <Icon name="copy" size={13} /> Copy
        </button>
      </div>
      {hasSecret && <p class="mb-2 rounded-md border border-warning/50 bg-warning/10 p-2 text-xs text-ink-2">This code contains your auth values. Treat it like a password.</p>}
      <div class="flex h-[300px] flex-col overflow-hidden rounded-md border border-line-strong">
        <CodeEditor value={code} readOnly language={lang === 'fetch' ? javascript() : null} ariaLabel="Exported code" class="flex-1" />
      </div>
    </Modal>
  );
}
