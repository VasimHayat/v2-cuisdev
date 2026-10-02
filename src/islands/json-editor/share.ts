/**
 * Share-by-link: the document is deflate-compressed with the browser's native
 * CompressionStream and stored in the URL fragment, which browsers never send to the server.
 * So a shared link carries the data without it ever touching Cuisdev.
 */

const PARAM = 'd';
/** Browsers and chat apps start truncating URLs around 16-32 KB; stay well under. */
export const MAX_SHARE_BYTES = 12_000;

export function canShare(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export async function encodeShare(text: string): Promise<string | null> {
  if (!canShare()) return null;
  const bytes = await pipe(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
  if (bytes.length > MAX_SHARE_BYTES) return null;
  return toBase64Url(bytes);
}

export async function decodeShare(hash: string): Promise<string | null> {
  if (!canShare()) return null;
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const data = params.get(PARAM);
  if (!data) return null;
  try {
    const bytes = await pipe(fromBase64Url(data), new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export function shareUrl(encoded: string): string {
  const url = new URL(location.href);
  url.hash = `${PARAM}=${encoded}`;
  return url.toString();
}

export function clearShareHash(): void {
  if (location.hash.includes(`${PARAM}=`)) history.replaceState(null, '', location.pathname + location.search);
}

async function pipe(input: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([input as BlobPart]).stream().pipeThrough(transform as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
