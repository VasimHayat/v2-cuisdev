import { describe, expect, it } from 'vitest';
import {
  GENERATORS,
  MockError,
  SAMPLE_TEMPLATE,
  createRng,
  findUnknown,
  generate,
  isFlatTable,
  parseTemplate,
  referenceGroups,
  repeatSpec,
  run,
  suggest,
  toCsv,
  todayBase,
} from './logic';

const NOW = Date.UTC(2026, 9, 3);
const opts = { seed: 42, now: NOW };

describe('rng and parsing', () => {
  it('is deterministic per seed', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(createRng(8)()).not.toBe(createRng(7)());
  });
  it('reports invalid template JSON with a position', () => {
    const err = (() => {
      try {
        parseTemplate('{\n  "a": 1,\n}');
      } catch (e) {
        return e as MockError;
      }
    })();
    expect(err).toBeInstanceOf(MockError);
    expect(err?.message).toMatch(/line 3, column 1/);
    expect(err?.offset).toBeTypeOf('number');
    expect(() => parseTemplate('  ')).toThrow(/empty/);
  });
});

describe('generation', () => {
  it('produces the same output for the same seed and base date', () => {
    expect(run(SAMPLE_TEMPLATE, opts).json).toBe(run(SAMPLE_TEMPLATE, opts).json);
    expect(run(SAMPLE_TEMPLATE, opts).json).not.toBe(run(SAMPLE_TEMPLATE, { ...opts, seed: 43 }).json);
  });
  it('keeps native types for whole placeholders and interpolates mixed strings', () => {
    const v = generate({ n: '{{number.int(5,5)}}', b: '{{boolean(1)}}', f: '{{number.float(1,1,2)}}', s: 'Age {{number.int(7,7)}}!' }, opts) as Record<string, unknown>;
    expect(v).toEqual({ n: 5, b: true, f: 1, s: 'Age 7!' });
  });
  it('repeats arrays with fixed and ranged counts, and indexes items', () => {
    const v = generate(['{{repeat(3)}}', { i: '{{index}}', j: '{{index(1)}}' }], opts) as { i: number; j: number }[];
    expect(v.map((x) => x.i)).toEqual([0, 1, 2]);
    expect(v.map((x) => x.j)).toEqual([1, 2, 3]);
    for (let seed = 1; seed < 20; seed++) {
      const n = (generate(['{{repeat(2,4)}}', 'x'], { seed, now: NOW }) as unknown[]).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(4);
    }
  });
  it('lets the root count override the root repeat but not nested ones', () => {
    const v = generate(['{{repeat(5)}}', { tags: ['{{repeat(2)}}', '{{lorem.word}}'] }], { ...opts, rootCount: 12 }) as { tags: string[] }[];
    expect(v).toHaveLength(12);
    expect(v.every((x) => x.tags.length === 2)).toBe(true);
    expect(repeatSpec(['{{repeat(3,8)}}', 1])).toEqual({ min: 3, max: 8 });
    expect(repeatSpec(['a'])).toBeNull();
  });
  it('restores the outer index after a nested repeat', () => {
    const v = generate(['{{repeat(2)}}', { inner: ['{{repeat(3)}}', '{{index}}'], outer: '{{index}}' }], opts) as { inner: number[]; outer: number }[];
    expect(v[1]).toEqual({ inner: [0, 1, 2], outer: 1 });
  });
  it('generates well-formed values for every generator', () => {
    const v = run(SAMPLE_TEMPLATE, opts).value as Record<string, unknown>[];
    expect(v).toHaveLength(5);
    const first = v[0]!;
    expect(first.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.email).toMatch(/^[a-z]+\.[a-z-]+@[a-z.]+$/);
    expect(new Date(first.registered as string).getTime()).toBeLessThanOrEqual(NOW);
    expect(['red', 'green', 'blue']).toContain(first.favoriteColor);
    const ctx = { rng: createRng(1), index: 0, now: NOW };
    for (const [name, def] of Object.entries(GENERATORS)) {
      if (name === 'pick') continue;
      expect(def.run(ctx, []), name).not.toBeUndefined();
    }
    expect(GENERATORS['internet.ipv4']!.run(ctx, [])).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
    expect(GENERATORS['color.hex']!.run(ctx, [])).toMatch(/^#[0-9a-f]{6}$/);
    const d = GENERATORS['date.between']!.run(ctx, ['2024-01-01', '2024-12-31']) as string;
    expect(d.startsWith('2024-')).toBe(true);
  });
  it('rejects bad arguments and runaway sizes', () => {
    expect(() => generate('{{number.int(a,5)}}', opts)).toThrow(/min must be a number/);
    expect(() => generate('{{pick()}}', opts)).toThrow(/at least one value/);
    expect(() => generate('{{date.between(nope,2024-01-01)}}', opts)).toThrow(/not a date/);
    expect(() => generate(['{{repeat(1000)}}', ['{{repeat(1000)}}', 1]], opts)).toThrow(/more than 50,000 items/);
  });
});

describe('unknown placeholders', () => {
  it('lists unknown names with suggestions', () => {
    expect(findUnknown({ a: '{{nmae.first}}', b: ['{{repeat(2)}}', '{{uuid}}'], c: 'x {{emial}}' })).toEqual([
      { name: 'nmae.first', suggestions: ['name.first'] },
      { name: 'emial', suggestions: ['internet.email'] },
    ]);
    expect(() => generate({ a: '{{name.ful}}' }, opts)).toThrow(/Unknown placeholder \{\{name\.ful\}\}\. Did you mean \{\{name\.full\}\}/);
    expect(suggest('zzzzzz')).toEqual([]);
  });
  it('builds reference groups that cover every generator', () => {
    const names = referenceGroups().flatMap((g) => g.items.map((i) => i.name));
    for (const n of Object.keys(GENERATORS)) expect(names).toContain(n);
  });
});

describe('CSV and helpers', () => {
  it('exports flat arrays as CSV with quoting', () => {
    const rows = [
      { a: 1, b: 'x, y' },
      { a: 2, c: 'say "hi"' },
    ];
    expect(isFlatTable(rows)).toBe(true);
    expect(isFlatTable([{ a: { b: 1 } }])).toBe(false);
    expect(isFlatTable({ a: 1 })).toBe(false);
    expect(toCsv(rows)).toBe('a,b,c\n1,"x, y",\n2,,"say ""hi"""\n');
  });
  it('anchors dates to the start of the UTC day', () => {
    expect(todayBase(Date.UTC(2026, 9, 3, 17, 45))).toBe(NOW);
  });
});
