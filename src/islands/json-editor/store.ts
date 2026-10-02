/**
 * Local document store. Documents live in this browser's localStorage only and are
 * addressed in the URL hash as `#left=local.abcdef&right=local.ghijkl`, so a reload or a
 * bookmark reopens the same two documents. Nothing is sent anywhere.
 */

export interface LocalDoc {
  id: string;
  name: string;
  text: string;
  /** Epoch ms */
  updated: number;
}

const INDEX_KEY = 'cuis-jed:index';
const DOC_PREFIX = 'cuis-jed:doc:';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

export function genId(): string {
  let id = '';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) id += LETTERS[b % 26];
  return id;
}

function readIndex(): string[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(ids: string[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch {}
}

export function loadDoc(id: string): LocalDoc | null {
  try {
    const raw = localStorage.getItem(DOC_PREFIX + id);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<LocalDoc>;
    if (typeof d.text !== 'string') return null;
    return { id, name: d.name || 'Untitled', text: d.text, updated: d.updated || 0 };
  } catch {
    return null;
  }
}

export function saveDoc(doc: LocalDoc): boolean {
  try {
    localStorage.setItem(DOC_PREFIX + doc.id, JSON.stringify({ name: doc.name, text: doc.text, updated: doc.updated }));
    const ids = readIndex();
    if (!ids.includes(doc.id)) writeIndex([doc.id, ...ids]);
    return true;
  } catch {
    return false; // quota exceeded or storage blocked
  }
}

export function deleteDoc(id: string): void {
  try {
    localStorage.removeItem(DOC_PREFIX + id);
  } catch {}
  writeIndex(readIndex().filter((x) => x !== id));
}

export function listDocs(): LocalDoc[] {
  return readIndex()
    .map(loadDoc)
    .filter((d): d is LocalDoc => !!d)
    .sort((a, b) => b.updated - a.updated);
}

export function nextDocName(): string {
  const names = new Set(listDocs().map((d) => d.name));
  let n = 1;
  while (names.has(`New document ${n}`)) n++;
  return `New document ${n}`;
}

export function createDoc(text = '', name?: string): LocalDoc {
  const doc: LocalDoc = { id: genId(), name: name ?? nextDocName(), text, updated: Date.now() };
  saveDoc(doc);
  return doc;
}

/** True when this browser has never stored a document before. */
export function isFirstVisit(): boolean {
  return readIndex().length === 0;
}

// ---------------------------------------------------------------- URL hash

export interface HashState {
  left?: string;
  right?: string;
  /** Legacy share payload (`#d=...`) from the previous editor version. */
  share?: string;
}

export function readHash(): HashState {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const pick = (k: string) => {
    const v = p.get(k);
    const m = v && /^local\.([a-z]{4,12})$/.exec(v);
    return m ? m[1] : undefined;
  };
  return { left: pick('left'), right: pick('right'), share: p.get('d') ?? undefined };
}

export function writeHash(left: string | null, right: string | null): void {
  const parts: string[] = [];
  if (left) parts.push(`left=local.${left}`);
  if (right) parts.push(`right=local.${right}`);
  const next = parts.length ? `#${parts.join('&')}` : '';
  if (location.hash !== next) history.replaceState(null, '', location.pathname + location.search + next);
}

export function formatBytesShort(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}
