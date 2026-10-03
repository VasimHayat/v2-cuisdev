/**
 * Markdown Preview: pure functions, no DOM.
 *
 * marked turns Markdown into (untrusted) HTML here. Sanitising needs a DOM, so the island
 * passes the HTML to DOMPurify with SANITIZE_CONFIG and the hardenLinks hook below. Both
 * are exported so they can be tested without a browser.
 */
import { Marked } from 'marked';

export interface RenderOptions {
  /** GitHub Flavored Markdown: tables, task lists, strikethrough, autolinks. */
  gfm?: boolean;
  /** Treat a single newline as a line break. */
  breaks?: boolean;
}

const BOM = '﻿';
export const MAX_DRAFT_BYTES = 200 * 1024;

/** Strip a UTF-8 BOM and normalise Windows and classic-Mac line endings. */
export function normalizeMarkdown(markdown: string): string {
  const withoutBom = markdown.startsWith(BOM) ? markdown.slice(BOM.length) : markdown;
  return withoutBom.replace(/\r\n?/g, '\n');
}

const parsers = new Map<string, Marked>();

/** Render Markdown to untrusted HTML synchronously. */
export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  const source = normalizeMarkdown(markdown);
  if (source.trim() === '') return '';
  const gfm = options.gfm ?? true;
  const breaks = options.breaks ?? false;
  const key = `${gfm}:${breaks}`;
  let parser = parsers.get(key);
  if (!parser) {
    parser = new Marked({ gfm, breaks, async: false });
    parsers.set(key, parser);
  }
  return parser.parse(source) as string;
}

/** DOMPurify policy: HTML profile only, with layout and script injection vectors removed. */
export const SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'base', 'link', 'meta'],
  FORBID_ATTR: ['style', 'srcset', 'formaction', 'ping'],
  ALLOW_DATA_ATTR: false,
} as const;

export const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:', 'ftp:'];

function stripInvisible(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0xa0 || code === 0x2028 || code === 0x2029) continue;
    out += char;
  }
  return out;
}

/** True for URLs that must never survive sanitising (javascript:, data:, vbscript: and friends). */
export function isUnsafeHref(value: string): boolean {
  const cleaned = stripInvisible(value).toLowerCase();
  const scheme = /^([a-z0-9+.-]+):/.exec(cleaned);
  if (!scheme) return false;
  return !SAFE_SCHEMES.includes(`${scheme[1]}:`);
}

export interface HookElement {
  tagName: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/** DOMPurify afterSanitizeAttributes hook: drop unsafe hrefs, open external links in a new tab. */
export function hardenLinks(node: HookElement): void {
  if (node.tagName.toUpperCase() !== 'A') return;
  const href = node.getAttribute('href');
  if (href === null) return;
  if (isUnsafeHref(href)) {
    node.removeAttribute('href');
    node.setAttribute('data-blocked-url', 'true');
    return;
  }
  if (href.startsWith('#')) return;
  node.setAttribute('target', '_blank');
  node.setAttribute('rel', 'noopener noreferrer');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** First ATX or setext heading, used to title downloads. */
export function extractTitle(markdown: string, fallback = 'Document'): string {
  const lines = normalizeMarkdown(markdown).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const atx = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx?.[1]) return atx[1].trim();
    const next = lines[i + 1] ?? '';
    if (line.trim() !== '' && /^\s{0,3}(=+|-{2,})\s*$/.test(next)) return line.trim();
  }
  return fallback;
}

/** Wrap sanitised HTML in a minimal standalone document for download. */
export function standaloneHtml(bodyHtml: string, title = 'Document'): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body { max-width: 46rem; margin: 2rem auto; padding: 0 1rem; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
      h1, h2, h3 { line-height: 1.25; }
      code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      pre { padding: 1rem; overflow-x: auto; background: rgba(127, 127, 127, 0.12); border-radius: 6px; }
      code { font-size: 0.9em; }
      blockquote { margin: 0; padding-left: 1rem; border-left: 3px solid rgba(127, 127, 127, 0.5); }
      table { border-collapse: collapse; }
      th, td { padding: 0.4rem 0.75rem; border: 1px solid rgba(127, 127, 127, 0.4); }
      img { max-width: 100%; }
      li:has(> input[type="checkbox"]) { list-style: none; }
    </style>
  </head>
  <body>
${bodyHtml}
  </body>
</html>
`;
}

export interface MarkdownStats {
  words: number;
  characters: number;
  lines: number;
  readingMinutes: number;
}

export function countWords(text: string): number {
  const trimmed = normalizeMarkdown(text).trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function markdownStats(text: string): MarkdownStats {
  const normalized = normalizeMarkdown(text);
  const words = countWords(normalized);
  return { words, characters: normalized.length, lines: normalized === '' ? 0 : normalized.split('\n').length, readingMinutes: words === 0 ? 0 : Math.max(1, Math.round(words / 200)) };
}

export function describeStats(stats: MarkdownStats): string {
  if (stats.words === 0) return '';
  const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(stats.words, 'word')} · ${plural(stats.characters, 'character')} · ${plural(stats.lines, 'line')} · ${stats.readingMinutes} min read`;
}

