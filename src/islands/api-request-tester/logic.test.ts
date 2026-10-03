import { describe, expect, it } from 'vitest';
import {
  CurlParseError,
  authHeader,
  bodyKind,
  buildUrl,
  classifyFailure,
  emptyRequest,
  forbiddenHeaders,
  formatDuration,
  formatSize,
  normalizeUrl,
  parseCurl,
  parseHeaderLines,
  pushHistory,
  resolveRequest,
  shellWords,
  splitUrl,
  statusClass,
  stripSecrets,
  toCurl,
  toFetch,
  toPython,
  validateJson,
  validateUrl,
  type HistoryEntry,
  type RequestSpec,
} from './logic';

const spec = (patch: Partial<RequestSpec>): RequestSpec => ({ ...emptyRequest(), ...patch });

describe('URL and query table', () => {
  it('splits and rebuilds URLs with encoding and fragments', () => {
    const s = splitUrl('https://api.x.io/search?q=caf%C3%A9+cr%C3%A8me&page=2&flag#top');
    expect(s.base).toBe('https://api.x.io/search');
    expect(s.hash).toBe('#top');
    expect(s.params).toEqual([
      { key: 'q', value: 'café crème', enabled: true },
      { key: 'page', value: '2', enabled: true },
      { key: 'flag', value: '', enabled: true },
    ]);
    const rebuilt = buildUrl(s.base, [...s.params, { key: 'off', value: 'x', enabled: false }], s.hash);
    expect(rebuilt).toBe('https://api.x.io/search?q=caf%C3%A9%20cr%C3%A8me&page=2&flag#top');
  });
  it('normalises and validates URLs', () => {
    expect(normalizeUrl('api.x.io/v1')).toBe('https://api.x.io/v1');
    expect(normalizeUrl('localhost:3000/x')).toBe('http://localhost:3000/x');
    expect(validateUrl('')).toMatch(/Enter a URL/);
    expect(validateUrl('ftp://x.io')).toMatch(/Only http and https/);
    expect(validateUrl('https://x.io')).toBeNull();
  });
});

describe('headers, auth and body', () => {
  it('parses header lines', () => {
    expect(parseHeaderLines('Accept: application/json\nnot a header\nX-Id:  42 ')).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Id', value: '42', enabled: true },
    ]);
  });
  it('builds bearer and UTF-8 basic auth', () => {
    expect(authHeader({ auth: 'bearer', token: ' abc ', user: '', pass: '' })).toBe('Bearer abc');
    expect(authHeader({ auth: 'basic', token: '', user: 'aladdin', pass: 'opensesame' })).toBe('Basic YWxhZGRpbjpvcGVuc2VzYW1l');
    expect(authHeader({ auth: 'basic', token: '', user: 'josé', pass: 'ñ' })).toBe(`Basic ${Buffer.from('josé:ñ').toString('base64')}`);
    expect(authHeader({ auth: 'none', token: 'x', user: '', pass: '' })).toBeNull();
  });
  it('flags headers the browser will drop', () => {
    const rows = [
      { key: 'Cookie', value: 'a=1', enabled: true },
      { key: 'Sec-Fetch-Mode', value: 'x', enabled: true },
      { key: 'Origin', value: 'x', enabled: false },
      { key: 'X-Ok', value: '1', enabled: true },
    ];
    expect(forbiddenHeaders(rows)).toEqual(['Cookie', 'Sec-Fetch-Mode']);
  });
  it('validates JSON bodies', () => {
    expect(validateJson('')).toBeNull();
    expect(validateJson('{"a":1}')).toBeNull();
    expect(validateJson('{"a":1,}')).toMatch(/not valid JSON/);
  });
  it('resolves a request with implied headers and no body on GET', () => {
    const r = resolveRequest(spec({ method: 'POST', url: 'x.io/a', params: [{ key: 'k', value: 'v', enabled: true }], bodyMode: 'json', json: '{"a":1}', auth: 'bearer', token: 't' }));
    expect(r.url).toBe('https://x.io/a?k=v');
    expect(r.headers).toEqual([
      ['Authorization', 'Bearer t'],
      ['Content-Type', 'application/json'],
    ]);
    expect(r.body).toBe('{"a":1}');
    const form = resolveRequest(spec({ method: 'PUT', url: 'https://x.io', bodyMode: 'form', form: [{ key: 'a b', value: 'c&d', enabled: true }] }));
    expect(form.body).toBe('a+b=c%26d');
    expect(resolveRequest(spec({ method: 'GET', url: 'https://x.io', bodyMode: 'json', json: '{}' })).body).toBeNull();
  });
});

