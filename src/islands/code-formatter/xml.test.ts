import { describe, expect, it } from 'vitest';
import { XML_SAMPLE, XmlSyntaxError, check, formatXml, minifyXml } from './xml';
import { beautify, detectLanguage, minify } from './logic';

describe('formatXml', () => {
  it('indents nested elements and keeps simple text elements on one line', () => {
    const out = formatXml('<a><b>text</b><c/><d></d></a>');
    expect(out).toBe('<a>\n  <b>text</b>\n  <c />\n  <d></d>\n</a>\n');
  });
  it('handles the declaration, comments, CDATA and namespaces', () => {
    const out = formatXml(XML_SAMPLE);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<catalog xmlns:dc="http://purl.org/dc/elements/1.1/">\n')).toBe(true);
    expect(out).toContain('  <!-- Spring 2026 list -->\n');
    expect(out).toContain('    <dc:title>XML for the Impatient</dc:title>\n');
    expect(out).toContain('    <notes><![CDATA[Contains <literal> markup & ampersands]]></notes>\n');
    expect(out).toContain('    <tags />\n');
  });
  it('keeps mixed content inline', () => {
    const out = formatXml('<p>A <em>short</em> and\n   <strong>practical</strong> guide.</p>');
    expect(out).toBe('<p>A <em>short</em> and <strong>practical</strong> guide.</p>\n');
  });
  it('supports 4 spaces and tabs', () => {
    expect(formatXml('<a><b/></a>', { indent: 4 })).toBe('<a>\n    <b />\n</a>\n');
    expect(formatXml('<a><b/></a>', { indent: 'tab' })).toBe('<a>\n\t<b />\n</a>\n');
  });
  it('normalises attribute spacing', () => {
    expect(formatXml('<a   x="1"\n  y = "2"   />')).toBe('<a x="1" y="2" />\n');
  });
});

describe('check', () => {
  const errorOf = (src: string) => {
    try {
      check(src);
    } catch (e) {
      return e as XmlSyntaxError;
    }
    return undefined;
  };
  it('reports mismatched, unclosed and stray tags with offsets', () => {
    expect(errorOf('<a><b></a>')).toMatchObject({ offset: 6, message: expect.stringContaining('Expected "</b>"') });
    expect(errorOf('<a><b>')?.message).toMatch(/"<b>" is never closed/);
    expect(errorOf('</a>')?.message).toMatch(/no matching opening tag/);
    expect(errorOf('<a/><b/>')?.message).toMatch(/Only one root element/);
    expect(errorOf('<a x=1/>')?.message).toMatch(/must be quoted/);
    expect(errorOf('<a x="1" x="2"/>')?.message).toMatch(/Duplicate attribute/);
    expect(errorOf('<a>text')?.message).toMatch(/never closed/);
    expect(errorOf('<a><!-- open')?.message).toMatch(/Unterminated comment/);
    expect(errorOf('hello <a/>')?.message).toMatch(/outside the root/);
  });
  it('accepts valid documents', () => {
    expect(() => check(XML_SAMPLE)).not.toThrow();
    expect(() => check('<!DOCTYPE note [<!ELEMENT note (#PCDATA)>]><note>x</note>')).not.toThrow();
  });
});

describe('minifyXml', () => {
  it('removes comments and inter-element whitespace but keeps text', () => {
    expect(minifyXml('<a>\n  <!-- c -->\n  <b> keep this </b>\n  <c   x="1" />\n</a>\n')).toBe('<a><b>keep this</b><c x="1"/></a>');
  });
  it('collapses whitespace in mixed content', () => {
    expect(minifyXml('<p>A  <em>b</em>\n c</p>')).toBe('<p>A <em>b</em> c</p>');
  });
});

describe('integration with the formatter', () => {
  it('detects XML versus HTML', () => {
    expect(detectLanguage(XML_SAMPLE)).toBe('xml');
    expect(detectLanguage('<note><to>Tove</to></note>')).toBe('xml');
    expect(detectLanguage('<div><p>Hi</p></div>')).toBe('html');
    expect(detectLanguage('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBe('xml');
  });
  it('beautifies and minifies through the shared entry points with positioned errors', async () => {
    expect(await beautify('<a><b/></a>', 'xml', { indent: 2 })).toBe('<a>\n  <b />\n</a>\n');
    expect(await minify('<a>\n <b/>\n</a>', 'xml')).toBe('<a><b/></a>');
    const err = (await beautify('<a>\n<b></c>\n</a>', 'xml').then(
      () => undefined,
      (e: unknown) => e,
    )) as Error & { position?: { line: number; column: number } };
    expect(err.message).toMatch(/^XML syntax error: .*\(line 2, column 4\)$/);
    expect(err.position).toMatchObject({ line: 2, column: 4 });
  });
});
