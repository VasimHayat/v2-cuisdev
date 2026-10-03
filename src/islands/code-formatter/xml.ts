/**
 * XML pretty printer, minifier and well-formedness checker: pure functions, no DOM.
 * A small tokenizer handles declarations, doctype, comments, CDATA, processing
 * instructions, elements and text. Mixed content (text and inline tags in the same
 * element, as in XHTML paragraphs) is kept on one line so whitespace meaning survives.
 */

export interface XmlError {
  message: string;
  /** 0-based character offset. */
  offset: number;
}

export class XmlSyntaxError extends Error {
  override name = 'XmlSyntaxError';
  constructor(
    message: string,
    public readonly offset: number,
  ) {
    super(message);
  }
}

type Token =
  | { kind: 'decl' | 'doctype' | 'comment' | 'cdata' | 'pi'; text: string; offset: number }
  | { kind: 'open'; name: string; text: string; selfClosing: boolean; offset: number }
  | { kind: 'close'; name: string; text: string; offset: number }
  | { kind: 'text'; text: string; offset: number };

const NAME_RE = /^[A-Za-z_:][\w.:-]*/;

function lineOf(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

/** Index just past the `>` that ends the tag at `start`, honouring quoted attribute values. */
function tagEnd(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const close = src.indexOf(ch, i + 1);
      if (close === -1) throw new XmlSyntaxError('Unterminated attribute value', i);
      i = close + 1;
      continue;
    }
    if (ch === '<') throw new XmlSyntaxError('Unexpected "<" inside a tag (missing ">"?)', i);
    if (ch === '>') return i + 1;
    i++;
  }
  throw new XmlSyntaxError('Unterminated tag', start);
}

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    if (src[i] !== '<') {
      const next = src.indexOf('<', i);
      const stop = next === -1 ? n : next;
      tokens.push({ kind: 'text', text: src.slice(i, stop), offset: i });
      i = stop;
      continue;
    }
    if (src.startsWith('<!--', i)) {
      const close = src.indexOf('-->', i + 4);
      if (close === -1) throw new XmlSyntaxError('Unterminated comment', i);
      tokens.push({ kind: 'comment', text: src.slice(i, close + 3), offset: i });
      i = close + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', i)) {
      const close = src.indexOf(']]>', i + 9);
      if (close === -1) throw new XmlSyntaxError('Unterminated CDATA section', i);
      tokens.push({ kind: 'cdata', text: src.slice(i, close + 3), offset: i });
      i = close + 3;
      continue;
    }
    if (src.startsWith('<?', i)) {
      const close = src.indexOf('?>', i + 2);
      if (close === -1) throw new XmlSyntaxError('Unterminated processing instruction', i);
      const text = src.slice(i, close + 2);
      tokens.push({ kind: /^<\?xml[\s?]/i.test(text) ? 'decl' : 'pi', text, offset: i });
      i = close + 2;
      continue;
    }
    if (src.startsWith('<!', i)) {
      // DOCTYPE, possibly with an internal subset in [ ... ]
      let j = i + 2;
      let depth = 0;
      while (j < n) {
        const ch = src[j];
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) break;
        j++;
      }
      if (j >= n) throw new XmlSyntaxError('Unterminated DOCTYPE', i);
      tokens.push({ kind: 'doctype', text: src.slice(i, j + 1), offset: i });
      i = j + 1;
      continue;
    }
    if (src[i + 1] === '/') {
      const end = tagEnd(src, i);
      const name = src.slice(i + 2, end - 1).trim();
      if (!NAME_RE.test(name) || NAME_RE.exec(name)![0] !== name) throw new XmlSyntaxError(`Invalid closing tag "${src.slice(i, end)}"`, i);
      tokens.push({ kind: 'close', name, text: `</${name}>`, offset: i });
      i = end;
      continue;
    }
    const m = NAME_RE.exec(src.slice(i + 1, i + 200));
    if (!m) throw new XmlSyntaxError(`Expected a tag name after "<"`, i + 1);
    const end = tagEnd(src, i);
    const raw = src.slice(i, end);
    const selfClosing = /\/\s*>$/.test(raw);
    validateAttributes(raw, i, m[0]);
    tokens.push({ kind: 'open', name: m[0], text: normalizeTag(raw), selfClosing, offset: i });
    i = end;
  }
  return tokens;
}

