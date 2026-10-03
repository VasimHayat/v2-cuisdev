/**
 * API Request Tester: pure helpers, no DOM. URL and query-table syncing, header
 * parsing, cURL import, code export (cURL, fetch, Python requests), auth headers,
 * body validation, formatting and CORS failure heuristics.
 */

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type Method = (typeof METHODS)[number];

export type BodyMode = 'none' | 'json' | 'form' | 'raw';
export type AuthMode = 'none' | 'bearer' | 'basic';

export interface KV {
  key: string;
  value: string;
  enabled: boolean;
}

export interface RequestSpec {
  method: Method;
  url: string;
  params: KV[];
  headers: KV[];
  bodyMode: BodyMode;
  json: string;
  form: KV[];
  raw: string;
  rawType: string;
  auth: AuthMode;
  token: string;
  user: string;
  pass: string;
}

export function emptyRequest(): RequestSpec {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    bodyMode: 'none',
    json: '',
    form: [],
    raw: '',
    rawType: 'text/plain',
    auth: 'none',
    token: '',
    user: '',
    pass: '',
  };
}

export function isMethod(v: unknown): v is Method {
  return typeof v === 'string' && (METHODS as readonly string[]).includes(v);
}

export function hasBody(method: Method): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

// --- URL and query table --------------------------------------------------------

/** Split a URL into its base (without query or fragment), query rows and fragment. */
export function splitUrl(url: string): { base: string; params: KV[]; hash: string } {
  const hashAt = url.indexOf('#');
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const noHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const q = noHash.indexOf('?');
  if (q === -1) return { base: noHash, params: [], hash };
  const base = noHash.slice(0, q);
  const params: KV[] = noHash
    .slice(q + 1)
    .split('&')
    .filter((p) => p !== '')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const k = eq === -1 ? pair : pair.slice(0, eq);
      const v = eq === -1 ? '' : pair.slice(eq + 1);
      return { key: safeDecode(k), value: safeDecode(v), enabled: true };
    });
  return { base, params, hash };
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** Build the final URL from a base and the enabled query rows. */
export function buildUrl(base: string, params: readonly KV[], hash = ''): string {
  const q = params
    .filter((p) => p.enabled && p.key !== '')
    .map((p) => `${encodeURIComponent(p.key)}${p.value === '' ? '' : `=${encodeURIComponent(p.value)}`}`)
    .join('&');
  return `${base}${q ? `?${q}` : ''}${hash}`;
}

/** Add https:// when the user typed a bare host. */
export function normalizeUrl(url: string): string {
  const t = url.trim();
  if (t === '') return t;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (/^(localhost|127\.|\[::1\])/i.test(t)) return `http://${t}`;
  return `https://${t}`;
}

export function validateUrl(url: string): string | null {
  const t = normalizeUrl(url);
  if (t === '') return 'Enter a URL to send the request to.';
  try {
    const u = new URL(t);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return `Only http and https URLs can be requested from a browser, not ${u.protocol.replace(':', '')}.`;
    return null;
  } catch {
    return 'That is not a valid URL.';
  }
}

// --- headers and auth -----------------------------------------------------------

/** Parse "Name: value" lines into header rows. Lines without a colon are ignored. */
export function parseHeaderLines(text: string): KV[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && l.includes(':'))
    .map((l) => {
      const i = l.indexOf(':');
      return { key: l.slice(0, i).trim(), value: l.slice(i + 1).trim(), enabled: true };
    });
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function authHeader(spec: Pick<RequestSpec, 'auth' | 'token' | 'user' | 'pass'>): string | null {
  if (spec.auth === 'bearer') return spec.token.trim() ? `Bearer ${spec.token.trim()}` : null;
  if (spec.auth === 'basic') return spec.user || spec.pass ? `Basic ${base64Utf8(`${spec.user}:${spec.pass}`)}` : null;
  return null;
}

export function validateJson(text: string): string | null {
  if (text.trim() === '') return null;
  try {
    JSON.parse(text);
    return null;
  } catch (err) {
    return `Body is not valid JSON: ${(err instanceof Error ? err.message : String(err)).replace(/^JSON\.parse: /, '')}`;
  }
}

/** Resolved request: URL, header list in order and body, as fetch would send it. */
export interface Resolved {
  url: string;
  method: Method;
  headers: [string, string][];
  body: string | null;
}

