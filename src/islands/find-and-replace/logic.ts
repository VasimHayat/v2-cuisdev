/**
 * Find and Replace: pure functions, no DOM. A list of rules applied in order. Plain and
 * whole-word modes escape the search text into a regular expression so every mode runs
 * through the same engine; regex mode passes the pattern through and supports $1 and
 * $<name> in the replacement.
 */
import { RegexError, buildRegex } from '../regex-tester/logic';

export type RuleMode = 'plain' | 'regex' | 'word';

export interface Rule {
  id: string;
  find: string;
  replace: string;
  mode: RuleMode;
  caseSensitive: boolean;
  /** Plain and word modes: turn \n, \t and \\ in the replacement into real characters. */
  escapes: boolean;
  /** Regex mode: extra flags such as m or s (g is always on). */
  flags: string;
  enabled: boolean;
}

export interface RuleOutcome {
  id: string;
  count: number;
  error?: string;
}

export interface ApplyResult {
  output: string;
  outcomes: RuleOutcome[];
  total: number;
}

export function newRule(partial: Partial<Rule> = {}): Rule {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2, 10),
    find: '',
    replace: '',
    mode: 'plain',
    caseSensitive: false,
    escapes: true,
    flags: '',
    enabled: true,
    ...partial,
  };
}

/** Escape text for literal use inside a RegExp. */
export function escapeRegExp(text: string): string {
  // Hyphen is deliberately not escaped: "\-" is a syntax error with the u flag outside a class.
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** \n, \t, \r and \\ in a plain replacement become real characters. */
export function unescapeReplacement(text: string): string {
  return text.replace(/\\(n|t|r|\\)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\'));
}

/** Make a plain replacement literal for String.replace, which treats $ specially. */
function literalReplacement(text: string): string {
  return text.replace(/\$/g, '$$$$');
}

/** Build the RegExp for a rule. Throws RegexError for an invalid pattern. */
export function ruleRegex(rule: Rule): RegExp {
  const caseFlag = rule.caseSensitive ? '' : 'i';
  if (rule.mode === 'regex') {
    const extra = rule.flags.replace(/[gi]/g, '');
    return buildRegex(rule.find, `g${caseFlag}${extra}`);
  }
  const body = escapeRegExp(rule.find);
  // Whole word: not preceded or followed by a letter, digit or underscore (Unicode aware).
  const pattern = rule.mode === 'word' ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body;
  return buildRegex(pattern, `g${caseFlag}u`);
}

function replacementFor(rule: Rule): string {
  if (rule.mode === 'regex') return rule.replace;
  const text = rule.escapes ? unescapeReplacement(rule.replace) : rule.replace;
  return literalReplacement(text);
}

/** Count matches of one rule in a text without replacing. Empty matches are not counted. */
export function countMatches(text: string, rule: Rule): number {
  if (!rule.find) return 0;
  const re = ruleRegex(rule);
  let n = 0;
  for (const m of text.matchAll(re)) if (m[0] !== '') n++;
  return n;
}

/** Apply every enabled rule in order. A rule with an invalid pattern is skipped and reported. */
export function applyRules(text: string, rules: readonly Rule[]): ApplyResult {
  let output = text;
  const outcomes: RuleOutcome[] = [];
  let total = 0;
  for (const rule of rules) {
    if (!rule.enabled || rule.find === '') {
      outcomes.push({ id: rule.id, count: 0 });
      continue;
    }
    try {
      const re = ruleRegex(rule);
      const count = countMatches(output, rule);
      output = output.replace(re, replacementFor(rule));
      outcomes.push({ id: rule.id, count });
      total += count;
    } catch (err) {
      outcomes.push({ id: rule.id, count: 0, error: err instanceof RegexError || err instanceof Error ? err.message : String(err) });
    }
  }
  return { output, outcomes, total };
}

export function moveRule(rules: readonly Rule[], from: number, to: number): Rule[] {
  if (to < 0 || to >= rules.length || from === to) return [...rules];
  const next = [...rules];
  const [r] = next.splice(from, 1);
  next.splice(to, 0, r!);
  return next;
}

/** Validate stored rules so a corrupt localStorage value cannot break the page. */
export function sanitizeRules(value: unknown): Rule[] | null {
  if (!Array.isArray(value)) return null;
  const out: Rule[] = [];
  for (const v of value) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Partial<Rule>;
    out.push(
      newRule({
        id: typeof r.id === 'string' ? r.id : undefined,
        find: typeof r.find === 'string' ? r.find : '',
        replace: typeof r.replace === 'string' ? r.replace : '',
        mode: r.mode === 'regex' || r.mode === 'word' ? r.mode : 'plain',
        caseSensitive: r.caseSensitive === true,
        escapes: r.escapes !== false,
        flags: typeof r.flags === 'string' ? r.flags.replace(/[^msuy]/g, '') : '',
        enabled: r.enabled !== false,
      }),
    );
  }
  return out.length ? out : null;
}

export const SAMPLE_TEXT = `Dear Customer,

Thank you for your order #1042 placed on 2026-09-28. Your order will ship on 2026-10-02.
Contact support@oldshop.example for help, or call 555-0100.
The cat sat on the category mat. Cat food is in aisle 4.

Regards,
OldShop Team
`;

export const SAMPLE_RULES: Rule[] = [
  newRule({ id: 's1', find: 'OldShop', replace: 'NewShop', mode: 'plain', caseSensitive: true }),
  newRule({ id: 's2', find: 'oldshop.example', replace: 'newshop.example', mode: 'plain' }),
  newRule({ id: 's3', find: '(?<y>\\d{4})-(?<m>\\d{2})-(?<d>\\d{2})', replace: '$<d>/$<m>/$<y>', mode: 'regex' }),
  newRule({ id: 's4', find: 'cat', replace: 'dog', mode: 'word' }),
];
