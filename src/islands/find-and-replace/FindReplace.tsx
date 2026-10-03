/**
 * Find and Replace workspace: an ordered list of rules (plain text, whole word or regex)
 * above, the text on the left and a live preview of the result on the right, with the
 * replacement count per rule. Apply moves the result into the text.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/icons';
import { CodeEditor } from '../shared/CodeEditor';
import { Chip, HeaderButton } from '../shared/controls';
import { copyText, downloadText, toast, track } from '../shared/toast';
import { SAMPLE_RULES, SAMPLE_TEXT, applyRules, countMatches, moveRule, newRule, sanitizeRules, type Rule, type RuleMode } from './logic';

const TOOL = 'find-and-replace';
const RULES_KEY = 'cuis-fr:rules';
const DRAFT_KEY = 'cuis-fr:draft';

function loadRules(): Rule[] {
  try {
    return sanitizeRules(JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null')) ?? [newRule()];
  } catch {
    return [newRule()];
  }
}

function loadDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

export default function FindReplace() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(loadDraft);
  const [rules, setRules] = useState<Rule[]>(loadRules);
  const [wrap, setWrap] = useState(true);
  const [full, setFull] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(RULES_KEY, JSON.stringify(rules));
    } catch {}
  }, [rules]);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        if (text.length <= 200 * 1024) localStorage.setItem(DRAFT_KEY, text);
      } catch {}
    }, 400);
    return () => clearTimeout(t);
  }, [text]);

  const result = useMemo(() => applyRules(text, rules), [text, rules]);
  const firstMatches = useMemo(() => {
    const r = rules[0];
    if (!r || !r.enabled || !r.find) return null;
    try {
      return countMatches(text, r);
    } catch {
      return null;
    }
  }, [text, rules]);
  const changed = result.output !== text;
  const errors = result.outcomes.filter((o) => o.error);

  const patch = (id: string, p: Partial<Rule>) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const addRule = () => {
    setRules((rs) => [...rs, newRule()]);
    track('tool_action', { tool: TOOL, action: 'add_rule' });
  };
  const removeRule = (id: string) => setRules((rs) => (rs.length > 1 ? rs.filter((r) => r.id !== id) : [newRule()]));

  const apply = () => {
    if (!changed) return;
    setText(result.output);
    toast(`Applied ${result.total.toLocaleString()} replacement${result.total === 1 ? '' : 's'}`);
    track('tool_action', { tool: TOOL, action: 'apply', count: result.total });
  };
  const copy = async () => {
    const ok = await copyText(result.output);
    toast(ok ? 'Result copied' : 'Copy failed', ok ? 'ok' : 'error');
    track('tool_action', { tool: TOOL, action: 'copy' });
  };
  const download = () => {
    downloadText(result.output, 'replaced.txt');
    track('tool_action', { tool: TOOL, action: 'download' });
  };
  const loadSample = () => {
    setText(SAMPLE_TEXT);
    setRules(SAMPLE_RULES.map((r) => ({ ...r })));
    track('tool_action', { tool: TOOL, action: 'sample' });
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === 'Enter') {
        e.preventDefault();
        apply();
      } else if (meta && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
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
        <span class="text-xs text-ink-2">
          {rules.length} rule{rules.length === 1 ? '' : 's'}, applied top to bottom
        </span>
        <span class="flex-1" />
        <div class="flex items-center gap-1">
          <button type="button" class="btn-secondary btn-sm" onClick={loadSample} title="Load example text and rules">
            <Icon name="sparkles" size={14} /> Sample
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => setText('')} disabled={!text} title="Clear the text">
            <Icon name="eraser" size={14} /> Clear
          </button>
          <button type="button" class="btn-ghost btn-sm" onClick={() => setRules([newRule()])} title="Remove every rule">
            <Icon name="trash" size={14} /> Reset rules
          </button>
          <button type="button" class="btn-ghost btn-sm btn-icon h-8 w-8" onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen (Esc)' : 'Full screen'} aria-label={full ? 'Exit full screen' : 'Full screen'}>
            <Icon name={full ? 'minimize' : 'maximize'} size={15} />
          </button>
        </div>
      </div>

      {/* Rules */}
      <section class="scrollbar-thin mb-2 max-h-[38%] shrink-0 overflow-y-auto rounded-lg border border-line bg-surface p-2" aria-label="Replacement rules">
        <ol class="space-y-1.5">
          {rules.map((r, i) => {
            const outcome = result.outcomes.find((o) => o.id === r.id);
            return (
              <li key={r.id} class={'rounded-md border p-1.5 ' + (outcome?.error ? 'border-danger/50 bg-danger/5' : 'border-line')}>
                <div class="flex flex-wrap items-center gap-1.5">
                  <span class="w-5 text-center font-mono text-xs text-ink-3">{i + 1}</span>
                  <input
                    class="input h-8 min-w-[9rem] flex-1 font-mono text-[13px]"
                    value={r.find}
                    placeholder={r.mode === 'regex' ? 'Regular expression' : 'Find'}
                    onInput={(e) => patch(r.id, { find: (e.currentTarget as HTMLInputElement).value })}
                    aria-label={`Find, rule ${i + 1}`}
                    spellcheck={false}
                  />
                  <Icon name="arrow-right" size={14} class="text-ink-3" />
                  <input
                    class="input h-8 min-w-[9rem] flex-1 font-mono text-[13px]"
                    value={r.replace}
                    placeholder={r.mode === 'regex' ? 'Replace ($1, $<name>, $&)' : 'Replace with (empty deletes)'}
                    onInput={(e) => patch(r.id, { replace: (e.currentTarget as HTMLInputElement).value })}
                    aria-label={`Replace, rule ${i + 1}`}
                    spellcheck={false}
                  />
                  <select class="select h-8 w-auto text-[13px]" value={r.mode} onChange={(e) => patch(r.id, { mode: (e.currentTarget as HTMLSelectElement).value as RuleMode })} aria-label={`Mode, rule ${i + 1}`}>
                    <option value="plain">Plain text</option>
                    <option value="word">Whole word</option>
                    <option value="regex">Regex</option>
                  </select>
                  <span
                    class={'badge min-w-[3.5rem] justify-center ' + (outcome?.error ? 'border-danger/40 text-danger' : outcome && outcome.count > 0 ? 'border-success/40 bg-success/10 text-success' : 'border-line-strong text-ink-3')}
                    title="Replacements made by this rule"
                  >
                    {outcome?.error ? 'error' : `${(outcome?.count ?? 0).toLocaleString()}×`}
                  </span>
                  <HeaderButton icon="arrow-up" title="Move rule up" onClick={() => setRules((rs) => moveRule(rs, i, i - 1))} disabled={i === 0} />
                  <HeaderButton icon="arrow-down" title="Move rule down" onClick={() => setRules((rs) => moveRule(rs, i, i + 1))} disabled={i === rules.length - 1} />
                  <HeaderButton icon="x" title="Remove rule" onClick={() => removeRule(r.id)} />
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-1.5 pl-6">
                  <Chip on={r.caseSensitive} onClick={() => patch(r.id, { caseSensitive: !r.caseSensitive })} title="Match upper and lower case exactly">
                    Match case
                  </Chip>
                  {r.mode === 'regex' ? (
                    <>
                      <Chip on={r.flags.includes('m')} onClick={() => patch(r.id, { flags: r.flags.includes('m') ? r.flags.replace('m', '') : r.flags + 'm' })} title="^ and $ match at every line">
                        Multiline
                      </Chip>
                      <Chip on={r.flags.includes('s')} onClick={() => patch(r.id, { flags: r.flags.includes('s') ? r.flags.replace('s', '') : r.flags + 's' })} title=". also matches line breaks">
                        Dot matches newline
                      </Chip>
                    </>
                  ) : (
                    <Chip on={r.escapes} onClick={() => patch(r.id, { escapes: !r.escapes })} title="Treat \n and \t in the replacement as a line break and a tab">
                      \n and \t in replacement
                    </Chip>
                  )}
                  <Chip on={!r.enabled} onClick={() => patch(r.id, { enabled: !r.enabled })} title="Skip this rule without deleting it">
                    Disabled
                  </Chip>
                  {outcome?.error && <span class="text-xs text-danger">{outcome.error}</span>}
                </div>
              </li>
            );
          })}
        </ol>
        <button type="button" class="btn-ghost btn-sm mt-1.5" onClick={addRule}>
          <Icon name="plus" size={14} /> Add rule
        </button>
      </section>

      {/* Panes */}
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
        <section class="flex h-[320px] min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:min-h-0" aria-label="Text">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Text</span>
            <span class="ml-2 text-ink-3">{firstMatches !== null ? `${firstMatches.toLocaleString()} match${firstMatches === 1 ? '' : 'es'} for rule 1` : `${text.length.toLocaleString()} chars`}</span>
            <span class="flex-1" />
            <HeaderButton icon="wrap-text" title={wrap ? 'Disable line wrap' : 'Wrap long lines'} active={wrap} onClick={() => setWrap((w) => !w)} />
          </header>
          <CodeEditor value={text} onChange={setText} wrap={wrap} placeholder="Paste the text to search in" ariaLabel="Text to search" class="flex-1" />
        </section>
        <section class="flex h-[320px] min-w-0 flex-col overflow-hidden rounded-lg border border-line-strong bg-surface lg:h-auto lg:min-h-0" aria-label="Result preview">
          <header class="flex h-9 shrink-0 items-center gap-1 border-b border-line bg-surface-2 pl-3 pr-1 text-xs">
            <span class="font-semibold text-ink">Preview</span>
            <span class="ml-2 text-ink-3">{result.total.toLocaleString()} replacement{result.total === 1 ? '' : 's'}</span>
            <span class="flex-1" />
            <HeaderButton icon="download" title="Download the result" onClick={download} disabled={!text} />
            <HeaderButton icon="copy" title="Copy the result (Ctrl+Shift+C)" onClick={() => void copy()} disabled={!text} />
            <button type="button" class="btn-primary btn-sm ml-1 h-7" onClick={apply} disabled={!changed} title="Replace the text with the preview (Ctrl+Enter)">
              <Icon name="check" size={13} /> Apply
            </button>
          </header>
          <CodeEditor value={result.output} readOnly wrap={wrap} placeholder="The result appears here as you type" ariaLabel="Result preview" class="flex-1" />
        </section>
      </div>

      {/* Status */}
      <div class="mt-2 flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <span class="min-w-0 truncate">
          {errors.length ? (
            <span class="text-danger">
              <Icon name="alert-circle" size={13} class="mr-1 inline" />
              {errors.length} rule{errors.length === 1 ? ' has' : 's have'} an invalid pattern and {errors.length === 1 ? 'was' : 'were'} skipped.
            </span>
          ) : text ? (
            <span class="text-ink-3">
              <Icon name="check" size={13} class="mr-1 inline text-success" />
              {result.total.toLocaleString()} replacement{result.total === 1 ? '' : 's'} across {result.outcomes.filter((o) => o.count > 0).length} rule{result.outcomes.filter((o) => o.count > 0).length === 1 ? '' : 's'}
              {changed ? '. Press Apply to keep them.' : '.'}
            </span>
          ) : (
            <span class="text-ink-3">Paste text and add rules. Nothing leaves your browser.</span>
          )}
        </span>
        <span class="hidden shrink-0 items-center gap-1.5 text-ink-3 sm:flex">
          <span class="kbd">Ctrl</span>+<span class="kbd">Enter</span> apply
        </span>
      </div>
    </div>
  );
}
