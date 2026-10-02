import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { copyText, toast } from '../shared/toast';
import {
  childCount,
  coerceInput,
  containerPaths,
  isContainer,
  pathKey,
  pathToString,
  searchPaths,
  summarize,
  typeOf,
  type JsonValue,
  type Path,
} from './json';

export interface ExpandSignal {
  kind: 'default' | 'all' | 'none';
  n: number;
}

interface TreeProps {
  value: JsonValue;
  search: string;
  selected: Path | null;
  onSelect: (path: Path) => void;
  onEdit: (path: Path, value: JsonValue) => void;
  onDelete: (path: Path) => void;
  expandSignal: ExpandSignal;
  /** Read-only trees hide edit affordances. */
  readOnly?: boolean;
}

const MAX_NODES = 5000;
const DEFAULT_DEPTH = 2;

interface Editing {
  key: string;
  draft: string;
}

/** Everything a node needs from the tree, passed once so Node stays a stable component. */
interface Ctx {
  visible: Set<string> | null;
  expanded: Set<string>;
  selectedKey: string | null;
  editing: Editing | null;
  readOnly: boolean;
  counter: { n: number; truncated: boolean };
  toggle: (key: string) => void;
  setEditing: (e: Editing | null) => void;
  onSelect: (path: Path) => void;
  onEdit: (path: Path, value: JsonValue) => void;
  onDelete: (path: Path) => void;
}

function defaultExpanded(value: JsonValue): Set<string> {
  const set = new Set<string>();
  const walk = (v: JsonValue, path: Path, depth: number) => {
    if (!isContainer(v) || depth >= DEFAULT_DEPTH) return;
    set.add(pathKey(path));
    if (Array.isArray(v)) v.forEach((c, i) => walk(c, [...path, i], depth + 1));
    else for (const k of Object.keys(v)) walk(v[k] as JsonValue, [...path, k], depth + 1);
  };
  walk(value, [], 0);
  return set;
}

export function Tree({ value, search, selected, onSelect, onEdit, onDelete, expandSignal, readOnly = false }: TreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => defaultExpanded(value));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [truncated, setTruncated] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const counter = useRef({ n: 0, truncated: false });
  const visible = useMemo(() => searchPaths(value, search), [value, search]);
  const selectedKey = selected ? pathKey(selected) : null;

  useEffect(() => {
    if (expandSignal.kind === 'all') setExpanded(new Set(containerPaths(value).map(pathKey)));
    else if (expandSignal.kind === 'none') setExpanded(new Set([pathKey([])]));
    else setExpanded(defaultExpanded(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandSignal.n]);

  // Child components render after this function returns, so read the counter in an effect.
  counter.current = { n: 0, truncated: false };
  useEffect(() => {
    if (counter.current.truncated !== truncated) setTruncated(counter.current.truncated);
  });

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!selected || editing) return;
    const key = pathKey(selected);
    const v = getAt(value, selected);
    if (e.key === 'ArrowRight' && v !== undefined && isContainer(v) && !expanded.has(key)) {
      e.preventDefault();
      toggle(key);
    } else if (e.key === 'ArrowLeft' && expanded.has(key)) {
      e.preventDefault();
      toggle(key);
    } else if (e.key === 'Enter' && !readOnly && v !== undefined && !isContainer(v)) {
      e.preventDefault();
      setEditing({ key, draft: typeof v === 'string' ? v : JSON.stringify(v) });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly && selected.length > 0) {
      e.preventDefault();
      onDelete(selected);
    }
  };

  const ctx: Ctx = {
    visible,
    expanded,
    selectedKey,
    editing,
    readOnly,
    counter: counter.current,
    toggle,
    setEditing,
    onSelect,
    onEdit,
    onDelete,
  };

  const nothing = visible && visible.size === 0;

  return (
    <div
      ref={rootRef}
      role="tree"
      aria-label="JSON tree"
      tabIndex={0}
      class="h-full select-none overflow-auto px-2 py-2 outline-none scrollbar-thin focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
      onKeyDown={onKeyDown}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('input')) rootRef.current?.focus();
      }}
    >
      {nothing ? (
        <p class="px-3 py-6 text-center text-sm text-ink-3">No keys or values match "{search}".</p>
      ) : (
        <Node v={value} path={[]} depth={0} label={null} ctx={ctx} />
      )}
      {truncated && (
        <p class="px-3 py-3 text-xs text-ink-3">Showing the first {MAX_NODES.toLocaleString()} nodes. Use the Code view or search to reach the rest.</p>
      )}
    </div>
  );
}