describe('cURL import', () => {
  it('splits shell words with quotes and line continuations', () => {
    expect(shellWords(`curl 'a b' "c \\"d\\"" e\\ f \\\n  -H $'x\\ty'`)).toEqual(['curl', 'a b', 'c "d"', 'e f', '-H', 'x\ty']);
    expect(() => shellWords(`curl 'open`)).toThrow(CurlParseError);
  });
  it('parses a POST with JSON, headers and a bearer token', () => {
    const s = parseCurl(`curl -X POST 'https://api.x.io/v1/items?draft=1' \\
  -H 'Content-Type: application/json' \\
  -H "Authorization: Bearer tok123" \\
  -H 'Accept: application/json' \\
  --data-raw '{"name":"pen","qty":2}'`);
    expect(s.method).toBe('POST');
    expect(s.url).toBe('https://api.x.io/v1/items');
    expect(s.params).toEqual([{ key: 'draft', value: '1', enabled: true }]);
    expect(s.bodyMode).toBe('json');
    expect(s.json).toBe('{"name":"pen","qty":2}');
    expect(s.auth).toBe('bearer');
    expect(s.token).toBe('tok123');
    expect(s.headers).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }]);
  });
  it('infers methods and handles -u, -d forms, -G and --json', () => {
    const form = parseCurl('curl https://x.io/login -u admin:s3cret -d user=ada -d "note=hi there"');
    expect(form.method).toBe('POST');
    expect(form.auth).toBe('basic');
    expect([form.user, form.pass]).toEqual(['admin', 's3cret']);
    expect(form.bodyMode).toBe('form');
    expect(form.form.map((f) => `${f.key}=${f.value}`)).toEqual(['user=ada', 'note=hi there']);
    const get = parseCurl('curl -G https://x.io/search -d q=cats --data-urlencode "lang=en gb"');
    expect(get.method).toBe('GET');
    expect(get.params.map((p) => `${p.key}=${p.value}`)).toEqual(['q=cats', 'lang=en gb']);
    const j = parseCurl(`curl --json '{"a":1}' https://x.io/j`);
    expect([j.method, j.bodyMode, j.json]).toEqual(['POST', 'json', '{"a":1}']);
    expect(parseCurl('curl -XDELETE https://x.io/1 -sSL --compressed').method).toBe('DELETE');
    expect(() => parseCurl('wget https://x.io')).toThrow(/starts with curl/);
    expect(() => parseCurl('curl -F file=@a.png https://x.io')).toThrow(/Multipart/);
  });
});

describe('code export', () => {
  const s = spec({ method: 'POST', url: 'https://x.io/items', headers: [{ key: 'X-Id', value: "o'brien", enabled: true }], bodyMode: 'json', json: '{"ok":true,"n":null}' });
  it('exports cURL that round-trips through the parser', () => {
    const curl = toCurl(s);
    expect(curl).toContain(`-H 'X-Id: o'\\''brien'`);
    const back = parseCurl(curl);
    expect(back.method).toBe('POST');
    expect(back.json).toBe('{"ok":true,"n":null}');
    expect(back.headers).toEqual([{ key: 'X-Id', value: "o'brien", enabled: true }]);
  });
  it('exports HEAD as -I and omits -X for implied methods', () => {
    expect(toCurl(spec({ method: 'HEAD', url: 'https://x.io' }))).toBe("curl \\\n  -I \\\n  'https://x.io'");
    expect(toCurl(spec({ method: 'GET', url: 'https://x.io' }))).not.toContain('-X');
    expect(parseCurl(toCurl(spec({ method: 'HEAD', url: 'https://x.io' }))).method).toBe('HEAD');
  });
  it('exports fetch and Python requests', () => {
    expect(toFetch(s)).toContain('body: JSON.stringify(');
    const py = toPython(s);
    expect(py).toContain('import requests');
    expect(py).toContain('"ok": True');
    expect(py).toContain('"n": None');
    expect(py).toContain('json=payload');
    expect(py).not.toMatch(/Content-Type/);
  });
});

describe('responses, failures and history', () => {
  it('formats status, size, time and body kind', () => {
    expect([statusClass(204), statusClass(304), statusClass(404), statusClass(503), statusClass(0)]).toEqual(['success', 'redirect', 'client', 'server', 'unknown']);
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatDuration(87.4)).toBe('87 ms');
    expect(formatDuration(1534)).toBe('1.53 s');
    expect(bodyKind('application/problem+json; charset=utf-8')).toBe('json');
    expect(bodyKind('text/html')).toBe('html');
    expect(bodyKind('image/png')).toBe('image');
    expect(bodyKind('application/octet-stream')).toBe('binary');
  });
  it('classifies fetch failures', () => {
    const te = new TypeError('Failed to fetch');
    expect(classifyFailure(te, 'https://api.x.io', 'https://cuisdev.com', false)).toBe('cors');
    expect(classifyFailure(te, 'http://api.x.io', 'https://cuisdev.com', false)).toBe('mixed-content');
    expect(classifyFailure(te, 'https://cuisdev.com/api', 'https://cuisdev.com', false)).toBe('network');
    expect(classifyFailure(new DOMException('x', 'AbortError'), 'https://a.io', 'https://cuisdev.com', false)).toBe('aborted');
    expect(classifyFailure(te, 'https://a.io', 'https://cuisdev.com', true)).toBe('timeout');
  });
  it('strips secrets and caps history', () => {
    const s = stripSecrets(spec({ auth: 'bearer', token: 't', pass: 'p', headers: [{ key: 'Authorization', value: 'x', enabled: true }, { key: 'Accept', value: '*/*', enabled: true }], params: [{ key: 'api_key', value: 'k', enabled: true }] }));
    expect([s.token, s.pass]).toEqual(['', '']);
    expect(s.headers.map((h) => h.key)).toEqual(['Accept']);
    expect(s.params[0]!.value).toBe('');
    let list: HistoryEntry[] = [];
    for (let i = 0; i < 25; i++) list = pushHistory(list, { id: String(i), at: i, method: 'GET', url: `u${i}`, status: 200, ms: 1, spec: emptyRequest() });
    expect(list).toHaveLength(20);
    expect(list[0]!.id).toBe('24');
  });
});
