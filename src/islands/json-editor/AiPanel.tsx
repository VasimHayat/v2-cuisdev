import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Icon } from '../shared/icons';
import { toast, track } from '../shared/toast';
import { formatJson, parseJson } from './json';
import { AiError, GEMINI_MODELS, PROMPTS, generate, loadKey, loadModel, saveKey, saveModel, type GeminiModel } from './ai';

export function AiPanel({ text, docName, onClose, onApply }: { text: string; docName: string; onClose: () => void; onApply: (t: string) => void }) {
  const parsed = parseJson(text);
  const valid = parsed.ok;
  const error = parsed.ok ? null : parsed.error.message;
  const [key, setKey] = useState(loadKey);
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState<GeminiModel>(loadModel);
  const [prompt, setPrompt] = useState('');
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ kind: 'text' | 'json'; value: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => saveKey(key), [key]);
  useEffect(() => saveModel(model), [model]);

  const run = async (label: string, p: string, json: boolean) => {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(label);
    setResult(null);
    try {
      const out = await generate({ apiKey: key, model, prompt: p, json, signal: ctl.signal });
      if (json) {
        const check = parseJson(out);
        if (check.ok) {
          onApply(formatJson(check.value, 2));
          toast(`${label} applied to ${docName}. Ctrl+Z to undo.`);
        } else setResult({ kind: 'json', value: out });
      } else setResult({ kind: 'text', value: out });
      track('tool_action', { tool: 'json-editor', action: `ai_${label.toLowerCase()}` });
    } catch (e) {
      toast(e instanceof AiError ? e.message : 'AI request failed', 'error', 4000);
    } finally {
      setBusy(null);
    }
  };

  const hasKey = key.trim().length > 10;
  const hasDoc = text.trim().length > 0;

  return (
    <aside class="absolute inset-y-0 right-0 z-30 flex w-full max-w-[22rem] flex-col border-l border-line-strong bg-surface shadow-float" aria-label="AI assist">
      <div class="flex items-center justify-between border-b border-line px-3 py-2">
        <h3 class="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Icon name="sparkles" size={15} class="text-brand-600" /> AI assist
          <span class="ml-1 truncate text-xs font-normal text-ink-3">for {docName}</span>
        </h3>
        <button type="button" class="btn-ghost btn-icon h-7 w-7" onClick={onClose} aria-label="Close AI panel"><Icon name="x" size={15} /></button>
      </div>
      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-sm scrollbar-thin">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-ink-2" for="gemini-key">Your Gemini API key</label>
          <div class="flex gap-1">
            <input id="gemini-key" class="input h-8 text-xs" type={showKey ? 'text' : 'password'} value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} placeholder="AIza..." autocomplete="off" spellcheck={false} />
            <button type="button" class="btn-secondary btn-icon h-8 w-8" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? 'Hide key' : 'Show key'}><Icon name="eye-off" size={14} /></button>
          </div>
          <div class="flex items-center justify-between gap-2">
            <select class="select h-7 flex-1 py-0 text-xs" value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value as GeminiModel)} aria-label="Model">
              {GEMINI_MODELS.map((m) => <option value={m}>{m}</option>)}
            </select>
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener" class="whitespace-nowrap text-xs text-brand-600 hover:underline">Get a free key</a>
          </div>
          <p class="text-[11px] leading-4 text-ink-3">Stored only in this browser. Requests go straight from your browser to Google. Nothing passes through Cuisdev.</p>
        </div>

        <Section title="Generate JSON">
          <textarea class="input h-20 resize-none py-1.5 text-xs" placeholder="Describe the JSON you want, e.g. 5 products with id, name, price and tags" value={prompt} onInput={(e) => setPrompt((e.target as HTMLTextAreaElement).value)} />
          <AiBtn label="Generate" busy={busy} disabled={!hasKey || !prompt.trim()} onClick={() => run('Generate', PROMPTS.generate(prompt), true)} />
        </Section>

        <Section title="Transform this document">
          <textarea class="input h-16 resize-none py-1.5 text-xs" placeholder="e.g. rename userName to name, add an email to every user" value={instruction} onInput={(e) => setInstruction((e.target as HTMLTextAreaElement).value)} />
          <AiBtn label="Transform" busy={busy} disabled={!hasKey || !valid || !instruction.trim()} onClick={() => run('Transform', PROMPTS.transform(text, instruction), true)} />
        </Section>

        <div class="grid grid-cols-2 gap-2">
          <AiBtn label="Fix" busy={busy} disabled={!hasKey || valid || !hasDoc} onClick={() => run('Fix', PROMPTS.fix(text, error ?? 'invalid JSON'), true)} />
          <AiBtn label="Explain" busy={busy} disabled={!hasKey || !valid} onClick={() => run('Explain', PROMPTS.explain(text), false)} secondary />
        </div>
        {busy && <button type="button" class="btn-ghost btn-sm w-full" onClick={() => abortRef.current?.abort()}>Cancel request</button>}

        {result && (
          <div class="rounded-md border border-line bg-surface-2 p-2.5">
            {result.kind === 'text' ? (
              <p class="whitespace-pre-wrap text-[13px] leading-5 text-ink-2">{result.value}</p>
            ) : (
              <>
                <p class="mb-1.5 text-xs text-danger">The model returned something that is not valid JSON:</p>
                <pre class="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-2">{result.value}</pre>
                <button type="button" class="btn-secondary btn-sm mt-2" onClick={() => onApply(result.value)}>Insert anyway</button>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="space-y-1.5">
      <h4 class="text-xs font-medium text-ink-2">{title}</h4>
      {children}
    </div>
  );
}

function AiBtn({ label, busy, disabled, onClick, secondary }: { label: string; busy: string | null; disabled: boolean; onClick: () => void; secondary?: boolean }) {
  return (
    <button type="button" class={(secondary ? 'btn-secondary' : 'btn-primary') + ' btn-sm w-full'} disabled={disabled || !!busy} onClick={onClick}>
      {busy === label ? <Icon name="loader" size={13} class="animate-spin" /> : <Icon name="sparkles" size={13} />}
      {label}
    </button>
  );
}