export function resolveRequest(spec: RequestSpec): Resolved {
  const { base, hash } = splitUrl(normalizeUrl(spec.url));
  const url = buildUrl(base, spec.params, hash);
  const headers: [string, string][] = spec.headers.filter((h) => h.enabled && h.key.trim() !== '').map((h) => [h.key.trim(), h.value]);
  const has = (name: string) => headers.some(([k]) => k.toLowerCase() === name.toLowerCase());
  const auth = authHeader(spec);
  if (auth && !has('authorization')) headers.push(['Authorization', auth]);
  let body: string | null = null;
  if (hasBody(spec.method)) {
    if (spec.bodyMode === 'json') {
      body = spec.json;
      if (!has('content-type')) headers.push(['Content-Type', 'application/json']);
    } else if (spec.bodyMode === 'form') {
      body = spec.form
        .filter((f) => f.enabled && f.key !== '')
        .map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`.replace(/%20/g, '+'))
        .join('&');
      if (!has('content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
    } else if (spec.bodyMode === 'raw') {
      body = spec.raw;
      if (!has('content-type') && spec.rawType) headers.push(['Content-Type', spec.rawType]);
    }
  }
  return { url, method: spec.method, headers, body };
}

// --- cURL import ----------------------------------------------------------------

export class CurlParseError extends Error {
  override name = 'CurlParseError';
}

/** Split a shell command into words, honouring single and double quotes, $'...' and backslash newlines. */
export function shellWords(cmd: string): string[] {
  const s = cmd.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ').replace(/`\r?\n/g, ' ');
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      if (inWord) {
        out.push(cur);
        cur = '';
        inWord = false;
      }
      i++;
      continue;
    }
    inWord = true;
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) throw new CurlParseError('Unclosed single quote in the cURL command.');
      cur += s.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (c === '$' && s[i + 1] === "'") {
      let j = i + 2;
      while (j < s.length && s[j] !== "'") {
        if (s[j] === '\\' && j + 1 < s.length) {
          const n = s[j + 1]!;
          cur += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
          j += 2;
          continue;
        }
        cur += s[j];
        j++;
      }
      if (j >= s.length) throw new CurlParseError('Unclosed quote in the cURL command.');
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') {
        if (s[j] === '\\' && j + 1 < s.length && '"\\$`'.includes(s[j + 1]!)) {
          cur += s[j + 1];
          j += 2;
          continue;
        }
        cur += s[j];
        j++;
      }
      if (j >= s.length) throw new CurlParseError('Unclosed double quote in the cURL command.');
      i = j + 1;
      continue;
    }
    if (c === '\\' && i + 1 < s.length) {
      cur += s[i + 1];
      i += 2;
      continue;
    }
    cur += c;
    i++;
  }
  if (inWord) out.push(cur);
  return out;
}

