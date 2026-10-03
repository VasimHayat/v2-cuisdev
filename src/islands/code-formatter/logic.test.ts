import { describe, expect, it } from 'vitest';
import {
  CodeFormatError,
  SAMPLES,
  beautify,
  detectLanguage,
  fileNameFor,
  languageFromFileName,
  minify,
  minifyHtml,
  minifyJsonText,
  minifySql,
  normalizeSource,
  prettierConfig,
  savingsPercent,
  toFormatError,
} from './logic';

describe('detectLanguage', () => {
  it('spots JSON, HTML, SQL, CSS, SCSS, JavaScript and TypeScript', () => {
    expect(detectLanguage(SAMPLES.json)).toBe('json');
    expect(detectLanguage(SAMPLES.html)).toBe('html');
    expect(detectLanguage(SAMPLES.sql)).toBe('sql');
    expect(detectLanguage(SAMPLES.css)).toBe('css');
    expect(detectLanguage(SAMPLES.scss)).toBe('scss');
    expect(detectLanguage(SAMPLES.javascript)).toBe('javascript');
    expect(detectLanguage(SAMPLES.typescript)).toBe('typescript');
  });
  it('does not mistake object literal keys for type annotations', () => {
    expect(detectLanguage('const a={b:1,c:[1,2]}')).toBe('javascript');
    expect(detectLanguage('const user = { name: "Ada", age: 36 };')).toBe('javascript');
  });
  it('recognises common TypeScript shapes', () => {
    expect(detectLanguage('function f(x: number): string { return String(x) }')).toBe('typescript');
    expect(detectLanguage('const x = y as const;')).toBe('typescript');
    expect(detectLanguage('export interface Props { a?: string }')).toBe('typescript');
  });
  it('maps file extensions', () => {
    expect(languageFromFileName('app.mjs')).toBe('javascript');
    expect(languageFromFileName('types.d.ts')).toBe('typescript');
    expect(languageFromFileName('query.SQL')).toBe('sql');
    expect(languageFromFileName('README.md')).toBeUndefined();
  });
});

describe('helpers', () => {
  it('normalises BOM and line endings', () => {
    expect(normalizeSource('﻿a\r\nb\rc')).toBe('a\nb\nc');
  });
  it('computes savings', () => {
    expect(savingsPercent(1000, 700)).toBe(30);
    expect(savingsPercent(0, 10)).toBe(0);
    expect(savingsPercent(100, 120)).toBe(-20);
  });
  it('names downloads', () => {
    expect(fileNameFor('javascript', 'minify')).toBe('code.min.js');
    expect(fileNameFor('sql', 'beautify')).toBe('code.sql');
  });
  it('maps options onto Prettier', () => {
    expect(prettierConfig('typescript', { indent: 'tab', printWidth: 120, singleQuote: true, semicolons: false, trailingCommas: false })).toEqual({
      parser: 'typescript',
      tabWidth: 2,
      useTabs: true,
      printWidth: 120,
      singleQuote: true,
      semi: false,
      trailingComma: 'none',
      endOfLine: 'lf',
    });
  });
});

describe('minifiers', () => {
  it('minifies JSON and reports error positions', () => {
    expect(minifyJsonText('{ "a": [1, 2] }')).toBe('{"a":[1,2]}');
    const err = (() => {
      try {
        minifyJsonText('{"a": 1 "b": 2}');
      } catch (e) {
        return e as CodeFormatError;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(CodeFormatError);
    expect(err?.position?.line).toBe(1);
    expect(err?.message).toMatch(/JSON syntax error/);
  });
  it('minifies HTML while preserving raw text elements and conditional comments', () => {
    const out = minifyHtml(SAMPLES.html);
    expect(out).toContain('<pre>  keep   this   spacing  </pre>');
    expect(out).not.toContain('<!-- page chrome -->');
    expect(out).toContain('<main class="invoice" id="main">');
    expect(out).toContain('<h1>Invoice 4821</h1>');
    expect(minifyHtml('<!--[if IE]><p>x</p><![endif]-->')).toBe('<!--[if IE]><p>x</p><![endif]-->');
    expect(minifyHtml('<a title="a  b"   href="x">y</a>')).toBe('<a title="a  b" href="x">y</a>');
  });
  it('minifies SQL without touching strings or quoted identifiers', () => {
    expect(minifySql("select  a ,\n  b from t -- note\nwhere x = 'a  b' /* c */ and \"My Col\" = 1;")).toBe(
      "select a,b from t where x = 'a  b' and \"My Col\" = 1;",
    );
    expect(minifySql('insert into t (a, b)\n values (1, 2)')).toBe('insert into t (a,b) values (1,2)');
  });
  it('minifies JavaScript with terser and CSS with csso', async () => {
    expect(await minify('const  answer = 40 + 2; console.log( answer );', 'javascript')).toBe('const answer=42;console.log(42);');
    expect(await minify('.a { color: red; } .a { margin: 0 }', 'css')).toBe('.a{color:red;margin:0}');
  });
  it('refuses TypeScript and SCSS', async () => {
    await expect(minify('let a: number = 1', 'typescript')).rejects.toThrow(/not available for TypeScript/);
    await expect(minify('$a: 1px;', 'scss')).rejects.toThrow(/not available for SCSS/);
  });
});

describe('beautify', () => {
  it('formats JavaScript with the chosen style', async () => {
    expect(await beautify('const a={b:1,c:[1,2]}', 'javascript')).toBe('const a = { b: 1, c: [1, 2] };\n');
    expect(await beautify("const a='x'", 'javascript', { singleQuote: false, semicolons: false })).toBe('const a = "x"\n');
  });
  it('formats SQL with keyword case and dialect', async () => {
    const out = await beautify('select a,b from t where x=1', 'sql', { keywordCase: 'upper' });
    expect(out.split('\n')[0]).toBe('SELECT');
    expect(out).toContain('WHERE');
    expect(await beautify('SELECT 1', 'sql', { keywordCase: 'lower' })).toMatch(/^select/);
  });
  it('formats CSS, HTML, JSON and TypeScript', async () => {
    expect(await beautify('.a{color:red}', 'css')).toBe('.a {\n  color: red;\n}\n');
    expect(await beautify('{"a":1}', 'json')).toBe('{ "a": 1 }\n');
    expect(await beautify('interface A{x:number}', 'typescript')).toBe('interface A {\n  x: number;\n}\n');
    expect(await beautify('<div><p>hi</p></div>', 'html')).toContain('<div>');
  });
  it('turns parser errors into positioned CodeFormatErrors', async () => {
    await expect(beautify('const = 1', 'javascript')).rejects.toBeInstanceOf(CodeFormatError);
    const err = await beautify('.a{color:red', 'css').catch((e: unknown) => e as CodeFormatError);
    expect(err).toBeInstanceOf(CodeFormatError);
    expect((err as CodeFormatError).message).toMatch(/^CSS syntax error:/);
    const sqlErr = await beautify('select from where (', 'sql').catch((e: unknown) => e as CodeFormatError);
    expect(sqlErr).toBeInstanceOf(CodeFormatError);
  });
  it('normalises foreign error shapes', () => {
    const e = toFormatError({ message: 'Unexpected token (2:5)\n  1 | x', loc: { start: { line: 2, column: 5 } } }, 'a\nbcdefg', 'javascript');
    expect(e.message).toBe('JavaScript syntax error: Unexpected token (line 2, column 5)');
    expect(e.position).toEqual({ line: 2, column: 5, offset: 6 });
    expect(toFormatError('boom', '', 'css').message).toBe('CSS syntax error: boom');
  });
});