function Node({ v, path, depth, label, ctx }: { v: JsonValue; path: Path; depth: number; label: string | null; ctx: Ctx }) {
  const key = pathKey(path);
  if (ctx.visible && !ctx.visible.has(key)) return null;
  if (ctx.counter.n >= MAX_NODES) {
    ctx.counter.truncated = true;
    return null;
  }
  ctx.counter.n++;

  const container = isContainer(v);
  const open = container && (ctx.visible ? true : ctx.expanded.has(key));
  const type = typeOf(v);
  const isSel = key === ctx.selectedKey;
  const isEditing = ctx.editing?.key === key;

  const startEdit = () => {
    if (ctx.readOnly || container) return;
    ctx.setEditing({ key, draft: typeof v === 'string' ? v : JSON.stringify(v) });
  };
  const commit = () => {
    if (!ctx.editing || ctx.editing.key !== key) return;
    ctx.onEdit(path, coerceInput(ctx.editing.draft));
    ctx.setEditing(null);
  };

  return (
    <div role="treeitem" aria-expanded={container ? open : undefined} aria-selected={isSel}>
      <div
        class={
          'group flex min-h-7 items-center gap-1.5 rounded-sm pr-2 text-[13px] leading-6 ' +
          (isSel ? 'bg-brand-500/15 ring-1 ring-inset ring-brand-500/40' : 'hover:bg-surface-3')
        }
        style={{ paddingLeft: `${depth * 16 + 6}px` }}
        onClick={(e) => {
          e.stopPropagation();
          ctx.onSelect(path);
        }}
        onDblClick={(e) => {
          e.stopPropagation();
          container ? ctx.toggle(key) : startEdit();
        }}
      >
        {container ? (
          <button
            type="button"
            class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-surface-3 hover:text-ink"
            onClick={(e) => {
              e.stopPropagation();
              ctx.toggle(key);
            }}
            aria-label={open ? 'Collapse' : 'Expand'}
            tabIndex={-1}
          >
            <Icon name="chevron-right" size={14} class={'transition-transform ' + (open ? 'rotate-90' : '')} />
          </button>
        ) : (
          <span class="w-5 shrink-0" />
        )}

        {label !== null && (
          <>
            <span class={'shrink-0 ' + (typeof path[path.length - 1] === 'number' ? 'text-ink-3' : 'tok-key font-medium')}>{label}</span>
            <span class="shrink-0 text-ink-3">:</span>
          </>
        )}

        {container ? (
          <span class="flex min-w-0 items-center gap-1.5 text-ink-3">
            <span class="font-mono text-[12px]">{Array.isArray(v) ? '[ ]' : '{ }'}</span>
            <span class="truncate text-[12px]">{summarize(v)}</span>
            {childCount(v) === 0 && <span class="text-[11px]">empty</span>}
          </span>
        ) : isEditing ? (
          <input
            class="h-6 min-w-[8rem] flex-1 rounded border border-brand-500 bg-surface px-1.5 font-mono text-[13px] text-ink outline-none"
            value={ctx.editing!.draft}
            ref={(el) => {
              if (el && document.activeElement !== el) setTimeout(() => el.focus(), 0);
            }}
            onInput={(e) => ctx.setEditing({ key, draft: (e.target as HTMLInputElement).value })}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                ctx.setEditing(null);
              }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            onDblClick={(e) => e.stopPropagation()}
            spellcheck={false}
            aria-label={`Edit value of ${pathToString(path)}`}
          />
        ) : (
          <span class={`truncate font-mono tok-${type}`} title={typeof v === 'string' && v.length > 60 ? v : undefined}>
            {type === 'string' ? JSON.stringify(v) : String(v)}
          </span>
        )}

        <span class="ml-auto hidden shrink-0 items-center gap-0.5 group-hover:flex">
          <RowBtn
            title="Copy value"
            icon="copy"
            onClick={async () => {
              (await copyText(container ? JSON.stringify(v, null, 2) : typeof v === 'string' ? v : String(v))) && toast('Value copied');
            }}
          />
          <RowBtn title="Copy path" icon="map-pin" onClick={async () => (await copyText(pathToString(path))) && toast(`Copied ${pathToString(path)}`)} />
          {!ctx.readOnly && path.length > 0 && <RowBtn title="Delete" icon="x" onClick={() => ctx.onDelete(path)} />}
        </span>
      </div>

      {container && open && (
        <div role="group">
          {Array.isArray(v)
            ? v.map((c, i) => <Node key={i} v={c} path={[...path, i]} depth={depth + 1} label={String(i)} ctx={ctx} />)
            : Object.keys(v).map((k) => <Node key={k} v={(v as Record<string, JsonValue>)[k] as JsonValue} path={[...path, k]} depth={depth + 1} label={k} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

function RowBtn({ title, icon, onClick }: { title: string; icon: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="flex h-5 w-5 items-center justify-center rounded text-ink-3 hover:bg-surface hover:text-ink"
      title={title}
      aria-label={title}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon name={icon} size={13} />
    </button>
  );
}

function getAt(root: JsonValue, path: Path): JsonValue | undefined {
  let cur: JsonValue | undefined = root;
  for (const seg of path) {
    if (cur === undefined || !isContainer(cur)) return undefined;
    cur = Array.isArray(cur) ? cur[seg as number] : cur[seg as string];
  }
  return cur;
}
