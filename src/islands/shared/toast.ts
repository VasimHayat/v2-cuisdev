/** Tiny toast used by every island. Renders into #toast-root in BaseLayout. */
export function toast(message: string, kind: 'ok' | 'error' = 'ok', ms = 2200): void {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const el = document.createElement('div');
  el.className =
    'pointer-events-auto rounded-md border px-3.5 py-2 text-sm shadow-float transition-all duration-200 translate-y-2 opacity-0 ' +
    (kind === 'ok'
      ? 'border-line-strong bg-surface text-ink'
      : 'border-danger/40 bg-surface text-danger');
  el.textContent = message;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.remove('translate-y-2', 'opacity-0'));
  setTimeout(() => {
    el.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => el.remove(), 220);
  }, ms);
}

/** Fire a GA4 event through the Analytics listener without importing gtag anywhere. */
export function track(name: string, params: Record<string, unknown> = {}): void {
  window.dispatchEvent(new CustomEvent('cuis:track', { detail: { name, params } }));
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
