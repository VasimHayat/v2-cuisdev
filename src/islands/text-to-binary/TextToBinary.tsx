/**
 * Text to Binary workspace: Encode text to binary, octal, decimal, hex or code points in
 * a chosen text encoding, or Decode such a listing back to text. Live as you type, with
 * a swap button, a per-character byte table and forgiving, positioned decode errors.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import {
  BinaryError,
  DEFAULT_OPTIONS,
  ENCODINGS,
  REPRESENTATIONS,
  SAMPLE_TEXT,
  byteTable,
  decode,
  detectListing,
  encode,
  isEncoding,
  isRepresentation,
  textStats,
  type BinaryOptions,
  type GroupSize,
  type Separator,
} from './logic';

type Direction = 'encode' | 'decode';
type OutView = 'output' | 'table';

const TOOL = 'text-to-binary';
const PREFS_KEY = 'cuis-bin:prefs';

function loadPrefs(): { options: BinaryOptions; direction: Direction } {
  const fallback = { options: DEFAULT_OPTIONS, direction: 'encode' as Direction };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as { options?: Partial<BinaryOptions>; direction?: Direction } | null;
    if (!raw) return fallback;
    const o = { ...DEFAULT_OPTIONS };
    const r = raw.options ?? {};
    if (isRepresentation(r.representation)) o.representation = r.representation;
    if (isEncoding(r.encoding)) o.encoding = r.encoding;
    if (r.separator === 'space' || r.separator === 'none' || r.separator === 'comma' || r.separator === 'newline') o.separator = r.separator;
    if (r.group === 1 || r.group === 2 || r.group === 4) o.group = r.group;
    for (const k of ['pad', 'prefix', 'uppercase'] as const) if (typeof r[k] === 'boolean') o[k] = r[k] as boolean;
    return { options: o, direction: raw.direction === 'decode' ? 'decode' : 'encode' };
  } catch {
    return fallback;
  }
}

export default function TextToBinary() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [initial] = useState(loadPrefs);
  const [options, setOptions] = useState<BinaryOptions>(initial.options);
  const [direction, setDirection] = useState<Direction>(initial.direction);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<BinaryError | null>(null);
  const [view, setView] = useState<OutView>('output');
  const [wrap, setWrap] = useState(true);
  const [full, setFull] = useState(false);
  const update = (patch: Partial<BinaryOptions>) => setOptions((o) => ({ ...o, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ options, direction }));
    } catch {}
  }, [options, direction]);

  // Convert live, debounced
  useEffect(() => {
    const t = setTimeout(() => {
      if (input === '') {
        setOutput('');
        setError(null);
        return;
      }
      try {
        setOutput(direction === 'encode' ? encode(input, options) : decode(input, options));
        setError(null);
      } catch (err) {
        setOutput('');
        setError(err instanceof BinaryError ? err : new BinaryError(err instanceof Error ? err.message : String(err)));
      }
    }, 120);
    return () => clearTimeout(t);
  }, [input, direction, options]);

  /** The plain text side, for the byte table and stats. */
  const text = direction === 'encode' ? input : output;
  const stats = useMemo(() => textStats(text, options.encoding), [text, options.encoding]);
  const table = useMemo(() => (view === 'table' ? byteTable(text) : []), [view, text]);
  const isCodepoint = options.representation === 'codepoint';
  const repLabel = REPRESENTATIONS.find((r) => r.id === options.representation)!.label;

  // ------------------------------------------------------------------ actions

  const swap = () => {
    const next: Direction = direction === 'encode' ? 'decode' : 'encode';
    setDirection(next);
    if (output) setInput(output);
    track('tool_action', { tool: TOOL, action: 'swap', direction: next });
  };

  const copy = async () => {
    if (!output) return;
    const ok = await copyText(output);
    toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', direction, representation: options.representation });
  };

  const download = () => {
    if (!output) return;
    downloadText(output, direction === 'encode' ? `${options.representation}.txt` : 'decoded.txt');
    track('tool_action', { tool: TOOL, action: 'download', direction });
  };

  const loadSample = () => {
    setInput(direction === 'encode' ? SAMPLE_TEXT : encode(SAMPLE_TEXT, options));
    track('tool_action', { tool: TOOL, action: 'sample', direction });
  };

  const onPaste = (pasted: string, info: { wasEmpty: boolean }) => {
    if (!info.wasEmpty || direction === 'decode') return;
    const rep = detectListing(pasted);
    if (rep) {
      setDirection('decode');
      update({ representation: rep });
      toast(`Looks like ${REPRESENTATIONS.find((r) => r.id === rep)!.label.toLowerCase()}, switched to Decode`);
    }
  };

  // Keyboard and full screen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
        e.preventDefault();
        void copy();
      } else if (e.key === 'Escape' && full) setFull(false);
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    document.body.style.overflow = full ? 'hidden' : '';
    const el = rootRef.current;
    if (full && el && document.fullscreenEnabled && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    else if (!full && el && document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
    return () => {
      document.body.style.overflow = '';
    };
  }, [full]);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const inputTitle = direction === 'encode' ? 'Text' : repLabel;
  const outputTitle = direction === 'encode' ? repLabel : 'Text';

  return (
    <div
      ref={rootRef}
      class={
        'flex flex-col bg-surface-2 text-ink ' +
        (full ? 'fixed inset-0 z-[60] h-screen w-screen p-2' : 'relative h-[min(78vh,860px)] min-h-[560px] rounded-xl border border-line-strong p-2 shadow-sm')
      }
    >
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'encode', label: 'Encode', icon: 'lock' },
            { value: 'decode', label: 'Decode', icon: 'eye' },
          ]}
          label="Direction"
        />
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">As</span>
          <select
            class="select h-8 w-auto text-[13px]"
            value={options.representation}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (isRepresentation(v)) update({ representation: v });
            }}
            aria-label="Representation"
          >
            {REPRESENTATIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label class="flex items-center gap-2 text-xs text-ink-2">
          <span class="hidden sm:inline">Encoding</span>
          <select
            class="select h-8 w-auto text-[13px]"
            value={options.encoding}
            disabled={isCodepoint}
            title={isCodepoint ? 'Code points do not depend on a byte encoding' : undefined}
            onChange={(e) => {
              const v = (e.currentTarget as HTMLSelectElement).value;
              if (isEncoding(v)) update({ encoding: v });
            }}
            aria-label="Text encoding"
          >
            {ENCODINGS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        {direction === 'encode' && (
          <>
            <label class="flex items-center gap-2 text-xs text-ink-2">
              <span class="hidden sm:inline">Separator</span>
              <select class="select h-8 w-auto text-[13px]" value={options.separator} onChange={(e) => update({ separator: (e.currentTarget as HTMLSelectElement).value as Separator })} aria-label="Separator">
                <option value="space">Space</option>
                <option value="none">None</option>
                <option value="comma">Comma</option>
                <option value="newline">New line</option>
              </select>
            </label>
            {!isCodepoint && (
              <>
                <label class="flex items-center gap-2 text-xs text-ink-2">
                  <span class="hidden sm:inline">Group</span>
                  <select class="select h-8 w-auto text-[13px]" value={String(options.group)} onChange={(e) => update({ group: Number((e.currentTarget as HTMLSelectElement).value) as GroupSize })} aria-label="Bytes per group">
                    <option value="1">1 byte</option>
                    <option value="2">2 bytes</option>
                    <option value="4">4 bytes</option>
                  </select>
                </label>
                <div class="flex items-center gap-1.5" role="group" aria-label="Formatting">
                  <Chip on={options.pad} onClick={() => update({ pad: !options.pad })} title="Pad every byte to full width (8 binary digits, 2 hex digits)">
                    Pad
                  </Chip>
                  {options.representation !== 'decimal' && (
                    <Chip on={options.prefix} onClick={() => update({ prefix: !options.prefix })} title="Prefix each value with 0b, 0o or 0x">
                      Prefix
                    </Chip>
                  )}
                </div>
              </>
            )}
            {(options.representation === 'hex' || isCodepoint) && (
              <Chip on={options.uppercase} onClick={() => update({ uppercase: !options.uppercase })} title="Uppercase hex digits">
                Uppercase
              </Chip>
            )}
          </>
        )}

        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load an example">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input} title="Clear the input">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Panes */}
      <div class="grid min-h-0 flex-1 gap-2 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Input">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{inputTitle}</span>
            <span class="ml-2 truncate text-ink-3">{input ? `${input.length.toLocaleString('en-US')} chars` : ''}</span>
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={wrap ? 'Disable line wrap' : 'Wrap long lines'} active={wrap} onClick={() => setWrap((w) => !w)} />
          </header>
          <CodeEditor
            value={input}
            onChange={setInput}
            wrap={wrap}
            placeholder={direction === 'encode' ? 'Type or paste text to convert' : `Paste ${repLabel.toLowerCase()} values, with or without separators and prefixes`}
            error={error && error.offset !== undefined ? { offset: error.offset, message: error.message } : null}
            ariaLabel={`${inputTitle} input`}
            class="flex-1"
            onPaste={onPaste}
          />
        </section>

        <div class="flex items-center justify-center md:flex-col">
          <button type="button" class="btn-secondary btn-icon h-9 w-9" onClick={swap} title={`Switch to ${direction === 'encode' ? 'Decode' : 'Encode'} and use the output as input`} aria-label="Swap direction">
            <Icon name="arrow-left-right" size={16} />
          </button>
        </div>

        <section class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface" aria-label="Output">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">{outputTitle}</span>
            <span class="flex-1" />
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'output', label: 'Output', icon: 'code' },
                { value: 'table', label: 'Byte table', icon: 'rows' },
              ]}
              label="Output view"
            />
            <HeaderButton icon="download" title="Download as text" onClick={download} disabled={!output} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={() => void copy()} disabled={!output} title="Copy output (Ctrl+Shift+C)">
              <Icon name="copy" size={13} /> Copy
            </button>
          </header>
          {view === 'output' ? (
            <CodeEditor value={output} readOnly wrap={wrap} placeholder="Output appears here as you type" ariaLabel={`${outputTitle} output`} class="flex-1" />
          ) : (
            <div class="scrollbar-thin min-h-0 flex-1 overflow-auto">
              {table.length === 0 ? (
                <p class="p-4 text-sm text-ink-3">The byte table lists each character of the text with its code point and UTF-8 bytes.</p>
              ) : (
                <table class="w-full text-left text-xs">
                  <thead class="sticky top-0 bg-surface-2 text-ink-3">
                    <tr>
                      <th class="px-3 py-1.5 font-medium">Char</th>
                      <th class="px-2 py-1.5 font-medium">Code point</th>
                      <th class="px-2 py-1.5 font-medium">UTF-8 hex</th>
                      <th class="px-2 py-1.5 font-medium">UTF-8 binary</th>
                    </tr>
                  </thead>
                  <tbody class="font-mono">
                    {table.map((r, i) => (
                      <tr key={i} class="border-t border-line">
                        <td class="px-3 py-1 text-sm text-ink">{r.char === ' ' ? <span class="text-ink-3">space</span> : r.char === '\n' ? <span class="text-ink-3">\n</span> : r.char === '\t' ? <span class="text-ink-3">\t</span> : r.char}</td>
                        <td class="px-2 py-1 text-ink-2">{r.codePoint}</td>
                        <td class="px-2 py-1 text-ink">{r.hex}</td>
                        <td class="px-2 py-1 text-ink-2">{r.binary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {text && [...text].length > 200 && <p class="border-t border-line p-2 text-center text-xs text-ink-3">Showing the first 200 characters.</p>}
            </div>
          )}
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <div class="min-w-0">
          {error ? (
            <span class="flex min-w-0 items-center gap-1.5 text-danger">
              <Icon name="alert-circle" size={13} class="shrink-0" />
              <span class="truncate">{error.message}</span>
            </span>
          ) : text ? (
            <span class="flex items-center gap-1.5 text-ink-3">
              <Icon name="check" size={13} class="text-success" />
              {stats.chars.toLocaleString('en-US')} {stats.chars === 1 ? 'character' : 'characters'}
              {stats.bytes !== null && !isCodepoint && (
                <>
                  {' '}
                  · {stats.bytes.toLocaleString('en-US')} {stats.bytes === 1 ? 'byte' : 'bytes'} · {stats.bits!.toLocaleString('en-US')} bits in {ENCODINGS.find((e) => e.id === options.encoding)!.label}
                </>
              )}
            </span>
          ) : (
            <span class="text-ink-3">Everything is converted in your browser. Nothing is uploaded.</span>
          )}
        </div>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">C</span> copy output
        </span>
      </div>
    </div>
  );
}
