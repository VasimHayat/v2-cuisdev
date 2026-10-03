/**
 * Small UI pieces shared by the calculators: URL-backed state, a numeric field with a
 * unit suffix, a result card, a "working" line and the header with Copy link / Reset.
 */
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '../shared/icons';
import { copyText, toast, track } from '../shared/toast';
import { fromQuery, toQuery } from './numbers';

/**
 * State that round-trips through the URL query string (debounced replaceState) so a
 * result can be shared, falling back to localStorage when the URL carries no state.
 */
export function useUrlState<T extends Record<string, string>>(storageKey: string, defaults: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const fromUrl = fromQuery(window.location.search, defaults);
      if (Object.keys(fromUrl).length > 0) return { ...defaults, ...fromUrl };
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Partial<T> | null;
      if (saved && typeof saved === 'object') {
        const clean: Partial<T> = {};
        for (const k of Object.keys(defaults) as (keyof T)[]) {
          const v = saved[k];
          if (typeof v === 'string') clean[k] = v as T[keyof T];
        }
        return { ...defaults, ...clean };
      }
    } catch {}
    return defaults;
  });
  // Inputs are saved locally only. The address bar is never rewritten: GA4 records
  // history changes as page views, so inputs such as a weight or a bill would otherwise
  // leave the browser. A shared link is built on demand by `shareUrl` (Copy link).
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const set = (patch: Partial<T>) => setState((s) => ({ ...s, ...patch }));
  const reset = () => setState(defaults);
  /** A link that reopens the page with the current inputs (only what differs from defaults). */
  const shareUrl = () => {
    const changed: Record<string, string> = {};
    for (const k of Object.keys(defaults)) if (state[k] !== defaults[k]) changed[k] = state[k] as string;
    const q = toQuery(changed);
    return `${window.location.origin}${window.location.pathname}${q ? `?${q}` : ''}`;
  };
  return [state, set, reset, shareUrl] as const;
}

export function CalcHeader(p: { tool: string; title: string; subtitle?: string; onReset: () => void; shareUrl: () => string; children?: ComponentChildren }) {
  const copyLink = async () => {
    const ok = await copyText(p.shareUrl());
    toast(ok ? 'Link to this result copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: p.tool, action: 'copy_link' });
  };
  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
      <div class="min-w-0">
        <div class="text-sm font-semibold text-ink">{p.title}</div>
        {p.subtitle && <div class="text-xs text-ink-3">{p.subtitle}</div>}
      </div>
      {p.children}
      <span class="flex-1" />
      <div class="flex items-center gap-1">
        <button type="button" class="btn-secondary btn-sm" onClick={() => void copyLink()} title="Copy a link that reopens this calculation">
          <Icon name="link" size={14} /> Copy link
        </button>
        <button
          type="button"
          class="btn-ghost btn-sm"
          onClick={() => {
            p.onReset();
            track('tool_action', { tool: p.tool, action: 'reset' });
          }}
          title="Clear every input"
        >
          <Icon name="eraser" size={14} /> Reset
        </button>
      </div>
    </div>
  );
}

interface FieldProps {
  label?: string;
  value: string;
  onInput: (v: string) => void;
  suffix?: string;
  prefix?: string;
  placeholder?: string;
  invalid?: boolean;
  size?: 'md' | 'lg' | 'inline';
  ariaLabel?: string;
  class?: string;
}

/** Numeric text field: inputMode decimal, optional prefix/suffix, comma or dot accepted. */
export function NumField(p: FieldProps) {
  const size = p.size ?? 'md';
  const box =
    size === 'inline'
      ? 'h-9 w-24 sm:w-28 text-base'
      : size === 'lg'
        ? 'h-12 w-full text-xl'
        : 'h-10 w-full text-base';
  const input = (
    <span class={`relative inline-flex min-w-0 items-center ${size === 'inline' ? '' : 'w-full'} ${p.class ?? ''}`}>
      {p.prefix && <span class="pointer-events-none absolute left-3 text-sm text-ink-3">{p.prefix}</span>}
      <input
        type="text"
        inputMode="decimal"
        autocomplete="off"
        spellcheck={false}
        class={`${box} rounded-md border bg-surface font-mono tabular-nums text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 ${p.prefix ? 'pl-8' : 'pl-3'} ${p.suffix ? 'pr-12' : 'pr-3'} ${p.invalid ? 'border-danger' : 'border-line-strong'}`}
        value={p.value}
        placeholder={p.placeholder}
        aria-label={p.ariaLabel ?? p.label}
        aria-invalid={p.invalid || undefined}
        onInput={(e) => p.onInput((e.currentTarget as HTMLInputElement).value)}
      />
      {p.suffix && <span class="pointer-events-none absolute right-3 text-sm text-ink-3">{p.suffix}</span>}
    </span>
  );
  if (!p.label) return input;
  return (
    <label class="block min-w-0">
      <span class="mb-1 block text-xs font-medium text-ink-2">{p.label}</span>
      {input}
    </label>
  );
}

/** Big result figure with a label and optional copy. */
export function ResultCard(p: { label: string; value: string; hint?: string; tone?: 'brand' | 'plain' | 'success' | 'warning' | 'danger'; copyValue?: string; large?: boolean }) {
  const tone =
    p.tone === 'brand'
      ? 'border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/30'
      : p.tone === 'success'
        ? 'border-success/40 bg-success/10'
        : p.tone === 'warning'
          ? 'border-warning/50 bg-warning/10'
          : p.tone === 'danger'
            ? 'border-danger/40 bg-danger/10'
            : 'border-line bg-surface';
  return (
    <div class={`min-w-0 rounded-lg border p-3 ${tone}`}>
      <div class="flex items-start justify-between gap-2">
        <span class="text-xs font-medium text-ink-2">{p.label}</span>
        {p.copyValue && p.value !== '–' && (
          <button
            type="button"
            class="-m-1 rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink"
            title={`Copy ${p.label.toLowerCase()}`}
            aria-label={`Copy ${p.label.toLowerCase()}`}
            onClick={async () => {
              const ok = await copyText(p.copyValue!);
              toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error');
            }}
          >
            <Icon name="copy" size={13} />
          </button>
        )}
      </div>
      <div class={`mt-1 break-words font-display font-semibold tabular-nums text-ink ${p.large ? 'text-3xl' : 'text-2xl'}`}>{p.value}</div>
      {p.hint && <div class="mt-0.5 text-xs text-ink-3">{p.hint}</div>}
    </div>
  );
}

/** One-line explanation of how a result was worked out. */
export function Working(p: { children: ComponentChildren; tone?: 'plain' | 'error' }) {
  return (
    <p class={`mt-1.5 flex items-start gap-1.5 text-xs leading-5 ${p.tone === 'error' ? 'text-danger' : 'text-ink-3'}`}>
      <Icon name={p.tone === 'error' ? 'alert-circle' : 'code'} size={12} class="mt-1 shrink-0" />
      <span class="min-w-0 break-words">{p.children}</span>
    </p>
  );
}

export function Panel(p: { title?: string; children: ComponentChildren; class?: string } & Omit<JSX.HTMLAttributes<HTMLElement>, 'title' | 'class'>) {
  const { title, children, class: cls, ...rest } = p;
  return (
    <section class={`min-w-0 rounded-lg border border-line-strong bg-surface p-3 ${cls ?? ''}`} {...rest}>
      {title && <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">{title}</h3>}
      {children}
    </section>
  );
}

export const ROOT_CLASS = 'flex flex-col bg-surface-2 text-ink relative min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm';
