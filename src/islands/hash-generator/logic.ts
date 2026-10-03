/**
 * Hash Generator: pure helpers around hash-wasm. Text or a stream of byte chunks is
 * hashed with every selected algorithm at once (a file is read exactly once), digests
 * are formatted as hex or Base64 and compared against an expected value. hash-wasm is
 * imported lazily and cached so the page bundle stays small.
 */
import type { IHasher } from 'hash-wasm';

export class HashError extends Error {
  override name = 'HashError';
}

export type AlgorithmId = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512' | 'sha3-256' | 'sha3-512' | 'blake2b-512' | 'blake3' | 'ripemd160' | 'crc32' | 'xxhash64';

export type Security = 'strong' | 'broken' | 'checksum';

export interface Algorithm {
  id: AlgorithmId;
  label: string;
  /** Digest size in bits. */
  bits: number;
  /** Whether HMAC is offered (cryptographic hashes with a block size). */
  hmac: boolean;
  security: Security;
  /** Short note shown as a badge. */
  note: string;
}

export const ALGORITHMS: readonly Algorithm[] = [
  { id: 'md5', label: 'MD5', bits: 128, hmac: true, security: 'broken', note: 'Broken, do not use for security' },
  { id: 'sha1', label: 'SHA-1', bits: 160, hmac: true, security: 'broken', note: 'Broken, do not use for security' },
  { id: 'sha256', label: 'SHA-256', bits: 256, hmac: true, security: 'strong', note: 'Recommended' },
  { id: 'sha384', label: 'SHA-384', bits: 384, hmac: true, security: 'strong', note: 'Secure' },
  { id: 'sha512', label: 'SHA-512', bits: 512, hmac: true, security: 'strong', note: 'Secure' },
  { id: 'sha3-256', label: 'SHA3-256', bits: 256, hmac: true, security: 'strong', note: 'Secure' },
  { id: 'sha3-512', label: 'SHA3-512', bits: 512, hmac: true, security: 'strong', note: 'Secure' },
  { id: 'blake2b-512', label: 'BLAKE2b-512', bits: 512, hmac: true, security: 'strong', note: 'Secure, fast' },
  { id: 'blake3', label: 'BLAKE3', bits: 256, hmac: false, security: 'strong', note: 'Secure, very fast' },
  { id: 'ripemd160', label: 'RIPEMD-160', bits: 160, hmac: true, security: 'strong', note: 'Legacy (Bitcoin addresses)' },
  { id: 'crc32', label: 'CRC32', bits: 32, hmac: false, security: 'checksum', note: 'Fast checksum, not cryptographic' },
  { id: 'xxhash64', label: 'xxHash64', bits: 64, hmac: false, security: 'checksum', note: 'Fast checksum, not cryptographic' },
];

export const ALGORITHM_IDS: readonly AlgorithmId[] = ALGORITHMS.map((a) => a.id);
export const DEFAULT_ALGORITHMS: readonly AlgorithmId[] = ['md5', 'sha1', 'sha256', 'sha512'];

export function isAlgorithmId(value: unknown): value is AlgorithmId {
  return typeof value === 'string' && (ALGORITHM_IDS as readonly string[]).includes(value);
}

export function getAlgorithm(id: string): Algorithm {
  const algo = ALGORITHMS.find((a) => a.id === id);
  if (!algo) throw new HashError(`Unknown algorithm "${id}". Choose one of ${ALGORITHM_IDS.join(', ')}.`);
  return algo;
}

/** Default chunk size for streaming files: 4 MiB keeps the UI responsive. */
export const CHUNK_SIZE = 4 * 1024 * 1024;
/** Largest file the UI accepts. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

const encoder = new TextEncoder();

// --- lazy library ------------------------------------------------------------

type HashWasm = typeof import('hash-wasm');
let libPromise: Promise<HashWasm> | undefined;

export function loadHashWasm(): Promise<HashWasm> {
  libPromise ??= import('hash-wasm');
  return libPromise;
}

export function isHashWasmReady(): boolean {
  return libPromise !== undefined;
}

async function createRaw(id: AlgorithmId): Promise<IHasher> {
  const lib = await loadHashWasm();
  switch (id) {
    case 'md5':
      return lib.createMD5();
    case 'sha1':
      return lib.createSHA1();
    case 'sha256':
      return lib.createSHA256();
    case 'sha384':
      return lib.createSHA384();
    case 'sha512':
      return lib.createSHA512();
    case 'sha3-256':
      return lib.createSHA3(256);
    case 'sha3-512':
      return lib.createSHA3(512);
    case 'blake2b-512':
      return lib.createBLAKE2b(512);
    case 'blake3':
      return lib.createBLAKE3();
    case 'ripemd160':
      return lib.createRIPEMD160();
    case 'crc32':
      return lib.createCRC32();
    case 'xxhash64':
      return lib.createXXHash64();
  }
}

/**
 * Create an initialised hasher for an algorithm, wrapped in HMAC when a key is given.
 * Returns null when the algorithm cannot be used as an HMAC and a key was supplied.
 */