/** Check attribute syntax: name="value" pairs, no duplicates, quoted values. */
function validateAttributes(tag: string, offset: number, name: string): void {
  let body = tag.slice(1 + name.length, tag.length - 1).replace(/\/\s*$/, '');
  let pos = offset + 1 + name.length;
  const seen = new Set<string>();
  const re = /\s*([A-Za-z_:][\w.:-]*)\s*=\s*("[^"]*"|'[^']*')|\s*(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[3] !== undefined) {
      const bad = m[3];
      throw new XmlSyntaxError(/=/.test(bad) ? `Attribute value must be quoted: ${bad}` : `Attribute "${bad}" has no value (XML needs name="value")`, pos + m.index + (m[0].length - bad.length));
    }
    const attr = m[1]!;
    if (seen.has(attr)) throw new XmlSyntaxError(`Duplicate attribute "${attr}"`, pos + m.index);
    seen.add(attr);
    if (m[0].trim() === '') break;
  }
  void body;
}

/** Collapse whitespace between attributes; keep quoted values verbatim. */
function normalizeTag(tag: string): string {
  let out = '';
  let i = 0;
  while (i < tag.length) {
    const ch = tag[i] as string;
    if (ch === '"' || ch === "'") {
      const close = tag.indexOf(ch, i + 1);
      const stop = close === -1 ? tag.length : close + 1;
      out += tag.slice(i, stop);
      i = stop;
      continue;
    }
    if (/\s/.test(ch)) {
      let j = i;
      while (j < tag.length && /\s/.test(tag[j] as string)) j++;
      const rest = tag.slice(j);
      if (!rest.startsWith('>') && !rest.startsWith('/>') && !rest.startsWith('=') && !out.endsWith('=')) out += ' ';
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return out.replace(/\s*\/>$/, ' />').replace(/^(<[^\s>]+)\s\/>$/, '$1 />');
}

/** Throw on unbalanced or mis-nested tags. Returns the token list for reuse. */
export function check(src: string): Token[] {
  const tokens = tokenize(src);
  const stack: { name: string; offset: number }[] = [];
  let roots = 0;
  let sawDecl = false;
  for (const t of tokens) {
    if (t.kind === 'decl') {
      if (sawDecl || tokens.indexOf(t) !== 0 && tokens.slice(0, tokens.indexOf(t)).some((x) => x.kind !== 'text' || x.text.trim() !== '')) throw new XmlSyntaxError('The XML declaration must be the very first thing in the document', t.offset);
      sawDecl = true;
    } else if (t.kind === 'open') {
      if (stack.length === 0) {
        roots++;
        if (roots > 1) throw new XmlSyntaxError(`Only one root element is allowed, found a second "<${t.name}>"`, t.offset);
      }
      if (!t.selfClosing) stack.push({ name: t.name, offset: t.offset });
    } else if (t.kind === 'close') {
      const top = stack.pop();
      if (!top) throw new XmlSyntaxError(`Closing tag "</${t.name}>" has no matching opening tag`, t.offset);
      if (top.name !== t.name) throw new XmlSyntaxError(`Expected "</${top.name}>" to close the "<${top.name}>" opened on line ${lineOf(src, top.offset)}, found "</${t.name}>"`, t.offset);
    } else if (t.kind === 'text' && stack.length === 0 && t.text.trim() !== '') {
      throw new XmlSyntaxError('Text is not allowed outside the root element', t.offset + (t.text.length - t.text.trimStart().length));
    }
  }
  const open = stack[stack.length - 1];
  if (open) throw new XmlSyntaxError(`Element "<${open.name}>" is never closed`, open.offset);
  if (roots === 0) throw new XmlSyntaxError('No root element found', 0);
  return tokens;
}

export interface FormatXmlOptions {
  indent?: 2 | 4 | 'tab';
}

/** Pretty print XML. Throws XmlSyntaxError for malformed input. */
export function formatXml(src: string, options: FormatXmlOptions = {}): string {
  const tokens = check(src);
  const unit = options.indent === 'tab' ? '\t' : ' '.repeat(options.indent ?? 2);
  const lines: string[] = [];
  let depth = 0;
  let i = 0;

  const push = (text: string) => lines.push(unit.repeat(depth) + text);

  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.kind === 'text') {
      if (t.text.trim() === '') {
        i++;
        continue;
      }
      // Text at this level means mixed content: emit it on its own line, collapsed.
      push(t.text.replace(/\s+/g, ' ').trim());
      i++;
      continue;
    }
    if (t.kind === 'open' && !t.selfClosing) {
      // Simple element with only text: <a>text</a> on one line.
      const next = tokens[i + 1];
      const after = tokens[i + 2];
      if (next && after && after.kind === 'close' && after.name === t.name && (next.kind === 'text' || next.kind === 'cdata')) {
        const inner = next.kind === 'text' ? next.text.replace(/\s+/g, ' ').trim() : next.text;
        push(`${t.text}${inner}${after.text}`);
        i += 3;
        continue;
      }
      if (next && next.kind === 'close' && next.name === t.name) {
        push(`${t.text}${next.text}`);
        i += 2;
        continue;
      }
      // Mixed content: inline everything until the matching close.
      const span = mixedSpan(tokens, i);
      if (span !== null) {
        push(tokens.slice(i, span + 1).map((x) => (x.kind === 'text' ? x.text.replace(/\s+/g, ' ') : x.text)).join('').trim());
        i = span + 1;
        continue;
      }
      push(t.text);
      depth++;
      i++;
      continue;
    }
    if (t.kind === 'close') {
      depth = Math.max(0, depth - 1);
      push(t.text);
      i++;
      continue;
    }
    if (t.kind === 'comment') {
      const body = t.text.slice(4, -3);
      if (body.includes('\n')) {
        const trimmed = body
          .split('\n')
          .map((l) => l.trim())
          .filter((l, idx, arr) => !(l === '' && (idx === 0 || idx === arr.length - 1)));
        push('<!--');
        for (const l of trimmed) push(unit + l);
        push('-->');
      } else push(`<!-- ${body.trim()} -->`);
      i++;
      continue;
    }
    push(t.text);
    i++;
  }
  return lines.join('\n') + '\n';
}

