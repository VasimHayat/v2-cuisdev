import { describe, expect, it } from 'vitest';
import { CodeFormatError, SAMPLES, beautify, detectLanguage, languageFromFileName, minify, minifyGraphql } from './logic';

describe('GraphQL detection', () => {
  it('recognises operations, fragments, schema files and anonymous queries', () => {
    expect(detectLanguage(SAMPLES.graphql)).toBe('graphql');
    expect(detectLanguage('query { me { id } }')).toBe('graphql');
    expect(detectLanguage('mutation Add($x: Int!) { add(x: $x) }')).toBe('graphql');
    expect(detectLanguage('{ user(id: 1) { name } }')).toBe('graphql');
    expect(detectLanguage('type User {\n  id: ID!\n  name: String\n}')).toBe('graphql');
    expect(detectLanguage('schema { query: Query }')).toBe('graphql');
  });
  it('does not steal TypeScript, JSON or CSS', () => {
    expect(detectLanguage('interface Order{id:string;total:number}')).toBe('typescript');
    expect(detectLanguage('type Options = { limit?: number };')).toBe('typescript');
    expect(detectLanguage('{"a": 1}')).toBe('json');
    expect(detectLanguage('.a{color:red}')).toBe('css');
  });
  it('maps file extensions', () => {
    expect(languageFromFileName('schema.graphql')).toBe('graphql');
    expect(languageFromFileName('query.gql')).toBe('graphql');
  });
});

describe('GraphQL formatting', () => {
  it('pretty prints with Prettier', async () => {
    const out = await beautify('query{me{id name friends(first:2){name}}}', 'graphql');
    expect(out).toBe('query {\n  me {\n    id\n    name\n    friends(first: 2) {\n      name\n    }\n  }\n}\n');
  });
  it('reports syntax errors with a position', async () => {
    const err = (await beautify('query { me { id }', 'graphql').then(
      () => undefined,
      (e: unknown) => e,
    )) as CodeFormatError;
    expect(err).toBeInstanceOf(CodeFormatError);
    expect(err.message).toMatch(/^GraphQL syntax error:/);
    expect(err.position?.line).toBe(1);
  });
});

describe('GraphQL minify', () => {
  it('drops comments, commas and whitespace but keeps strings and spreads', () => {
    const src = '# list\nquery Q($a: Int = 1, $b: [ID!]) {\n  items(a: $a, b: $b, note: "keep  this, # too") {\n    ...F\n    id\n  }\n}';
    expect(minifyGraphql(src)).toBe('query Q($a:Int=1$b:[ID!]){items(a:$a b:$b note:"keep  this, # too"){...F id}}');
  });
  it('keeps block strings and separates adjacent names', () => {
    expect(minifyGraphql('type A {\n  """\n  Doc  string\n  """\n  id: ID!\n  name: String\n}')).toBe('type A{"""\n  Doc  string\n  """ id:ID!name:String}');
    expect(minifyGraphql('{ a b c }')).toBe('{a b c}');
  });
  it('round-trips through Prettier and rejects invalid input before minifying', async () => {
    const minified = await minify(SAMPLES.graphql, 'graphql');
    expect(minified).not.toMatch(/\n|#/);
    const again = await beautify(minified, 'graphql');
    // Minifying drops comments by design; everything else must survive the round trip.
    expect(again).toBe(await beautify(SAMPLES.graphql.replace(/^#.*\n/, ''), 'graphql'));
    await expect(minify('query {', 'graphql')).rejects.toBeInstanceOf(CodeFormatError);
  });
});