export async function createHasher(id: AlgorithmId, hmacKey?: string): Promise<IHasher | null> {
  const algo = getAlgorithm(id);
  if (hmacKey !== undefined && hmacKey !== '') {
    if (!algo.hmac) return null;
    const lib = await loadHashWasm();
    const hasher = await lib.createHMAC(createRaw(id), encoder.encode(hmacKey));
    hasher.init();
    return hasher;
  }
  const hasher = await createRaw(id);
  hasher.init();
  return hasher;
}

// --- digesting ---------------------------------------------------------------

export interface HashOptions {
  /** HMAC secret. When set, algorithms without HMAC support yield null. */
  hmacKey?: string | undefined;
}

/** Lower-case hex digests keyed by algorithm; null when HMAC was requested but is unsupported. */
export type DigestTable = Partial<Record<AlgorithmId, string | null>>;

/**
 * Hash a stream of byte chunks with every selected algorithm at once. `onProgress`
 * receives the number of bytes consumed so far.
 */
export async function digestChunks(
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  algorithms: readonly AlgorithmId[],
  options: HashOptions = {},
  onProgress?: (bytesDone: number) => void,
): Promise<DigestTable> {
  const hashers = await Promise.all(algorithms.map((id) => createHasher(id, options.hmacKey)));
  let done = 0;
  for await (const chunk of chunks) {
    for (const h of hashers) h?.update(chunk);
    done += chunk.length;
    onProgress?.(done);
  }
  const table: DigestTable = {};
  algorithms.forEach((id, i) => {
    const h = hashers[i];
    table[id] = h ? h.digest('hex') : null;
  });
  return table;
}

export function digestBytes(bytes: Uint8Array, algorithms: readonly AlgorithmId[], options: HashOptions = {}): Promise<DigestTable> {
  return digestChunks([bytes], algorithms, options);
}

/** Hash a UTF-8 string (or, with `hexInput`, the bytes written as hex) with every selected algorithm. */
export function hashText(text: string, algorithms: readonly AlgorithmId[], options: HashOptions & { hexInput?: boolean } = {}): Promise<DigestTable> {
  const bytes = options.hexInput ? hexToBytes(text) : encoder.encode(text);
  return digestBytes(bytes, algorithms, options);
}

/** Split a Blob into fixed-size chunks lazily (never holds the whole file in memory). */
export async function* chunkBlob(blob: Blob, chunkSize = CHUNK_SIZE): AsyncGenerator<Uint8Array> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new HashError(`Chunk size must be a positive whole number of bytes, got ${chunkSize}.`);
  if (blob.size === 0) {
    yield new Uint8Array(0);
    return;
  }
  for (let offset = 0; offset < blob.size; offset += chunkSize) {
    const slice = blob.slice(offset, Math.min(offset + chunkSize, blob.size));
    yield new Uint8Array(await slice.arrayBuffer());
  }
}

/** Hash a Blob or File by streaming it in chunks. */
export function hashBlob(blob: Blob, algorithms: readonly AlgorithmId[], options: HashOptions = {}, onProgress?: (bytesDone: number) => void): Promise<DigestTable> {
  if (blob.size > MAX_FILE_BYTES) throw new HashError(`The file is larger than the ${formatBytes(MAX_FILE_BYTES)} limit.`);
  return digestChunks(chunkBlob(blob), algorithms, options, onProgress);
}

