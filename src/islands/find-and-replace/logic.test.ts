import { describe, expect, it } from 'vitest';
import { SAMPLE_RULES, SAMPLE_TEXT, applyRules, countMatches, escapeRegExp, moveRule, newRule, sanitizeRules, unescapeReplacement } from './logic';

describe('helpers', () => {
  it('escapes regex syntax so plain text matches literally', () => {
    expect(new RegExp(escapeRegExp('a.b*c(1)[x]$'), 'u').test('a.b*c(1)[x]$')).toBe(true);
    expect(new RegExp(escapeRegExp('2026-10-03'), 'u').test('2026-10-03')).toBe(true);
  });
  it('unescapes \\n, \\t and \\\\', () => {
    expect(unescapeReplacement('a\\nb\\tc\\\\d')).toBe('a\nb\tc\\d');
  });
});

describe('plain mode', () => {
  it('replaces case-insensitively by default and counts', () => {
    const r = applyRules('Cat cat CAT', [newRule({ id: 'a', find: 'cat', replace: 'dog' })]);
    expect(r.output).toBe('dog dog dog');
    expect(r.outcomes[0]).toEqual({ id: 'a', count: 3 });
  });
  it('respects case sensitivity and treats $ and special characters literally', () => {
    expect(applyRules('Cat cat', [newRule({ find: 'cat', replace: 'dog', caseSensitive: true })]).output).toBe('Cat dog');
    expect(applyRules('price: 5', [newRule({ find: '5', replace: '$10' })]).output).toBe('price: $10');
    expect(applyRules('a.b a-b', [newRule({ find: '.', replace: '!' })]).output).toBe('a!b a-b');
  });
  it('turns escapes in the replacement into real characters when enabled', () => {
    expect(applyRules('a,b,c', [newRule({ find: ',', replace: '\\n' })]).output).toBe('a\nb\nc');
    expect(applyRules('a,b', [newRule({ find: ',', replace: '\\n', escapes: false })]).output).toBe('a\\nb');
  });
});

describe('whole word mode', () => {
  it('matches only whole words, including accented ones', () => {
    expect(applyRules('cat category bobcat cat.', [newRule({ find: 'cat', replace: 'dog', mode: 'word' })]).output).toBe('dog category bobcat dog.');
    expect(applyRules('café cafés', [newRule({ find: 'café', replace: 'X', mode: 'word' })]).output).toBe('X cafés');
  });
});

describe('regex mode', () => {
  it('supports numbered and named groups', () => {
    expect(applyRules('2026-10-03', [newRule({ find: '(\\d+)-(\\d+)-(\\d+)', replace: '$3/$2/$1', mode: 'regex' })]).output).toBe('03/10/2026');
    expect(applyRules('2026-10-03', [newRule({ find: '(?<y>\\d{4})-(?<m>\\d\\d)-(?<d>\\d\\d)', replace: '$<d>.$<m>.$<y>', mode: 'regex' })]).output).toBe('03.10.2026');
  });
  it('honours extra flags like multiline', () => {
    expect(applyRules('a\nb', [newRule({ find: '^', replace: '> ', mode: 'regex', flags: 'm' })]).output).toBe('> a\n> b');
  });
  it('reports an invalid pattern and keeps going', () => {
    const r = applyRules('abc', [newRule({ id: 'bad', find: '(', mode: 'regex' }), newRule({ id: 'ok', find: 'b', replace: 'B' })]);
    expect(r.output).toBe('aBc');
    expect(r.outcomes[0]?.error).toBeTruthy();
    expect(r.outcomes[1]?.count).toBe(1);
  });
  it('does not count empty matches', () => {
    expect(countMatches('abc', newRule({ find: 'x*', mode: 'regex' }))).toBe(0);
  });
});

describe('rules', () => {
  it('applies rules in order and skips disabled or empty ones', () => {
    const r = applyRules('a', [newRule({ find: 'a', replace: 'b' }), newRule({ find: 'b', replace: 'c' }), newRule({ find: 'c', replace: 'd', enabled: false }), newRule({ find: '' })]);
    expect(r.output).toBe('c');
    expect(r.total).toBe(2);
  });
  it('moves rules and sanitises stored values', () => {
    const rules = [newRule({ id: '1' }), newRule({ id: '2' }), newRule({ id: '3' })];
    expect(moveRule(rules, 0, 2).map((r) => r.id)).toEqual(['2', '3', '1']);
    expect(moveRule(rules, 0, 5).map((r) => r.id)).toEqual(['1', '2', '3']);
    expect(sanitizeRules('nope')).toBeNull();
    expect(sanitizeRules([{ find: 'x', mode: 'evil', flags: 'gimz' }])?.[0]).toMatchObject({ find: 'x', mode: 'plain', flags: 'm' });
  });
  it('runs the sample end to end', () => {
    const r = applyRules(SAMPLE_TEXT, SAMPLE_RULES);
    expect(r.output).toContain('NewShop Team');
    expect(r.output).toContain('support@newshop.example');
    expect(r.output).toContain('28/09/2026');
    expect(r.output).toContain('The dog sat on the category mat. dog food');
    expect(r.outcomes.map((o) => o.count)).toEqual([1, 1, 2, 2]);
  });
});
