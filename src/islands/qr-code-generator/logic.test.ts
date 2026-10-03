import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import {
  DEFAULT_DESIGN,
  EMPTY_CONTENT,
  MAX_BYTES,
  buildPayload,
  capacity,
  contentWarning,
  contrastRatio,
  draftToStore,
  escapeWifi,
  inFinder,
  logoArea,
  normalizeUrl,
  parseDraft,
  renderSvg,
  scanWarning,
  type Content,
  type Matrix,
} from './logic';

const c = (patch: Partial<Content>): Content => ({ ...EMPTY_CONTENT, ...patch });
const matrixOf = (text: string, ecl: 'L' | 'M' | 'Q' | 'H' = 'M'): Matrix & { version: number } => {
  const qr = QRCode.create(text, { errorCorrectionLevel: ecl });
  return { size: qr.modules.size, get: (r, col) => qr.modules.get(r, col), version: qr.version };
};

describe('payloads', () => {
  it('normalises URLs', () => {
    expect(normalizeUrl('example.com/a')).toBe('https://example.com/a');
    expect(normalizeUrl('http://x.io')).toBe('http://x.io');
    expect(normalizeUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(buildPayload(c({ type: 'url', url: '  ' }))).toBe('');
  });
  it('escapes Wi-Fi values and omits the password for open networks', () => {
    expect(escapeWifi('a;b,c:d\\e"f')).toBe('a\\;b\\,c\\:d\\\\e\\"f');
    expect(buildPayload(c({ type: 'wifi', wifi: { ssid: 'Home;Net', password: 'p:ss', security: 'WPA', hidden: true } }))).toBe('WIFI:T:WPA;S:Home\\;Net;P:p\\:ss;H:true;;');
    expect(buildPayload(c({ type: 'wifi', wifi: { ssid: 'Cafe', password: 'ignored', security: 'nopass', hidden: false } }))).toBe('WIFI:T:nopass;S:Cafe;;');
  });
  it('builds email, phone, SMS and geo payloads', () => {
    expect(buildPayload(c({ type: 'email', email: { to: 'a@b.co', subject: 'Hi there', body: 'Line 1\nLine 2' } }))).toBe('mailto:a@b.co?subject=Hi%20there&body=Line%201%0ALine%202');
    expect(buildPayload(c({ type: 'phone', phone: '+44 (20) 7946-0000' }))).toBe('tel:+442079460000');
    expect(buildPayload(c({ type: 'sms', sms: { phone: '555 0100', message: 'On my way' } }))).toBe('SMSTO:5550100:On my way');
    expect(buildPayload(c({ type: 'geo', geo: { lat: '51.5007', lon: '-0.1246' } }))).toBe('geo:51.5007,-0.1246');
    expect(buildPayload(c({ type: 'geo', geo: { lat: 'x', lon: '1' } }))).toBe('');
  });
  it('builds an escaped vCard', () => {
    const v = buildPayload(c({ type: 'vcard', vcard: { firstName: 'Ada', lastName: 'Lovelace', org: 'Analytical, Ltd', phone: '+44 1', email: 'ada@example.com', url: 'example.com' } }));
    expect(v.split('\n')).toEqual(['BEGIN:VCARD', 'VERSION:3.0', 'N:Lovelace;Ada;;;', 'FN:Ada Lovelace', 'ORG:Analytical\\, Ltd', 'TEL;TYPE=CELL:+441', 'EMAIL:ada@example.com', 'URL:https://example.com', 'END:VCARD']);
  });
  it('warns about bad input', () => {
    expect(contentWarning(c({ type: 'geo', geo: { lat: '91', lon: '0' } }))).toMatch(/Latitude/);
    expect(contentWarning(c({ type: 'email', email: { to: 'nope', subject: '', body: '' } }))).toMatch(/email/);
    expect(contentWarning(c({ type: 'wifi', wifi: { ssid: 'x', password: 'short', security: 'WPA', hidden: false } }))).toMatch(/8 characters/);
    expect(contentWarning(c({ type: 'url' }))).toBeNull();
  });
});

describe('capacity and colour', () => {
  it('reports capacity by error correction level', () => {
    expect(capacity('é', 'M')).toMatchObject({ bytes: 2, max: MAX_BYTES.M, level: 'ok' });
    expect(capacity('a'.repeat(1200), 'H').level).toBe('near');
    expect(capacity('a'.repeat(1300), 'H').level).toBe('over');
  });
  it('computes contrast and scan warnings', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(scanWarning('#111827', '#ffffff')).toBeNull();
    expect(scanWarning('#999999', '#aaaaaa')).toMatch(/Low contrast/);
    expect(scanWarning('#ffffff', '#000000')).toMatch(/inverted/);
    expect(scanWarning('red', '#fff')).toMatch(/hex/);
  });
});