/** Filename-safe slug from the document title. */
export function toFileName(title: string, extension: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'document';
  return `${slug}.${extension}`;
}

// --- formatting buttons ----------------------------------------------------------

export type FormatKind = 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'heading' | 'quote' | 'list' | 'ordered' | 'task' | 'codeblock';

export interface Edit {
  text: string;
  /** New selection in the result. */
  from: number;
  to: number;
}

const INLINE: Partial<Record<FormatKind, [string, string, string]>> = {
  bold: ['**', '**', 'bold text'],
  italic: ['_', '_', 'italic text'],
  strike: ['~~', '~~', 'struck text'],
  code: ['`', '`', 'code'],
};

const LINE_PREFIX: Partial<Record<FormatKind, string>> = { heading: '## ', quote: '> ', list: '- ', ordered: '1. ', task: '- [ ] ' };

/**
 * Apply a toolbar format to the selection [from, to) of `text`. Inline formats wrap the
 * selection (or a placeholder when empty) and toggle off when already wrapped; line
 * formats prefix every selected line and toggle off when every line already has it.
 */
export function applyFormat(text: string, from: number, to: number, kind: FormatKind): Edit {
  const a = Math.max(0, Math.min(from, to, text.length));
  const b = Math.min(text.length, Math.max(from, to));
  const selected = text.slice(a, b);

  const inline = INLINE[kind];
  if (inline) {
    const [open, close, placeholder] = inline;
    if (text.slice(a - open.length, a) === open && text.slice(b, b + close.length) === close && b > a) {
      const out = text.slice(0, a - open.length) + selected + text.slice(b + close.length);
      return { text: out, from: a - open.length, to: b - open.length };
    }
    const body = selected || placeholder;
    const out = text.slice(0, a) + open + body + close + text.slice(b);
    return { text: out, from: a + open.length, to: a + open.length + body.length };
  }

  if (kind === 'link') {
    const label = selected || 'link text';
    const insert = `[${label}](https://)`;
    const out = text.slice(0, a) + insert + text.slice(b);
    const urlStart = a + label.length + 3;
    return { text: out, from: urlStart, to: urlStart + 'https://'.length };
  }

  if (kind === 'codeblock') {
    const body = selected || 'code';
    const before = a > 0 && text[a - 1] !== '\n' ? '\n' : '';
    const insert = `${before}\`\`\`\n${body}\n\`\`\`\n`;
    const out = text.slice(0, a) + insert + text.slice(b);
    const start = a + before.length + 4;
    return { text: out, from: start, to: start + body.length };
  }

  const prefix = LINE_PREFIX[kind];
  if (!prefix) return { text, from: a, to: b };
  const lineStart = text.lastIndexOf('\n', a - 1) + 1;
  const nextBreak = text.indexOf('\n', b > a && text[b - 1] === '\n' ? b - 1 : b);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const all = lines.every((l) => l.startsWith(prefix));
  const changed = lines.map((l, i) => {
    if (all) return l.slice(prefix.length);
    if (kind === 'ordered') return `${i + 1}. ${l.replace(/^\d+\.\s/, '')}`;
    return prefix + l;
  });
  const block = changed.join('\n');
  const out = text.slice(0, lineStart) + block + text.slice(lineEnd);
  return { text: out, from: lineStart, to: lineStart + block.length };
}

export const SAMPLE = `# Release notes

Cuisdev renders **Markdown** as you type, with _GitHub Flavored Markdown_ support.

## What's new

- [x] Live preview with synced scrolling
- [x] Tables, task lists and ~~strikethrough~~
- [ ] Your next feature

> Everything runs in your browser. Nothing is uploaded.

| Format | Shortcut | Notes |
| ------ | -------- | ----- |
| Bold   | Ctrl+B   | Wraps the selection |
| Italic | Ctrl+I   | Uses underscores |

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
console.log(greet('world'));
\`\`\`

Visit https://cuisdev.com or read the [Markdown guide](https://www.markdownguide.org/).
`;
