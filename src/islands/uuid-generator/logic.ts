/**
 * UUID Generator: pure functions, no DOM.
 *
 * Generates RFC 9562 UUIDs (v4 random, v7 time-ordered, v1 Gregorian time-based, v3 and
 * v5 name-based, nil and max), formats batches for pasting into code, and parses
 * existing UUIDs (version, variant and the embedded timestamp for v1, v6 and v7).
 * Only v3 and v5 are async, because they hash.
 */
import { md5 } from 'hash-wasm';

export class UuidError extends Error {
  override name = 'UuidError';
}

export type UuidVersion = 'v4' | 'v7' | 'v1' | 'v5' | 'v3' | 'nil' | 'max';
export type Separator = 'lines' | 'comma' | 'json';

export interface FormatOptions {
  uppercase?: boolean;
  removeHyphens?: boolean;
  braces?: boolean;
  /** Wrap each UUID in double quotes (lines / comma only; JSON is always quoted). */
  quotes?: boolean;
  /** Prefix each UUID with urn:uuid: */
  urn?: boolean;
  separator?: Separator;
}

export interface GenerateOptions extends FormatOptions {
  version: UuidVersion;
  count: number;
  /** v3 / v5: namespace UUID and name. */
  namespace?: string;
  name?: string;
}

export type Variant = 'NCS' | 'RFC 9562' | 'Microsoft' | 'Reserved';

export interface ParsedUuid {
  /** Canonical lower-case hyphenated form. */
  uuid: string;
  /** 0 for nil, max and non-RFC variants, otherwise the version nibble. */
  version: number;
  versionLabel: string;
  variant: Variant;
  /** Embedded timestamp for v1, v6 and v7. */
  timestamp?: Date;
  summary: string;
}

export const MIN_COUNT = 1;
export const MAX_COUNT = 10_000;
export const NIL_UUID = '00000000-0000-0000-0000-000000000000';
export const MAX_UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

export const NAMESPACES: { id: string; label: string; uuid: string }[] = [
  { id: 'dns', label: 'DNS', uuid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
  { id: 'url', label: 'URL', uuid: '6ba7b811-9dad-11d1-80b4-00c04fd430c8' },
  { id: 'oid', label: 'ISO OID', uuid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8' },
  { id: 'x500', label: 'X.500 DN', uuid: '6ba7b814-9dad-11d1-80b4-00c04fd430c8' },
];

export const VERSIONS: { id: UuidVersion; label: string; hint: string }[] = [
  { id: 'v4', label: 'v4', hint: 'Random. The default for almost everything.' },
  { id: 'v7', label: 'v7', hint: 'Time-ordered. Best for database keys.' },
  { id: 'v1', label: 'v1', hint: 'Gregorian time plus a random node id.' },
  { id: 'v5', label: 'v5', hint: 'SHA-1 of a namespace and a name. Deterministic.' },
  { id: 'v3', label: 'v3', hint: 'MD5 of a namespace and a name. Legacy deterministic.' },
];

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
/** 100-ns ticks between the Gregorian epoch (1582-10-15) and the Unix epoch. */
const GREGORIAN_OFFSET_100NS = 0x01b21dd213814000n;
const encoder = new TextEncoder();

/** Random bytes source, injectable for tests. Must fill and return `bytes`. */
export type RandomSource = (bytes: Uint8Array) => Uint8Array;

const defaultRandom: RandomSource = (bytes) => {
  crypto.getRandomValues(bytes);
  return bytes;
};

// --- bytes -------------------------------------------------------------------

export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== 16) throw new UuidError(`A UUID needs exactly 16 bytes, got ${bytes.length}.`);
  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += '-';
    s += HEX[bytes[i] as number];
  }
  return s;
}

