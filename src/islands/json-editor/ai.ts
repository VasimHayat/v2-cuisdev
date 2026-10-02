/**
 * Optional AI assist, calling Google's Gemini API directly from the browser with the user's
 * own key. The key lives in localStorage on this device only. Requests go from the browser
 * to Google; nothing passes through Cuisdev.
 */

const KEY_STORAGE = 'cuis-gemini-key';
const MODEL_STORAGE = 'cuis-gemini-model';

export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'] as const;
export type GeminiModel = (typeof GEMINI_MODELS)[number];

export function loadKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}
export function saveKey(key: string): void {
  try {
    key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE);
  } catch {}
}
export function loadModel(): GeminiModel {
  try {
    const m = localStorage.getItem(MODEL_STORAGE) as GeminiModel | null;
    return m && (GEMINI_MODELS as readonly string[]).includes(m) ? m : GEMINI_MODELS[0];
  } catch {
    return GEMINI_MODELS[0];
  }
}
export function saveModel(model: GeminiModel): void {
  try {
    localStorage.setItem(MODEL_STORAGE, model);
  } catch {}
}

export class AiError extends Error {}

interface GenerateOptions {
  apiKey: string;
  model: GeminiModel;
  prompt: string;
  /** Ask the model for strict JSON output. */
  json?: boolean;
  signal?: AbortSignal;
}

export async function generate({ apiKey, model, prompt, json = false, signal }: GenerateOptions): Promise<string> {
  if (!apiKey.trim()) throw new AiError('Add your Gemini API key first.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: json ? 0.2 : 0.6,
          ...(json ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('Request cancelled.');
    throw new AiError('Could not reach the Gemini API. Check your connection.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message ?? '';
    } catch {}
    if (res.status === 400 && /API key/i.test(detail)) throw new AiError('Gemini rejected the API key. Check it and try again.');
    if (res.status === 429) throw new AiError('Rate limit reached on your Gemini key. Wait a moment and retry.');
    throw new AiError(detail || `Gemini API error (${res.status}).`);
  }
  const data = await res.json();
  const text: string = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  if (!text) throw new AiError('The model returned an empty response.');
  return stripFences(text);
}

export function stripFences(s: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(s);
  return (m ? m[1] : s).trim();
}

export const PROMPTS = {
  generate: (description: string) =>
    `Generate a realistic JSON document based on this description. Output only the JSON, no explanation, no markdown fences.\n\nDescription: ${description}`,
  fix: (broken: string, error: string) =>
    `The following text is meant to be JSON but fails to parse with this error: ${error}\n\nReturn the corrected, strictly valid JSON only. Preserve every value and key as written; change only what is needed to make it valid (quotes, commas, brackets, literals). No explanation, no markdown fences.\n\n${broken}`,
  explain: (json: string) =>
    `Explain this JSON document to a developer in plain English in under 150 words: what it represents, its main sections, notable fields and anything unusual. Use short sentences. No markdown headings.\n\n${json}`,
  transform: (json: string, instruction: string) =>
    `Apply this instruction to the JSON document and return the complete resulting JSON only, no explanation, no markdown fences.\n\nInstruction: ${instruction}\n\nJSON:\n${json}`,
};
