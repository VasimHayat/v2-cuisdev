/**
 * Zip helper shared by the batch islands. fflate is loaded lazily the first time a
 * zip is built. Already-compressed formats (images, PDF) are stored rather than
 * deflated, which is faster and makes no size difference.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array | Blob | string;
}

const STORED = /\.(png|jpe?g|webp|avif|gif|pdf|zip|gz|ico)$/i;

/** Make names unique inside one archive: photo.png, photo (2).png, ... */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const name = raw.replace(/[\\/:*?"<>|]+/g, '-') || 'file';
    const key = name.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return name;
    const dot = name.lastIndexOf('.');
    return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
  });
}

export async function buildZip(entries: readonly ZipEntry[]): Promise<Blob> {
  const { zip } = await import('fflate');
  const names = uniqueNames(entries.map((e) => e.name));
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const bytes = typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data instanceof Blob ? new Uint8Array(await e.data.arrayBuffer()) : e.data;
    files[names[i]!] = [bytes, { level: STORED.test(names[i]!) ? 0 : 6 }];
  }
  const out = await new Promise<Uint8Array>((resolve, reject) => zip(files, (err, data) => (err ? reject(err) : resolve(data))));
  return new Blob([out as BlobPart], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
