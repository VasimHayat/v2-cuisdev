import { describe, expect, it } from 'vitest';
import {
  SAMPLE,
  applyFormat,
  describeStats,
  extractTitle,
  hardenLinks,
  isUnsafeHref,
  markdownStats,
  normalizeMarkdown,
  renderMarkdown,
  standaloneHtml,
  toFileName,
  type HookElement,
} from './logic';

function fakeLink(href: string | null): HookElement & { attrs: Record<string, string> } {
  const attrs: Record<string, string> = href === null ? {} : { href };
  return {
    tagName: 'A',
    attrs,
    getAttribute: (n) => attrs[n] ?? null,
    setAttribute: (n, v) => void (attrs[n] = v),
    removeAttribute: (n) => void delete attrs[n],
  };
}

describe('rendering', () => {
  it('normalises BOM and line endings', () => {
    expect(normalizeMarkdown('﻿a\r\nb\rc')).toBe('a\nb\nc');
  });
  it('renders GFM tables, task lists, strikethrough and autolinks', () => {
    const html = renderMarkdown(SAMPLE);
    expect(html).toContain('<h1>Release notes</h1>');
    expect(html).toContain('<table>');
    expect(html).toMatch(/<input [^>]*checked[^>]*type="checkbox"|<input [^>]*type="checkbox"[^>]*checked/);
    expect(html).toContain('<del>strikethrough</del>');
    expect(html).toContain('<a href="https://cuisdev.com">');
  });
  it('honours the breaks option and returns empty for blank input', () => {
    expect(renderMarkdown('a\nb', { breaks: true })).toContain('<br>');
    expect(renderMarkdown('a\nb')).not.toContain('<br>');
    expect(renderMarkdown('   \n ')).toBe('');
  });
});

describe('link safety', () => {
  it('flags unsafe schemes, including ones hidden with whitespace', () => {
    expect(isUnsafeHref('javascript:alert(1)')).toBe(true);
    expect(isUnsafeHref(' java\nscript:alert(1)')).toBe(true);
    expect(isUnsafeHref('data:text/html,x')).toBe(true);
    expect(isUnsafeHref('https://x.io')).toBe(false);
    expect(isUnsafeHref('/relative')).toBe(false);
    expect(isUnsafeHref('mailto:a@b.c')).toBe(false);
  });
  it('hardens links: strips unsafe, opens external in a new tab, leaves anchors', () => {
    const bad = fakeLink('javascript:alert(1)');
    hardenLinks(bad);
    expect(bad.attrs.href).toBeUndefined();
    const ext = fakeLink('https://x.io');
    hardenLinks(ext);
    expect(ext.attrs).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
    const anchor = fakeLink('#top');
    hardenLinks(anchor);
    expect(anchor.attrs.target).toBeUndefined();
  });
});

describe('documents and stats', () => {
  it('extracts titles from ATX and setext headings', () => {
    expect(extractTitle('intro\n\n## Hello world ##')).toBe('Hello world');
    expect(extractTitle('My Doc\n======')).toBe('My Doc');
    expect(extractTitle('no heading')).toBe('Document');
  });
  it('builds a standalone HTML document with an escaped title', () => {
    const doc = standaloneHtml('<p>x</p>', 'A <b> & C');
    expect(doc.startsWith('<!doctype html>')).toBe(true);
    expect(doc).toContain('<title>A &lt;b&gt; &amp; C</title>');
    expect(doc).toContain('<p>x</p>');
  });
  it('counts words, lines and reading time', () => {
    const s = markdownStats('one two three\nfour');
    expect(s).toEqual({ words: 4, characters: 18, lines: 2, readingMinutes: 1 });
    expect(describeStats(s)).toBe('4 words · 18 characters · 2 lines · 1 min read');
    expect(describeStats(markdownStats(''))).toBe('');
  });
  it('makes filename slugs', () => {
    expect(toFileName('Release Notes: v2!', 'md')).toBe('release-notes-v2.md');
    expect(toFileName('***', 'html')).toBe('document.html');
  });
});

describe('applyFormat', () => {
  it('wraps a selection and toggles it off again', () => {
    const on = applyFormat('say hi now', 4, 6, 'bold');
    expect(on).toEqual({ text: 'say **hi** now', from: 6, to: 8 });
    expect(applyFormat(on.text, on.from, on.to, 'bold')).toEqual({ text: 'say hi now', from: 4, to: 6 });
  });
  it('inserts a placeholder when nothing is selected', () => {
    expect(applyFormat('ab', 1, 1, 'italic')).toEqual({ text: 'a_italic text_b', from: 2, to: 13 });
  });
  it('builds links with the URL selected', () => {
    const e = applyFormat('go here', 3, 7, 'link');
    expect(e.text).toBe('go [here](https://)');
    expect(e.text.slice(e.from, e.to)).toBe('https://');
  });
  it('prefixes and unprefixes every selected line', () => {
    const e = applyFormat('one\ntwo\nthree', 0, 7, 'list');
    expect(e.text).toBe('- one\n- two\nthree');
    expect(applyFormat(e.text, e.from, e.to, 'list').text).toBe('one\ntwo\nthree');
    expect(applyFormat('a\nb', 0, 3, 'ordered').text).toBe('1. a\n2. b');
    expect(applyFormat('title', 2, 2, 'heading').text).toBe('## title');
  });
  it('wraps code blocks on their own lines', () => {
    expect(applyFormat('x', 1, 1, 'codeblock').text).toBe('x\n```\ncode\n```\n');
  });
});