/** Hash with one algorithm; convenient for one-off checks and tests. */
export async function hashOne(algorithm: AlgorithmId, data: string | Uint8Array, hmacKey?: string): Promise<string> {
  const table = await digestChunks([typeof data === 'string' ? encoder.encode(data) : data], [algorithm], { hmacKey });
  const digest = table[algorithm];
  if (digest === null || digest === undefined) throw new HashError(`${getAlgorithm(algorithm).label} does not support HMAC. Use one of the SHA algorithms.`);
  return digest;
}

// --- encoding ----------------------------------------------------------------

/** Parse hex text (spaces, colons, dashes and a 0x prefix allowed) into bytes. */
export function hexToBytes(text: string): Uint8Array {
  const clean = text.replace(/^\s*0x/i, '').replace(/[\s:,-]/g, '');
  if (clean === '') return new Uint8Array(0);
  if (clean.length % 2 !== 0) throw new HashError('Hex input has an odd number of digits; every byte needs two.');
  const bad = /[^0-9a-fA-F]/.exec(clean);
  if (bad) throw new HashError(`"${bad[0]}" is not a hex digit. Hex input may contain 0-9, a-f, spaces, colons and dashes only.`);
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function hexToBase64(hex: string): string {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new HashError(`"${clean}" is not a valid hex digest.`);
  let binary = '';
  for (let i = 0; i < clean.length; i += 2) binary += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return btoa(binary);
}

/** Convert Base64 (standard or URL-safe) to lower-case hex; null when the text is not Base64. */
export function base64ToHex(b64: string): string | null {
  const s = b64.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (s === '' || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const padded = s + '='.repeat((4 - (s.length % 4)) % 4);
  try {
    const binary = atob(padded);
    let hex = '';
    for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
    return hex;
  } catch {
    return null;
  }
}

export interface FormatOptions {
  uppercase?: boolean;
  base64?: boolean;
}

/** Present a hex digest as asked: hex (lower or upper case) or Base64. */
export function formatDigest(hex: string, options: FormatOptions = {}): string {
  if (options.base64) return hexToBase64(hex);
  return options.uppercase ? hex.toUpperCase() : hex.toLowerCase();
}

// --- comparing ---------------------------------------------------------------

export type CompareResult = { status: 'empty' } | { status: 'match'; algorithm: AlgorithmId; label: string } | { status: 'no-match' };

/**
 * Compare an expected digest (hex or Base64, any case, surrounding whitespace and a
 * leading "sha256:" style prefix ignored) against every computed digest.
 */
export function compareHash(expected: string, table: DigestTable): CompareResult {
  const raw = expected.replace(/^﻿/, '').trim();
  if (raw === '') return { status: 'empty' };
  const forms = [raw];
  const withoutPrefix = raw.replace(/^[a-z0-9-]+\s*[:=]\s*/i, '');
  if (withoutPrefix !== raw) forms.push(withoutPrefix);
  const candidates = new Set<string>();
  for (const form of forms) {
    const hexLike = form.replace(/[\s:-]/g, '').toLowerCase();
    if (/^[0-9a-f]+$/.test(hexLike)) candidates.add(hexLike);
    const fromB64 = base64ToHex(form);
    if (fromB64) candidates.add(fromB64);
  }
  for (const algo of ALGORITHMS) {
    const digest = table[algo.id];
    if (!digest) continue;
    if (candidates.has(digest.toLowerCase())) return { status: 'match', algorithm: algo.id, label: algo.label };
  }
  return { status: 'no-match' };
}

/** Which algorithms could have produced a digest, judged by its length in hex characters. */
export function guessAlgorithmByLength(digest: string): Algorithm[] {
  const hex = digest.trim().replace(/[\s:-]/g, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return [];
  return ALGORITHMS.filter((a) => a.bits / 4 === hex.length);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** "sha256: abc..." lines for Copy all. */
export function tableToText(table: DigestTable, algorithms: readonly AlgorithmId[], format: FormatOptions, hmac: boolean): string {
  return algorithms
    .map((id) => {
      const d = table[id];
      if (d === undefined || d === null) return null;
      return `${hmac ? 'HMAC-' : ''}${getAlgorithm(id).label}: ${formatDigest(d, format)}`;
    })
    .filter((l): l is string => l !== null)
    .join('\n');
}

export const SAMPLE_TEXT = 'The quick brown fox jumps over the lazy dog';