export function uuidToBytes(input: string): Uint8Array {
  const hex = normalizeUuid(input).replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function setVersionAndVariant(bytes: Uint8Array, version: number): Uint8Array {
  bytes[6] = ((bytes[6] as number) & 0x0f) | (version << 4);
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  return bytes;
}

// --- generators ----------------------------------------------------------------

export function uuidV4(random: RandomSource = defaultRandom): string {
  if (random === defaultRandom && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return bytesToUuid(setVersionAndVariant(random(new Uint8Array(16)), 4));
}

/**
 * Version 7 from a Unix millisecond timestamp and 74 random bits (RFC 9562 section 5.7).
 * `randA` may be supplied to implement a monotonic counter (section 6.2, method 1).
 */
export function uuidV7(timestampMs: number = Date.now(), random: RandomSource = defaultRandom, randA?: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs < 0 || timestampMs >= 2 ** 48) throw new UuidError(`Timestamp ${String(timestampMs)} is out of range: v7 UUIDs hold 48 bits of milliseconds.`);
  const ts = Math.floor(timestampMs);
  const bytes = random(new Uint8Array(16));
  const hi = Math.floor(ts / 2 ** 32);
  const lo = ts % 2 ** 32;
  bytes[0] = (hi >>> 8) & 0xff;
  bytes[1] = hi & 0xff;
  bytes[2] = (lo >>> 24) & 0xff;
  bytes[3] = (lo >>> 16) & 0xff;
  bytes[4] = (lo >>> 8) & 0xff;
  bytes[5] = lo & 0xff;
  if (randA !== undefined) {
    const a = randA & 0x0fff;
    bytes[6] = a >>> 8;
    bytes[7] = a & 0xff;
  }
  return bytesToUuid(setVersionAndVariant(bytes, 7));
}

function randomCounterSeed(random: RandomSource): number {
  const b = random(new Uint8Array(2));
  return (((b[0] as number) << 8) | (b[1] as number)) & 0x07ff;
}

/** A strictly monotonic v7 generator: same-millisecond UUIDs increment a 12-bit counter. */
export function createV7Generator(now: () => number = Date.now, random: RandomSource = defaultRandom): () => string {
  let lastTs = -1;
  let counter = 0;
  return () => {
    let ts = Math.max(now(), lastTs);
    if (ts === lastTs) {
      counter++;
      if (counter > 0x0fff) {
        ts++;
        counter = randomCounterSeed(random);
      }
    } else counter = randomCounterSeed(random);
    lastTs = ts;
    return uuidV7(ts, random, counter);
  };
}

/**
 * Version 1: 60-bit Gregorian timestamp (100-ns ticks since 1582-10-15), a 14-bit clock
 * sequence and a 48-bit node. Browsers have no MAC address, so the node is random with
 * the multicast bit set, as RFC 9562 section 6.10 recommends.
 */
export function createV1Generator(now: () => number = Date.now, random: RandomSource = defaultRandom): () => string {
  const node = random(new Uint8Array(6));
  node[0] = (node[0] as number) | 0x01;
  const seq = random(new Uint8Array(2));
  let clockSeq = (((seq[0] as number) << 8) | (seq[1] as number)) & 0x3fff;
  let lastTicks = -1n;
  return () => {
    let ticks = BigInt(now()) * 10000n + GREGORIAN_OFFSET_100NS;
    if (ticks <= lastTicks) ticks = lastTicks + 1n;
    else if (lastTicks !== -1n && ticks < lastTicks) clockSeq = (clockSeq + 1) & 0x3fff;
    lastTicks = ticks;
    const timeLow = Number(ticks & 0xffffffffn);
    const timeMid = Number((ticks >> 32n) & 0xffffn);
    const timeHi = Number((ticks >> 48n) & 0x0fffn);
    const bytes = new Uint8Array(16);
    bytes[0] = (timeLow >>> 24) & 0xff;
    bytes[1] = (timeLow >>> 16) & 0xff;
    bytes[2] = (timeLow >>> 8) & 0xff;
    bytes[3] = timeLow & 0xff;
    bytes[4] = (timeMid >>> 8) & 0xff;
    bytes[5] = timeMid & 0xff;
    bytes[6] = (timeHi >>> 8) & 0xff;
    bytes[7] = timeHi & 0xff;
    bytes[8] = (clockSeq >>> 8) & 0xff;
    bytes[9] = clockSeq & 0xff;
    bytes.set(node, 10);
    return bytesToUuid(setVersionAndVariant(bytes, 1));
  };
}

export function uuidV1(now: () => number = Date.now, random: RandomSource = defaultRandom): string {
  return createV1Generator(now, random)();
}

async function nameBased(namespace: string, name: string, version: 3 | 5): Promise<string> {
  const ns = uuidToBytes(namespace);
  const nameBytes = encoder.encode(name);
  const data = new Uint8Array(ns.length + nameBytes.length);
  data.set(ns, 0);
  data.set(nameBytes, ns.length);
  let hash: Uint8Array;
  if (version === 5) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new UuidError('WebCrypto is not available, so v5 UUIDs cannot be generated here.');
    hash = new Uint8Array(await subtle.digest('SHA-1', data));
  } else {
    const hex = await md5(data);
    hash = new Uint8Array(16);
    for (let i = 0; i < 16; i++) hash[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytesToUuid(setVersionAndVariant(hash.slice(0, 16), version));
}

/** Version 5: SHA-1 of namespace + name. Deterministic. */
export function uuidV5(namespace: string, name: string): Promise<string> {
  return nameBased(namespace, name, 5);
}

/** Version 3: MD5 of namespace + name. Deterministic, legacy. */
export function uuidV3(namespace: string, name: string): Promise<string> {
  return nameBased(namespace, name, 3);
}

/** Resolve a namespace select value (well-known id or a custom UUID) to a UUID. */
export function resolveNamespace(value: string): string {
  const known = NAMESPACES.find((n) => n.id === value);
  if (known) return known.uuid;
  try {
    return normalizeUuid(value);
  } catch {
    throw new UuidError('The namespace must be DNS, URL, OID, X500 or a valid UUID.');
  }
}

export function validateCount(count: number): number {
  if (!Number.isInteger(count) || count < MIN_COUNT || count > MAX_COUNT) throw new UuidError(`Count must be a whole number between ${MIN_COUNT} and ${MAX_COUNT.toLocaleString()}, got ${String(count)}.`);
  return count;
}

/** Produce a batch of canonical lower-case UUIDs. */
export async function generateUuids(options: GenerateOptions, random: RandomSource = defaultRandom, now: () => number = Date.now): Promise<string[]> {
  const count = validateCount(options.count);
  const out = new Array<string>(count);
  switch (options.version) {
    case 'v4':
      for (let i = 0; i < count; i++) out[i] = uuidV4(random);
      break;
    case 'v7': {
      const next = createV7Generator(now, random);
      for (let i = 0; i < count; i++) out[i] = next();
      break;
    }
    case 'v1': {
      const next = createV1Generator(now, random);
      for (let i = 0; i < count; i++) out[i] = next();
      break;
    }
    case 'v5':
    case 'v3': {
      const name = options.name ?? '';
      if (name === '') throw new UuidError('Enter a name to hash. Name-based UUIDs are derived from the namespace and the name.');
      const ns = resolveNamespace(options.namespace ?? 'dns');
      const one = options.version === 'v5' ? await uuidV5(ns, name) : await uuidV3(ns, name);
      // The same name always gives the same UUID; a batch repeats it.
      out.fill(one);
      break;
    }
    case 'nil':
      out.fill(NIL_UUID);
      break;
    case 'max':
      out.fill(MAX_UUID);
      break;
    default:
      throw new UuidError(`Unknown UUID version "${String(options.version)}".`);
  }
  return out;
}

// --- formatting ------------------------------------------------------------------

export function formatOne(uuid: string, options: FormatOptions = {}): string {
  let s = uuid;
  if (options.removeHyphens) s = s.replace(/-/g, '');
  if (options.uppercase) s = s.toUpperCase();
  if (options.urn) s = `urn:uuid:${s}`;
  if (options.braces) s = `{${s}}`;
  return s;
}

/** Apply case, hyphen, brace, quote, URN and layout options to a list. */
export function formatUuids(uuids: readonly string[], options: FormatOptions = {}): string {
  const items = uuids.map((u) => formatOne(u, options));
  switch (options.separator ?? 'lines') {
    case 'lines':
      return items.map((s) => (options.quotes ? `"${s}"` : s)).join('\n');
    case 'comma':
      return items.map((s) => (options.quotes ? `"${s}"` : s)).join(', ');
    case 'json':
      return items.length === 0 ? '[]' : `[\n${items.map((s) => `  "${s}"`).join(',\n')}\n]`;
    default:
      throw new UuidError(`Unknown separator "${String(options.separator)}".`);
  }
}

/** Generate and format in one step. */
export async function generate(options: GenerateOptions, random: RandomSource = defaultRandom, now: () => number = Date.now): Promise<string> {
  return formatUuids(await generateUuids(options, random, now), options);
}

// --- parsing ---------------------------------------------------------------------

/** Normalise to canonical lower-case hyphenated form; accepts braces, urn:uuid: and bare hex. */
export function normalizeUuid(input: string): string {
  let s = input.replace(/^﻿/, '').trim();
  if (s === '') throw new UuidError('Paste a UUID to inspect it.');
  if (s.startsWith('{') && s.endsWith('}')) s = s.slice(1, -1);
  s = s.replace(/^urn:uuid:/i, '').replace(/^["']|["']$/g, '').toLowerCase();
  const bare = s.replace(/-/g, '');
  const bad = /[^0-9a-f]/.exec(bare);
  if (bad) throw new UuidError(`Invalid character "${bad[0]}": a UUID only contains hex digits (0-9, a-f) and hyphens.`);
  if (bare.length !== 32) throw new UuidError(`A UUID has 32 hex digits, this one has ${bare.length}. Check for missing or extra characters.`);
  if (s.includes('-') && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) throw new UuidError('Hyphens are in the wrong places: the canonical layout is 8-4-4-4-12 hex digits.');
  return `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}`;
}

export function isValidUuid(input: string): boolean {
  try {
    normalizeUuid(input);
    return true;
  } catch {
    return false;
  }
}

const VERSION_LABELS: Record<number, string> = {
  1: 'Gregorian time-based',
  2: 'DCE Security',
  3: 'Name-based (MD5)',
  4: 'Random',
  5: 'Name-based (SHA-1)',
  6: 'Reordered Gregorian time-based',
  7: 'Unix Epoch time-based',
  8: 'Custom / experimental',
};

/** Inspect a UUID: version, variant and embedded timestamp where one exists. */
export function parseUuid(input: string): ParsedUuid {
  const uuid = normalizeUuid(input);
  const bytes = uuidToBytes(uuid);
  if (uuid === NIL_UUID) return { uuid, version: 0, versionLabel: 'Nil UUID', variant: 'NCS', summary: 'Nil UUID: all 128 bits are zero (RFC 9562 section 5.9).' };
  if (uuid === MAX_UUID) return { uuid, version: 0, versionLabel: 'Max UUID', variant: 'Reserved', summary: 'Max UUID: all 128 bits are one (RFC 9562 section 5.10).' };
  const variantByte = bytes[8] as number;
  let variant: Variant;
  if ((variantByte & 0x80) === 0) variant = 'NCS';
  else if ((variantByte & 0xc0) === 0x80) variant = 'RFC 9562';
  else if ((variantByte & 0xe0) === 0xc0) variant = 'Microsoft';
  else variant = 'Reserved';
  if (variant !== 'RFC 9562') return { uuid, version: 0, versionLabel: 'Not an RFC 9562 UUID', variant, summary: `Variant "${variant}": this layout does not define a version field.` };
  const version = (bytes[6] as number) >> 4;
  const versionLabel = VERSION_LABELS[version] ?? 'Unknown version';
  const timestamp = extractTimestamp(bytes, version);
  const parsed: ParsedUuid = { uuid, version, versionLabel, variant, summary: `Version ${version} (${versionLabel}), variant ${variant}.` };
  if (timestamp) parsed.timestamp = timestamp;
  return parsed;
}

/** Pull the embedded timestamp out of a v1, v6 or v7 UUID's bytes. */
export function extractTimestamp(bytes: Uint8Array, version: number): Date | undefined {
  const b = (i: number) => BigInt(bytes[i] as number);
  if (version === 7) {
    let ms = 0n;
    for (let i = 0; i < 6; i++) ms = (ms << 8n) | b(i);
    return new Date(Number(ms));
  }
  if (version === 1) {
    const timeLow = (b(0) << 24n) | (b(1) << 16n) | (b(2) << 8n) | b(3);
    const timeMid = (b(4) << 8n) | b(5);
    const timeHi = ((b(6) & 0x0fn) << 8n) | b(7);
    return gregorianTicksToDate((timeHi << 48n) | (timeMid << 32n) | timeLow);
  }
  if (version === 6) {
    const timeHigh = (b(0) << 24n) | (b(1) << 16n) | (b(2) << 8n) | b(3);
    const timeMid = (b(4) << 8n) | b(5);
    const timeLow = ((b(6) & 0x0fn) << 8n) | b(7);
    return gregorianTicksToDate((timeHigh << 28n) | (timeMid << 12n) | timeLow);
  }
  return undefined;
}

function gregorianTicksToDate(ticks: bigint): Date {
  const unix100ns = ticks - GREGORIAN_OFFSET_100NS;
  const ms = unix100ns >= 0n ? unix100ns / 10000n : -((-unix100ns + 9999n) / 10000n);
  return new Date(Number(ms));
}

/** Milliseconds encoded in a v7 UUID, or undefined for other versions. */
export function v7Timestamp(uuid: string): number | undefined {
  const parsed = parseUuid(uuid);
  return parsed.version === 7 ? parsed.timestamp?.getTime() : undefined;
}

/** "100 v7 UUIDs" for the status line. */
export function describe(version: UuidVersion, count: number): string {
  const label = version === 'nil' ? 'nil' : version === 'max' ? 'max' : version;
  return `${count.toLocaleString()} ${label} UUID${count === 1 ? '' : 's'}`;
}