/**
 * If the element at `start` contains non-whitespace text mixed with child elements
 * (and no nested block structure deeper than one level), return the index of its
 * closing tag so it can be printed inline. Otherwise null.
 */
function mixedSpan(tokens: Token[], start: number): number | null {
  const open = tokens[start];
  if (!open || open.kind !== 'open') return null;
  let depth = 0;
  let sawText = false;
  let length = 0;
  for (let j = start; j < tokens.length; j++) {
    const t = tokens[j]!;
    length += t.text.length;
    if (t.kind === 'open' && !t.selfClosing) depth++;
    else if (t.kind === 'close') {
      depth--;
      if (depth === 0) return sawText && length <= 400 ? j : null;
    } else if (t.kind === 'text' && t.text.trim() !== '' && depth === 1) sawText = true;
    else if (t.kind === 'comment' || t.kind === 'cdata' || t.kind === 'pi') return null;
    if (depth > 2) return null;
  }
  return null;
}

/** Minify XML: drop whitespace-only text and comments, collapse other whitespace. */
export function minifyXml(src: string): string {
  const tokens = check(src);
  let out = '';
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.kind === 'comment') continue;
    if (t.kind === 'text') {
      if (t.text.trim() === '') continue;
      // Preserve inner text exactly when it is the sole child; collapse in mixed content.
      const prev = tokens[i - 1];
      const next = tokens[i + 1];
      const sole = prev?.kind === 'open' && next?.kind === 'close';
      out += sole ? t.text.trim() : t.text.replace(/\s+/g, ' ');
      continue;
    }
    if (t.kind === 'open') {
      out += t.text.replace(/\s\/>$/, '/>');
      if (!t.selfClosing) depth++;
      continue;
    }
    if (t.kind === 'close') depth--;
    out += t.text;
  }
  void depth;
  return out;
}

export const XML_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:dc="http://purl.org/dc/elements/1.1/"><!-- Spring 2026 list --><book id="bk101" lang="en">
<dc:title>XML for the Impatient</dc:title><author>Ada Lovelace</author>
<price currency="GBP">29.99</price><tags><tag>xml</tag><tag>reference</tag></tags>
<description>A <em>short</em> and <strong>practical</strong> guide.</description>
<published>2026-03-14</published></book>
<book id="bk102" lang="de"><dc:title>Daten im Browser</dc:title><author>Grace Hopper</author><price currency="EUR">24.50</price><tags/>
<notes><![CDATA[Contains <literal> markup & ampersands]]></notes></book></catalog>`;
