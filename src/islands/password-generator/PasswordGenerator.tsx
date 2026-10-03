/**
 * Password Generator: random passwords or passphrases from crypto.getRandomValues with
 * unbiased sampling, entropy and an estimated crack time, and bulk generation. Only the
 * options are saved; generated passwords are never stored, sent or tracked.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { Chip, HeaderButton, Segmented } from '../shared/controls';
import { copyText, toast, track } from '../shared/toast';
import { WORDS } from './words';
import {
  AMBIGUOUS,
  DEFAULT_PREFS,
  DEFAULT_SYMBOLS,
  GUESSES_PER_SECOND,
  crackTime,
  generatePassphrase,
  generatePassword,
  parsePrefs,
  passphraseEntropy,
  passwordEntropy,
  poolFor,
  strength,
  validatePassword,
  type Mode,
  type PassphraseOptions,
  type PasswordOptions,
  type Prefs,
  type StrengthLevel,
} from './logic';

const TOOL = 'password-generator';
const PREFS_KEY = 'cuis-pass:prefs';

const BAR: Record<StrengthLevel, { width: string; color: string; text: string }> = {
  'very-weak': { width: '12%', color: 'bg-danger', text: 'text-danger' },
  weak: { width: '30%', color: 'bg-danger', text: 'text-danger' },
  fair: { width: '55%', color: 'bg-warning', text: 'text-ink-2' },
  strong: { width: '80%', color: 'bg-success', text: 'text-success' },
  'very-strong': { width: '100%', color: 'bg-success', text: 'text-success' },
};

function loadPrefs(): Prefs {
  try {
    return parsePrefs(JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null'));
  } catch {
    return DEFAULT_PREFS;
  }
}

export default function PasswordGenerator() {
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [main, setMain] = useState('');
  const [list, setList] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(true);
  const [revealList, setRevealList] = useState(false);

  const pw = prefs.password;
  const pp = prefs.passphrase;
  const setPw = (patch: Partial<PasswordOptions>) => setPrefs((p) => ({ ...p, password: { ...p.password, ...patch } }));
  const setPp = (patch: Partial<PassphraseOptions>) => setPrefs((p) => ({ ...p, passphrase: { ...p.passphrase, ...patch } }));

  // Options only. Generated values never touch storage.
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {}
  }, [prefs]);

  const one = (): string => (prefs.mode === 'password' ? generatePassword(prefs.password) : generatePassphrase(prefs.passphrase));

  const regenerate = () => {
    try {
      setMain(one());
      setError(null);
    } catch (err) {
      setMain('');
      setError(err instanceof Error ? err.message : 'Could not generate.');
    }
  };

  // Regenerate whenever an option changes.
  useEffect(() => {
    regenerate();
    setList([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.mode, pw, pp]);

  const bits = prefs.mode === 'password' ? passwordEntropy(pw) : passphraseEntropy(pp);
  const level = strength(bits);
  const problem = prefs.mode === 'password' ? validatePassword(pw) : null;
  const poolSize = useMemo(() => poolFor(pw).length, [pw]);

  const copyMain = async () => {
    if (!main) return;
    const ok = await copyText(main);
    toast(ok ? 'Copied. Paste it somewhere safe.' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy', mode: prefs.mode });
  };

  const bulk = () => {
    try {
      setList(Array.from({ length: prefs.count }, one));
      setError(null);
      track('tool_action', { tool: TOOL, action: 'bulk', mode: prefs.mode, count: prefs.count });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate.');
    }
  };

  const copyAll = async () => {
    if (!list.length) return;
    const ok = await copyText(list.join('\n'));
    toast(ok ? `${list.length} copied` : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy_all', count: list.length });
  };

  const masked = (s: string) => '•'.repeat(Math.min(s.length, 40));

  return (
    <div class="flex flex-col bg-surface-2 text-ink relative min-h-[600px] rounded-xl border border-line-strong p-2 shadow-sm">
      {/* Toolbar */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-1 pb-2 pt-1">
        <Segmented
          value={prefs.mode}
          onChange={(mode: Mode) => setPrefs((p) => ({ ...p, mode }))}
          options={[
            { value: 'password', label: 'Password', icon: 'lock' },
            { value: 'passphrase', label: 'Passphrase', icon: 'file-text' },
          ]}
          label="Mode"
        />
        <span class="flex-1" />
        <button type="button" class="btn-ghost btn-sm" onClick={() => setPrefs(DEFAULT_PREFS)} title="Restore the default options">
          <Icon name="undo" size={14} /> Reset
        </button>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        {/* Result */}
        <section class="flex min-w-0 flex-col gap-3 rounded-lg border border-line-strong bg-surface p-4" aria-label="Generated">
          <div class="flex min-h-[4.5rem] items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-3">
            <output
              class={'min-w-0 flex-1 break-all font-mono text-lg leading-7 sm:text-xl ' + (main ? 'text-ink' : 'text-ink-3')}
              aria-live="polite"
              aria-label="Generated password"
            >
              {error ?? (main ? (reveal ? main : masked(main)) : 'Choose at least one option')}
            </output>
            <HeaderButton icon={reveal ? 'eye-off' : 'eye'} title={reveal ? 'Hide' : 'Show'} onClick={() => setReveal((r) => !r)} />
            <HeaderButton icon="redo" title="Generate another" onClick={regenerate} disabled={!!problem} />
          </div>
          <button type="button" class="btn-primary h-10 w-full" onClick={() => void copyMain()} disabled={!main}>
            <Icon name="copy" size={15} /> Copy
          </button>

          {/* Strength */}
          <div>
            <div class="flex items-baseline justify-between text-sm">
              <span class={'font-semibold ' + BAR[level.level].text}>{level.label}</span>
              <span class="font-mono text-xs text-ink-2">{bits.toFixed(1)} bits of entropy</span>
            </div>
            <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-line" aria-hidden="true">
              <div class={'h-full rounded-full transition-[width] ' + BAR[level.level].color} style={{ width: BAR[level.level].width }} />
            </div>
            <p class="mt-2 text-xs leading-5 text-ink-3">
              Estimated time to guess: <span class="text-ink-2">{crackTime(bits)}</span>, assuming an offline attack at {GUESSES_PER_SECOND.toExponential(0).replace('e+', ' × 10^')} guesses per second. This is an
              estimate; real attacks vary and a password reused on a breached site is weak however long it is.
            </p>
            <p class="mt-1 text-xs text-ink-3">
              {prefs.mode === 'password' ? `${poolSize} possible characters × ${pw.length} positions.` : `${WORDS.length.toLocaleString('en-US')} possible words × ${pp.words} words.`}
            </p>
          </div>

          {/* Bulk */}
          <div class="border-t border-line pt-3">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-xs font-semibold uppercase tracking-wide text-ink-3">Bulk</span>
              <input
                type="number"
                class="input h-8 w-20 text-sm"
                min={1}
                max={100}
                value={prefs.count}
                onInput={(e) => {
                  const n = Number((e.currentTarget as HTMLInputElement).value);
                  if (Number.isFinite(n)) setPrefs((p) => ({ ...p, count: Math.min(100, Math.max(1, Math.round(n))) }));
                }}
                aria-label="How many to generate"
              />
              <button type="button" class="btn-secondary btn-sm" onClick={bulk} disabled={!!problem}>
                Generate {prefs.count}
              </button>
              {list.length > 0 && (
                <>
                  <span class="flex-1" />
                  <HeaderButton icon={revealList ? 'eye-off' : 'eye'} title={revealList ? 'Hide list' : 'Show list'} onClick={() => setRevealList((r) => !r)} />
                  <button type="button" class="btn-ghost btn-sm" onClick={() => void copyAll()}>
                    <Icon name="copy" size={13} /> Copy all
                  </button>
                  <HeaderButton icon="x" title="Clear the list" onClick={() => setList([])} />
                </>
              )}
            </div>
            {list.length > 0 && (
              <ol class="scrollbar-thin mt-2 max-h-56 overflow-y-auto rounded-md border border-line bg-surface-2 text-sm">
                {list.map((p, i) => (
                  <li key={i} class="flex items-center gap-2 border-b border-line px-2 py-1 last:border-b-0">
                    <span class="w-6 shrink-0 text-right text-xs text-ink-3">{i + 1}</span>
                    <span class="min-w-0 flex-1 break-all font-mono text-[13px]">{revealList ? p : masked(p)}</span>
                    <HeaderButton
                      icon="copy"
                      title="Copy"
                      onClick={() =>
                        void copyText(p).then((ok) => {
                          toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'error');
                        })
                      }
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>

        {/* Options */}
        <aside class="flex min-w-0 flex-col gap-4 rounded-lg border border-line-strong bg-surface p-4 text-sm" aria-label="Options">
          {prefs.mode === 'password' ? (
            <>
              <Slider label="Length" value={pw.length} min={4} max={128} onChange={(length) => setPw({ length })} />
              <Group label="Characters">
                <Chip on={pw.upper} onClick={() => setPw({ upper: !pw.upper })} title="A to Z">
                  A-Z
                </Chip>
                <Chip on={pw.lower} onClick={() => setPw({ lower: !pw.lower })} title="a to z">
                  a-z
                </Chip>
                <Chip on={pw.digits} onClick={() => setPw({ digits: !pw.digits })} title="0 to 9">
                  0-9
                </Chip>
                <Chip on={pw.symbols} onClick={() => setPw({ symbols: !pw.symbols })} title="Symbols from the set below">
                  Symbols
                </Chip>
              </Group>
              {pw.symbols && (
                <label class="block">
                  <span class="text-xs text-ink-2">Symbol set</span>
                  <div class="mt-1 flex gap-1">
                    <input
                      class="input h-8 flex-1 font-mono text-xs"
                      value={pw.symbolSet}
                      maxLength={64}
                      onInput={(e) => setPw({ symbolSet: (e.currentTarget as HTMLInputElement).value })}
                      spellcheck={false}
                      aria-label="Symbol set"
                    />
                    <HeaderButton icon="undo" title="Default symbols" onClick={() => setPw({ symbolSet: DEFAULT_SYMBOLS })} />
                  </div>
                </label>
              )}
              <Group label="Rules">
                <Chip on={pw.excludeAmbiguous} onClick={() => setPw({ excludeAmbiguous: !pw.excludeAmbiguous })} title={`Leave out ${AMBIGUOUS}`}>
                  No look-alikes
                </Chip>
                <Chip on={pw.requireEach} onClick={() => setPw({ requireEach: !pw.requireEach })} title="At least one character of every selected type">
                  One of each type
                </Chip>
                <Chip on={pw.noRepeat} onClick={() => setPw({ noRepeat: !pw.noRepeat })} title="Never use the same character twice">
                  No repeats
                </Chip>
              </Group>
              {problem && <p class="text-xs text-danger">{problem}</p>}
            </>
          ) : (
            <>
              <Slider label="Words" value={pp.words} min={3} max={12} onChange={(words) => setPp({ words })} />
              <label class="block">
                <span class="text-xs text-ink-2">Separator</span>
                <div class="mt-1 flex flex-wrap gap-1">
                  {['-', ' ', '.', '_', ''].map((s) => (
                    <button
                      key={s || 'none'}
                      type="button"
                      class={'rounded-md border px-2.5 py-1 font-mono text-xs ' + (pp.separator === s ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong text-ink-2 hover:bg-surface-3')}
                      onClick={() => setPp({ separator: s })}
                    >
                      {s === ' ' ? 'space' : s === '' ? 'none' : s}
                    </button>
                  ))}
                </div>
              </label>
              <Group label="Extras">
                <Chip on={pp.capitalize} onClick={() => setPp({ capitalize: !pp.capitalize })}>
                  Capitalise
                </Chip>
                <Chip on={pp.addNumber} onClick={() => setPp({ addNumber: !pp.addNumber })} title="Add a digit to one word">
                  Add a number
                </Chip>
                <Chip on={pp.addSymbol} onClick={() => setPp({ addSymbol: !pp.addSymbol })} title="Add a symbol to one word">
                  Add a symbol
                </Chip>
              </Group>
              <p class="text-xs leading-5 text-ink-3">Passphrases are easier to type and remember. Five or more random words are a strong choice for a password manager master password.</p>
            </>
          )}
          <p class="mt-auto flex items-start gap-1.5 border-t border-line pt-3 text-xs leading-5 text-ink-3">
            <Icon name="lock" size={13} class="mt-0.5 shrink-0" />
            Generated with your browser's cryptographic random generator. Nothing is uploaded or saved; only your options are remembered on this device.
          </p>
        </aside>
      </div>
    </div>
  );
}

function Slider(p: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label class="block">
      <span class="flex items-center justify-between text-xs text-ink-2">
        <span>{p.label}</span>
        <input
          type="number"
          class="input h-7 w-16 text-right font-mono text-xs"
          min={p.min}
          max={p.max}
          value={p.value}
          onInput={(e) => {
            const n = Number((e.currentTarget as HTMLInputElement).value);
            if (Number.isFinite(n) && n >= p.min && n <= p.max) p.onChange(Math.round(n));
          }}
          aria-label={`${p.label} value`}
        />
      </span>
      <input
        type="range"
        class="mt-1 w-full accent-brand-600"
        min={p.min}
        max={p.max}
        value={p.value}
        onInput={(e) => p.onChange(Number((e.currentTarget as HTMLInputElement).value))}
        aria-label={p.label}
      />
    </label>
  );
}

function Group(p: { label: string; children: ComponentChildren }) {
  return (
    <div>
      <div class="mb-1 text-xs text-ink-2">{p.label}</div>
      <div class="flex flex-wrap gap-1.5">{p.children}</div>
    </div>
  );
}
