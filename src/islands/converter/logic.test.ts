import { describe, expect, it } from 'vitest';
import { ConvertError, DEFAULT_OPTIONS, SAMPLES, convert, csvToJson, detectFormat, flattenRecord, jsonToCsv, jsonToYaml, parseJson, parseYaml, toRows, yamlToJson } from './logic';

const O = DEFAULT_OPTIONS;

describe('parsers', () => {
  it('positions JSON errors', () => {
    const err = (() => {
      try {
        parseJson('{"a": 1,\n "b": }');
      } catch (e) {
        return e as ConvertError;
      }
    })();
    expect(err).toBeInstanceOf(ConvertError);
    expect(err?.line).toBe(2);
    expect(err?.offset).toBeGreaterThan(8);
    expect(() => parseJson('   ')).toThrow(/empty/);
  });
  it('positions YAML errors and handles multiple documents', () => {
    expect(() => parseYaml('a: 1\n b: 2\n  c: [')).toThrow(/Invalid YAML at line/);
    expect(parseYaml('a: 1\n---\nb: 2')).toEqual({ value: [{ a: 1 }, { b: 2 }], documents: 2 });
    expect(parseYaml('# only a comment')).toEqual({ value: null, documents: 0 });
  });
  it('flattens nested records', () => {
    expect(flattenRecord({ a: { b: { c: 1 } }, d: [1, 2], e: null, f: {} })).toEqual({ 'a.b.c': 1, d: '[1,2]', e: '', f: '{}' });
  });
  it('validates rows with helpful hints', () => {
    expect(() => toRows({ name: 'x' })).toThrow(/Wrap a single record/);
    expect(toRows({ data: [{ a: 1 }] })).toEqual([{ a: 1 }]);
    expect(toRows([1, 'two'])).toEqual([{ value: 1 }, { value: 'two' }]);
    expect(() => toRows([{ a: 1 }, 5])).toThrow(/item 1 is a number/);
    expect(() => toRows('str')).toThrow(/top-level value is a string/);
  });
});

describe('JSON <-> CSV', () => {
  it('converts an array of objects with dot-notation columns', () => {
    const r = jsonToCsv(SAMPLES.json, O);
    expect(r.output.split('\n')[0]).toBe('id,name,email,role,address.city,address.country,tags');
    expect(r.output).toContain('"[""founder"",""math""]"');
    expect(r.summary).toBe('3 rows · 7 columns');
  });
  it('honours delimiter, header and quoting options', () => {
    const r = jsonToCsv('[{"a":1,"b":"x"}]', { ...O, delimiter: ';', header: false, quoteAll: true });
    expect(r.output).toBe('"1";"x"\n');
  });
  it('parses CSV to objects, detecting the delimiter', () => {
    const r = csvToJson(SAMPLES.csv, { ...O, delimiter: 'auto' });
    const rows = JSON.parse(r.output) as Record<string, string>[];
    expect(rows).toHaveLength(3);
    expect(rows[2]?.name).toBe('Hopper, Grace');
    expect(rows[0]?.id).toBe('1');
    expect(r.summary).toContain('comma delimited');
    const typed = csvToJson('a,b\n1,true\n02134,x', { ...O, delimiter: 'auto', dynamicTyping: true });
    expect(JSON.parse(typed.output)).toEqual([{ a: 1, b: true }, { a: 2134, b: 'x' }]);
  });
  it('parses headerless CSV to arrays and warns about ragged rows', () => {
    const r = csvToJson('1;2;3\n4;5', { ...O, delimiter: ';', header: false });
    expect(JSON.parse(r.output)).toEqual([['1', '2', '3'], ['4', '5']]);
    const ragged = csvToJson('a,b\n1,2,3', { ...O, delimiter: 'auto' });
    expect(ragged.warnings[0]).toMatch(/Line 2/);
  });
  it('reports unterminated quotes with a position', () => {
    expect(() => csvToJson('a,b\n"open,2', { ...O, delimiter: 'auto' })).toThrow(/Invalid CSV at line/);
  });
});

describe('JSON <-> YAML', () => {
  it('emits readable YAML and quotes ambiguous strings', () => {
    const r = jsonToYaml('{"name":"x","version":"1.0","flag":"true","n":5,"list":[1,2]}', O);
    expect(r.output).toContain('name: x\n');
    expect(r.output).toContain('version: "1.0"\n');
    expect(r.output).toContain('flag: "true"\n');
    expect(r.output).toContain('list:\n  - 1\n  - 2\n');
    expect(r.summary).toBe('5 top-level keys');
  });
  it('converts YAML to JSON with indentation and minify', () => {
    const r = yamlToJson(SAMPLES.yaml, O);
    const v = JSON.parse(r.output) as Record<string, unknown>;
    expect(v.replicas).toBe(3);
    expect(v.ports).toEqual([8080, 9090]);
    expect((v.owners as unknown[])[0]).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(yamlToJson('a: 1', { ...O, minify: true }).output).toBe('{"a":1}\n');
    expect(yamlToJson('a: 1\n---\nb: 2', O).warnings[0]).toMatch(/2 YAML documents/);
  });
  it('round-trips through convert()', () => {
    const yaml = convert('json', 'yaml', SAMPLES.json, O).output;
    const back = convert('yaml', 'json', yaml, O).output;
    expect(JSON.parse(back)).toEqual(JSON.parse(SAMPLES.json));
    expect(() => convert('csv', 'yaml', 'a,b', O)).toThrow(/not supported/);
  });
});

describe('detectFormat', () => {
  it('guesses JSON, CSV and YAML', () => {
    expect(detectFormat(SAMPLES.json)).toBe('json');
    expect(detectFormat(SAMPLES.csv)).toBe('csv');
    expect(detectFormat(SAMPLES.yaml)).toBe('yaml');
    expect(detectFormat('')).toBeNull();
  });
});