describe('rendering', () => {
  it('locates finder patterns and the logo area', () => {
    expect(inFinder(0, 0, 25)).toBe(true);
    expect(inFinder(6, 24, 25)).toBe(true);
    expect(inFinder(24, 6, 25)).toBe(true);
    expect(inFinder(24, 24, 25)).toBe(false);
    const a = logoArea(25, 0.2)!;
    expect(a.end - a.start).toBe(5);
    expect((25 - (a.end - a.start)) % 2).toBe(0);
    expect(logoArea(25, 0.9)!.end - logoArea(25, 0.9)!.start).toBeLessThanOrEqual(Math.ceil(25 * 0.22) + 1);
  });
  it('renders a square SVG whose path covers every dark data module', () => {
    const m = matrixOf('https://cuisdev.com');
    expect(m.version).toBe(2);
    const svg = renderSvg(m, { ...DEFAULT_DESIGN, logo: null });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${m.size + 8} ${m.size + 8}"`);
    let dark = 0;
    for (let r = 0; r < m.size; r++) for (let col = 0; col < m.size; col++) if (m.get(r, col) && !inFinder(r, col, m.size)) dark++;
    expect((svg.match(/h1v1h-1z/g) ?? []).length).toBe(dark);
    expect((svg.match(/stroke-width="1"/g) ?? []).length).toBe(3);
  });
  it('renders dots and a logo with cleared modules', () => {
    const m = matrixOf('https://cuisdev.com/tools/', 'H');
    const svg = renderSvg(m, { ...DEFAULT_DESIGN, style: 'dots', logo: 'data:image/png;base64,AAAA', logoScale: 0.2 });
    expect(svg).toContain('<g fill="#111827"><circle');
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"');
    const plain = renderSvg(m, { ...DEFAULT_DESIGN, style: 'dots', logo: null });
    expect((svg.match(/<circle/g) ?? []).length).toBeLessThan((plain.match(/<circle/g) ?? []).length);
  });
});

describe('error correction', () => {
  it('needs a larger code for the same text at a higher level', () => {
    const text = 'https://cuisdev.com/tools/converters/qr-code-generator/?utm_source=print';
    const low = matrixOf(text, 'L');
    const high = matrixOf(text, 'H');
    expect(high.version).toBeGreaterThan(low.version);
    expect(high.size).toBe(17 + 4 * high.version);
  });
});

describe('drafts', () => {
  it('never stores the Wi-Fi password and validates saved values', () => {
    const content = c({ type: 'wifi', wifi: { ssid: 'Home', password: 'secret123', security: 'WPA', hidden: false } });
    const stored = JSON.parse(JSON.stringify(draftToStore(content, DEFAULT_DESIGN)));
    expect(JSON.stringify(stored)).not.toContain('secret123');
    const back = parseDraft({ ...stored, design: { ecl: 'Z', margin: 99, fg: 'nope', style: 'stars' } });
    expect(back.content.wifi).toEqual({ ssid: 'Home', password: '', security: 'WPA', hidden: false });
    expect(back.design).toEqual(DEFAULT_DESIGN);
  });
});
