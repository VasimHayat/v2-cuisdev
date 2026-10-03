/** Small toolbar controls shared by the tool islands. */
import type { ComponentChildren } from 'preact';
import { Icon } from './icons';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: string;
  disabled?: boolean;
  title?: string;
}

/** Radio-style button group, e.g. Beautify | Minify. */
export function Segmented<T extends string>(p: { value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; label?: string }) {
  return (
    <div class="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface p-0.5" role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={p.value === o.value}
          disabled={o.disabled}
          title={o.title}
          class={
            'inline-flex h-full items-center gap-1.5 rounded px-2.5 text-[13px] font-medium transition-colors disabled:opacity-40 ' +
            (p.value === o.value ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-surface-3 hover:text-ink')
          }
          onClick={() => !o.disabled && p.onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Checkbox rendered as a toggle chip. */
export function Chip(p: { on: boolean; onClick: () => void; title?: string; children: ComponentChildren }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={p.on}
      title={p.title}
      class={
        'inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors ' +
        (p.on
          ? 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-900/40 dark:text-brand-200'
          : 'border-line-strong bg-surface text-ink-2 hover:bg-surface-3')
      }
      onClick={p.onClick}
    >
      <Icon name={p.on ? 'square-check' : 'square'} size={13} />
      {p.children}
    </button>
  );
}

/** Icon-only button for pane headers. */
export function HeaderButton(p: { icon: string; title: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      class={
        'inline-flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-40 ' +
        (p.active ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-200' : 'text-ink-2 hover:bg-surface-3 hover:text-ink')
      }
      title={p.title}
      aria-label={p.title}
      aria-pressed={p.active}
      disabled={p.disabled}
      onClick={p.onClick}
    >
      <Icon name={p.icon} size={14} />
    </button>
  );
}
