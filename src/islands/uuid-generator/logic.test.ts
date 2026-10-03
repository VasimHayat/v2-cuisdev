import { describe, expect, it } from 'vitest';
import {
  MAX_UUID,
  NAMESPACES,
  NIL_UUID,
  UuidError,
  createV1Generator,
  createV7Generator,
  formatUuids,
  generate,
  generateUuids,
  isValidUuid,
  normalizeUuid,
  parseUuid,
  uuidV3,
  uuidV4,
  uuidV5,
  uuidV7,
  v7Timestamp,
} from './logic';

const DNS = NAMESPACES[0]!.uuid;
const RFC = /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('generators', () => {
  it('v4 has the right version and variant bits', () => {
    for (let i = 0; i < 50; i++) expect(RFC.exec(uuidV4())?.[1]).toBe('4');
    const fixed = uuidV4((b) => b.fill(0xff));
    expect(fixed).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('v7 encodes the timestamp and is monotonic within a millisecond', () => {
    const ts = Date.UTC(2026, 9, 3, 12, 0, 0);
    const one = uuidV7(ts);
    expect(RFC.exec(one)?.[1]).toBe('7');
    expect(v7Timestamp(one)).toBe(ts);
    const next = createV7Generator(() => ts);
    const list = Array.from({ length: 500 }, next);
    expect([...list].sort()).toEqual(list);
    expect(new Set(list).size).toBe(500);
    expect(() => uuidV7(-1)).toThrow(UuidError);
  });

  it('v1 round-trips its timestamp and keeps a multicast node', () => {
    const ts = Date.UTC(2026, 0, 1);
    const u = createV1Generator(() => ts)();
    const parsed = parseUuid(u);
    expect(parsed.version).toBe(1);
    expect(parsed.timestamp?.getTime()).toBe(ts);
    expect(parseInt(u.slice(24, 26), 16) & 0x01).toBe(1);
  });

  it('v5 and v3 match the RFC known vectors', async () => {
    expect(await uuidV5(DNS, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(await uuidV3(DNS, 'www.example.com')).toBe('5df41881-3aed-3515-88a7-2f4a814cf09e');
  });

  it('generates batches, including name-based and nil/max', async () => {
    expect(await generateUuids({ version: 'v4', count: 3 })).toHaveLength(3);
    expect(await generateUuids({ version: 'v5', count: 2, namespace: 'dns', name: 'www.example.com' })).toEqual(['2ed6657d-e927-568b-95e1-2665a8aea6a2', '2ed6657d-e927-568b-95e1-2665a8aea6a2']);
    expect(await generateUuids({ version: 'nil', count: 1 })).toEqual([NIL_UUID]);
    expect(await generateUuids({ version: 'max', count: 1 })).toEqual([MAX_UUID]);
    await expect(generateUuids({ version: 'v5', count: 1, name: '' })).rejects.toThrow(/Enter a name/);
    await expect(generateUuids({ version: 'v4', count: 0 })).rejects.toThrow(/between 1 and/);
    await expect(generateUuids({ version: 'v4', count: 10_001 })).rejects.toThrow(UuidError);
  });
});

describe('formatting', () => {
  const list = ['2ed6657d-e927-568b-95e1-2665a8aea6a2', '5df41881-3aed-3515-88a7-2f4a814cf09e'];
  it('applies case, hyphen, brace, urn and quote options', () => {
    expect(formatUuids(list.slice(0, 1), { uppercase: true, removeHyphens: true })).toBe('2ED6657DE927568B95E12665A8AEA6A2');
    expect(formatUuids(list.slice(0, 1), { braces: true })).toBe('{2ed6657d-e927-568b-95e1-2665a8aea6a2}');
    expect(formatUuids(list.slice(0, 1), { urn: true })).toBe('urn:uuid:2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(formatUuids(list, { quotes: true, separator: 'comma' })).toBe(`"${list[0]}", "${list[1]}"`);
  });
  it('lays out lines and JSON arrays', async () => {
    expect(formatUuids(list)).toBe(list.join('\n'));
    expect(JSON.parse(formatUuids(list, { separator: 'json' }))).toEqual(list);
    expect(formatUuids([], { separator: 'json' })).toBe('[]');
    expect(await generate({ version: 'nil', count: 2, separator: 'comma' })).toBe(`${NIL_UUID}, ${NIL_UUID}`);
  });
});

describe('parsing', () => {
  it('normalises braces, urn, case and bare hex', () => {
    expect(normalizeUuid('{2ED6657D-E927-568B-95E1-2665A8AEA6A2}')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(normalizeUuid('urn:uuid:2ed6657de927568b95e12665a8aea6a2')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
  it('rejects bad input with reasons', () => {
    expect(() => normalizeUuid('xyz')).toThrow(/Invalid character "x"/);
    expect(() => normalizeUuid('2ed6657d-e927-568b-95e2')).toThrow(/32 hex digits/);
    expect(() => normalizeUuid('2ed6657de-927-568b-95e2-2cb1d1a0b5a5')).toThrow(/wrong places/);
    expect(() => normalizeUuid('')).toThrow(/Paste a UUID/);
    expect(isValidUuid('2ed6657d-e927-568b-95e1-2665a8aea6a2')).toBe(true);
    expect(isValidUuid('nope')).toBe(false);
  });
  it('reports version, variant and special UUIDs', () => {
    expect(parseUuid('2ed6657d-e927-568b-95e1-2665a8aea6a2')).toMatchObject({ version: 5, variant: 'RFC 9562', versionLabel: 'Name-based (SHA-1)' });
    expect(parseUuid(NIL_UUID).versionLabel).toBe('Nil UUID');
    expect(parseUuid(MAX_UUID).versionLabel).toBe('Max UUID');
    expect(parseUuid('00000000-0000-4000-c000-000000000000').variant).toBe('Microsoft');
    expect(parseUuid('2ed6657d-e927-568b-95e1-2665a8aea6a2').timestamp).toBeUndefined();
  });
});