/** Parse a cURL command into a request spec. */
export function parseCurl(cmd: string): RequestSpec {
  const words = shellWords(cmd.trim());
  if (words.length === 0 || !/^curl(\.exe)?$/i.test(words[0]!)) throw new CurlParseError('Paste a command that starts with curl.');
  const spec = emptyRequest();
  let explicitMethod: string | null = null;
  const data: string[] = [];
  let json = false;
  let url = '';
  let getMode = false;
  const takesValue = new Set(['-X', '--request', '-H', '--header', '-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json', '-u', '--user', '-A', '--user-agent', '-e', '--referer', '-b', '--cookie', '--url', '-o', '--output', '-m', '--max-time', '--connect-timeout', '-F', '--form', '-x', '--proxy', '-w', '--write-out']);
  for (let i = 1; i < words.length; i++) {
    let w = words[i]!;
    let val: string | undefined;
    // --opt=value form
    const eq = w.startsWith('--') ? w.indexOf('=') : -1;
    if (eq > 2) {
      val = w.slice(eq + 1);
      w = w.slice(0, eq);
    } else if (/^-[XHdubAeo]./.test(w) && !w.startsWith('--')) {
      // attached short option value like -XPOST or -H'X: y'
      val = w.slice(2);
      w = w.slice(0, 2);
    }
    if (takesValue.has(w) && val === undefined) {
      val = words[++i];
      if (val === undefined) throw new CurlParseError(`Option ${w} needs a value.`);
    }
    switch (w) {
      case '-X':
      case '--request':
        explicitMethod = val!.toUpperCase();
        break;
      case '-H':
      case '--header': {
        const [h] = parseHeaderLines(val!);
        if (h) spec.headers.push(h);
        break;
      }
      case '-A':
      case '--user-agent':
        spec.headers.push({ key: 'User-Agent', value: val!, enabled: true });
        break;
      case '-e':
      case '--referer':
        spec.headers.push({ key: 'Referer', value: val!, enabled: true });
        break;
      case '-b':
      case '--cookie':
        spec.headers.push({ key: 'Cookie', value: val!, enabled: true });
        break;
      case '-d':
      case '--data':
      case '--data-raw':
      case '--data-binary':
      case '--data-ascii':
        data.push(val!);
        break;
      case '--data-urlencode': {
        const v = val!;
        const e2 = v.indexOf('=');
        data.push(e2 === -1 ? encodeURIComponent(v) : `${v.slice(0, e2)}=${encodeURIComponent(v.slice(e2 + 1))}`);
        break;
      }
      case '--json':
        data.push(val!);
        json = true;
        break;
      case '-u':
      case '--user': {
        const v = val!;
        const c = v.indexOf(':');
        spec.auth = 'basic';
        spec.user = c === -1 ? v : v.slice(0, c);
        spec.pass = c === -1 ? '' : v.slice(c + 1);
        break;
      }
      case '--url':
        url = val!;
        break;
      case '-G':
      case '--get':
        getMode = true;
        break;
      case '-I':
      case '--head':
        explicitMethod = 'HEAD';
        break;
      case '-F':
      case '--form':
        throw new CurlParseError('Multipart form uploads (-F) are not supported. Use a JSON or urlencoded body instead.');
      default:
        if (!w.startsWith('-') && !url) url = w;
        // other flags (-s, -L, -k, -i, --compressed, -o file...) are ignored
        break;
    }
  }
  if (!url) throw new CurlParseError('No URL found in the cURL command.');
  const { base, params, hash } = splitUrl(url);
  spec.url = base + hash;
  spec.params = params;
  const body = data.join('&');
  if (getMode && data.length) {
    spec.params.push(...splitUrl(`?${body}`).params);
  } else if (data.length) {
    const ct = spec.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value.toLowerCase() ?? '';
    if (json || ct.includes('json') || (!ct && /^\s*[[{]/.test(body))) {
      spec.bodyMode = 'json';
      spec.json = body;
      if (json && !spec.headers.some((h) => h.key.toLowerCase() === 'accept')) spec.headers.push({ key: 'Accept', value: 'application/json', enabled: true });
    } else if (!ct || ct.includes('x-www-form-urlencoded')) {
      spec.bodyMode = 'form';
      spec.form = splitUrl(`?${body}`).params;
    } else {
      spec.bodyMode = 'raw';
      spec.raw = body;
      spec.rawType = ct;
    }
  }
  // Content-Type is implied by the body mode; keep it only for raw bodies.
  if (spec.bodyMode === 'json' || spec.bodyMode === 'form') {
    const want = spec.bodyMode === 'json' ? 'application/json' : 'application/x-www-form-urlencoded';
    spec.headers = spec.headers.filter((h) => !(h.key.toLowerCase() === 'content-type' && h.value.toLowerCase().startsWith(want)));
  }
  // Pull a bearer token out of the headers into the Auth tab.
  const authIdx = spec.headers.findIndex((h) => h.key.toLowerCase() === 'authorization' && /^bearer\s+/i.test(h.value));
  if (authIdx !== -1 && spec.auth === 'none') {
    spec.auth = 'bearer';
    spec.token = spec.headers[authIdx]!.value.replace(/^bearer\s+/i, '');
    spec.headers.splice(authIdx, 1);
  }
  const m = explicitMethod ?? (getMode ? 'GET' : data.length ? 'POST' : 'GET');
  spec.method = isMethod(m) ? m : 'GET';
  return spec;
}

// --- code export ----------------------------------------------------------------

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function toCurl(spec: RequestSpec): string {
  const r = resolveRequest(spec);
  const parts = ['curl'];
  const sendsData = r.body !== null && r.body !== '';
  // curl -X HEAD waits for a body that never comes; -I is the HEAD request flag.
  if (r.method === 'HEAD') parts.push('-I');
  else if (r.method !== (sendsData ? 'POST' : 'GET')) parts.push(`-X ${r.method}`);
  parts.push(shQuote(r.url));
  for (const [k, v] of r.headers) parts.push(`-H ${shQuote(`${k}: ${v}`)}`);
  if (r.body !== null && r.body !== '') parts.push(`--data-raw ${shQuote(r.body)}`);
  return parts.join(' \\\n  ');
}

export function toFetch(spec: RequestSpec): string {
  const r = resolveRequest(spec);
  const opts: string[] = [`  method: ${JSON.stringify(r.method)},`];
  if (r.headers.length) {
    opts.push('  headers: {');
    for (const [k, v] of r.headers) opts.push(`    ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
    opts.push('  },');
  }
  if (r.body !== null && r.body !== '') {
    let bodyExpr = JSON.stringify(r.body);
    if (spec.bodyMode === 'json') {
      try {
        bodyExpr = `JSON.stringify(${JSON.stringify(JSON.parse(r.body), null, 2).replace(/\n/g, '\n  ')})`;
      } catch {}
    }
    opts.push(`  body: ${bodyExpr},`);
  }
  return `const response = await fetch(${JSON.stringify(r.url)}, {\n${opts.join('\n')}\n});\nconst data = await response.${spec.method === 'HEAD' ? 'status' : 'text()'};\nconsole.log(response.status, data);`;
}

function pyStr(s: string): string {
  return JSON.stringify(s);
}

export function toPython(spec: RequestSpec): string {
  const r = resolveRequest(spec);
  const lines = ['import requests', ''];
  lines.push(`url = ${pyStr(r.url)}`);
  const headers = r.headers.filter(([k]) => !(spec.bodyMode === 'json' && k.toLowerCase() === 'content-type'));
  if (headers.length) {
    lines.push('headers = {');
    for (const [k, v] of headers) lines.push(`    ${pyStr(k)}: ${pyStr(v)},`);
    lines.push('}');
  }
  const args = ['url'];
  if (headers.length) args.push('headers=headers');
  if (r.body !== null && r.body !== '') {
    if (spec.bodyMode === 'json') {
      try {
        const pretty = JSON.stringify(JSON.parse(r.body), null, 4)
          .replace(/\btrue\b/g, 'True')
          .replace(/\bfalse\b/g, 'False')
          .replace(/\bnull\b/g, 'None');
        lines.push(`payload = ${pretty}`);
        args.push('json=payload');
      } catch {
        lines.push(`payload = ${pyStr(r.body)}`);
        args.push('data=payload');
      }
    } else {
      lines.push(`payload = ${pyStr(r.body)}`);
      args.push('data=payload');
    }
  }
  lines.push('');
  lines.push(`response = requests.request(${pyStr(r.method)}, ${args.join(', ')}, timeout=30)`);
  lines.push('print(response.status_code)');
  lines.push('print(response.text)');
  return lines.join('\n');
}

// --- response helpers -----------------------------------------------------------

export function statusClass(status: number): 'info' | 'success' | 'redirect' | 'client' | 'server' | 'unknown' {
  if (status >= 100 && status < 200) return 'info';
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'redirect';
  if (status >= 400 && status < 500) return 'client';
  if (status >= 500 && status < 600) return 'server';
  return 'unknown';
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '–';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export type BodyKind = 'json' | 'html' | 'xml' | 'image' | 'text' | 'binary';

export function bodyKind(contentType: string): BodyKind {
  const ct = contentType.toLowerCase();
  if (/[/+]json\b/.test(ct)) return 'json';
  if (ct.includes('text/html')) return 'html';
  if (/[/+]xml\b/.test(ct)) return 'xml';
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('text/') || ct.includes('javascript') || ct.includes('x-www-form-urlencoded') || ct === '') return 'text';
  return 'binary';
}

/** Pretty JSON when parseable, otherwise null. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export type FailureKind = 'cors' | 'mixed-content' | 'timeout' | 'aborted' | 'invalid' | 'network';

/**
 * Classify a failed fetch. Browsers reject a blocked cross-origin response with a bare
 * TypeError ("Failed to fetch", "NetworkError when attempting to fetch resource",
 * "Load failed") that is indistinguishable from an offline server, so for cross-origin
 * URLs CORS is the likely cause.
 */
export function classifyFailure(err: unknown, url: string, pageOrigin: string, timedOut: boolean): FailureKind {
  if (timedOut) return 'timeout';
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'AbortError') return 'aborted';
  let target: URL | null = null;
  try {
    target = new URL(url);
  } catch {
    return 'invalid';
  }
  if (pageOrigin.startsWith('https:') && target.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(target.hostname)) return 'mixed-content';
  const msg = err instanceof Error ? err.message : String(err);
  const isFetchTypeError = name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
  if (isFetchTypeError && target.origin !== pageOrigin) return 'cors';
  return 'network';
}

export const FAILURE_TEXT: Record<FailureKind, string> = {
  cors: 'The browser blocked the response. This API does not allow cross-origin requests from this page (no matching Access-Control-Allow-Origin header), or the server could not be reached. The request went straight from your browser to the API; nothing went through Cuisdev servers. Test it with the cURL command below, which is not subject to CORS.',
  'mixed-content': 'This page is served over https, so the browser refuses plain http requests to other hosts (mixed content). Use the https URL, or run the cURL command below.',
  timeout: 'No response arrived before the timeout. Increase the timeout or check that the server is up.',
  aborted: 'The request was cancelled.',
  invalid: 'The URL is not valid.',
  network: 'The request failed before a response arrived. Check the URL, your connection and whether the server is running.',
};

// --- history ------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  at: number;
  method: Method;
  url: string;
  status: number | null;
  ms: number | null;
  /** Request without auth values. */
  spec: RequestSpec;
}

/** Copy of a spec with every secret removed (auth fields and Authorization/Cookie headers). */
export function stripSecrets(spec: RequestSpec): RequestSpec {
  return {
    ...spec,
    token: '',
    pass: '',
    headers: spec.headers.filter((h) => !/^(authorization|cookie|x-api-key|api-key|proxy-authorization)$/i.test(h.key.trim())),
    params: spec.params.map((p) => (/^(api[_-]?key|access[_-]?token|token|key|secret|password)$/i.test(p.key) ? { ...p, value: '' } : p)),
  };
}

export function pushHistory(list: readonly HistoryEntry[], entry: HistoryEntry, max = 20): HistoryEntry[] {
  const next = [entry, ...list.filter((e) => e.id !== entry.id)];
  return next.slice(0, max);
}

export function sanitizeSpec(raw: unknown): RequestSpec {
  const base = emptyRequest();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<RequestSpec>;
  const kvs = (v: unknown): KV[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is KV => !!x && typeof x === 'object' && typeof (x as KV).key === 'string' && typeof (x as KV).value === 'string')
          .map((x) => ({ key: x.key, value: x.value, enabled: x.enabled !== false }))
      : [];
  return {
    method: isMethod(r.method) ? r.method : base.method,
    url: typeof r.url === 'string' ? r.url : '',
    params: kvs(r.params),
    headers: kvs(r.headers),
    bodyMode: r.bodyMode === 'json' || r.bodyMode === 'form' || r.bodyMode === 'raw' ? r.bodyMode : 'none',
    json: typeof r.json === 'string' ? r.json : '',
    form: kvs(r.form),
    raw: typeof r.raw === 'string' ? r.raw : '',
    rawType: typeof r.rawType === 'string' ? r.rawType : 'text/plain',
    auth: r.auth === 'bearer' || r.auth === 'basic' ? r.auth : 'none',
    token: typeof r.token === 'string' ? r.token : '',
    user: typeof r.user === 'string' ? r.user : '',
    pass: typeof r.pass === 'string' ? r.pass : '',
  };
}

export const COMMON_HEADERS = ['Accept', 'Accept-Language', 'Cache-Control', 'Content-Type', 'If-None-Match', 'Origin', 'User-Agent', 'X-Api-Key', 'X-Request-Id'];

export const SAMPLES: { label: string; spec: RequestSpec }[] = [
  {
    label: 'GET a JSON post',
    spec: { ...emptyRequest(), method: 'GET', url: 'https://jsonplaceholder.typicode.com/posts/1', headers: [{ key: 'Accept', value: 'application/json', enabled: true }] },
  },
  {
    label: 'POST JSON to httpbin',
    spec: {
      ...emptyRequest(),
      method: 'POST',
      url: 'https://httpbin.org/post',
      params: [{ key: 'source', value: 'cuisdev', enabled: true }],
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      bodyMode: 'json',
      json: '{\n  "title": "Hello from Cuisdev",\n  "tags": ["api", "test"],\n  "draft": false\n}',
    },
  },
];

/** Headers a browser refuses to let page scripts set; fetch drops them silently. */
const FORBIDDEN = new Set(['accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method', 'connection', 'content-length', 'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via']);

export function forbiddenHeaders(headers: readonly KV[]): string[] {
  return headers
    .filter((h) => h.enabled && h.key.trim() !== '')
    .map((h) => h.key.trim())
    .filter((k) => FORBIDDEN.has(k.toLowerCase()) || /^(proxy-|sec-)/i.test(k));
}
