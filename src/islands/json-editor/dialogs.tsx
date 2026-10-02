import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { toast } from '../shared/toast';
import { formatBytesShort, timeAgo, type LocalDoc } from './store';

export function Modal({ title, onClose, children, width = 'max-w-md' }: { title: string; onClose: () => void; children: ComponentChildren; width?: string }) {
  return (
    <div class="absolute inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-[8vh] backdrop-blur-[1px]" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div class={'w-full rounded-xl border border-line-strong bg-surface shadow-float ' + width} onClick={(e) => e.stopPropagation()}>
        <div class="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 class="text-sm font-semibold text-ink">{title}</h3>
          <button type="button" class="btn-ghost btn-icon h-7 w-7" onClick={onClose} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div class="p-4">{children}</div>
      </div>
    </div>
  );
}

export function UrlModal({ onClose, onLoad }: { onClose: () => void; onLoad: (url: string) => Promise<boolean> }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    if (!/^https?:\/\//i.test(url.trim())) return toast('Enter a full URL starting with https://', 'error');
    setBusy(true);
    const ok = await onLoad(url.trim());
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal title="Open JSON from a URL" onClose={onClose}>
      <form onSubmit={submit} class="space-y-3">
        <input class="input" type="url" placeholder="https://api.example.com/data.json" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} ref={(el) => {
            if (el) setTimeout(() => el.focus(), 0);
          }} required />
        <p class="text-xs text-ink-3">Your browser fetches the URL directly. The server must allow cross-origin requests (CORS). Nothing is sent to Cuisdev.</p>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" class="btn-primary btn-sm" disabled={busy}>
            {busy && <Icon name="loader" size={13} class="animate-spin" />} Load
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function LocalDocsModal({ docs, openIds, onClose, onOpen, onDelete }: { docs: LocalDoc[]; openIds: string[]; onClose: () => void; onOpen: (doc: LocalDoc) => void; onDelete: (doc: LocalDoc) => void }) {
  return (
    <Modal title="Documents stored in this browser" onClose={onClose} width="max-w-lg">
      {docs.length === 0 ? (
        <p class="py-4 text-center text-sm text-ink-3">No saved documents yet. Anything you type is saved here automatically.</p>
      ) : (
        <ul class="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-md border border-line scrollbar-thin">
          {docs.map((d) => {
            const open = openIds.includes(d.id);
            return (
              <li key={d.id} class="flex items-center gap-3 px-3 py-2 text-sm">
                <Icon name="file-json" size={16} class="shrink-0 text-ink-3" />
                <button type="button" class="min-w-0 flex-1 text-left hover:text-brand-600" onClick={() => onOpen(d)} title="Open in this panel">
                  <span class="block truncate font-medium text-ink">{d.name}{open && <span class="ml-2 badge border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-900/40 dark:text-brand-300">open</span>}</span>
                  <span class="block text-xs text-ink-3">{formatBytesShort(new TextEncoder().encode(d.text).length)} · {timeAgo(d.updated)} · local.{d.id}</span>
                </button>
                <button type="button" class="btn-ghost btn-icon h-7 w-7 text-ink-3 hover:text-danger" title="Delete" aria-label={`Delete ${d.name}`} onClick={() => onDelete(d)}>
                  <Icon name="trash" size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p class="mt-3 text-[11px] text-ink-3">Documents never leave this browser. Clearing site data removes them.</p>
    </Modal>
  );
}

export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['Ctrl + I', 'Format (text mode)'],
    ['Ctrl + Shift + I', 'Compact (text mode)'],
    ['Ctrl + F', 'Find and replace'],
    ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / Redo'],
    ['Ctrl + S', 'Save the focused document to disk'],
    ['Ctrl + D', 'Duplicate selected (tree mode)'],
    ['Ctrl + Enter', 'Edit value (tree mode)'],
    ['Ctrl + Arrows', 'Move selection (tree mode)'],
    ['Ctrl + E', 'Expand / collapse (tree mode)'],
    ['Esc', 'Close dialogs, exit full screen'],
  ];
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose} width="max-w-lg">
      <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        {rows.map(([k, d]) => (
          <>
            <dt class="whitespace-nowrap">
              {k.split(' + ').map((p, i, arr) => (
                <>
                  <span class="kbd">{p}</span>
                  {i < arr.length - 1 && <span class="mx-0.5 text-ink-3">+</span>}
                </>
              ))}
            </dt>
            <dd class="text-ink-2">{d}</dd>
          </>
        ))}
      </dl>
      <p class="mt-4 text-xs text-ink-3">On macOS use Cmd instead of Ctrl. Right-click any node in tree mode for the full context menu.</p>
    </Modal>
  );
}
