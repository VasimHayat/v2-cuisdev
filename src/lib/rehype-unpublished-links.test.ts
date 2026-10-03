import { describe, expect, it } from 'vitest';
import rehypeUnpublishedLinks from './rehype-unpublished-links.mjs';

type Node = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] };
const text = (value: string): Node => ({ type: 'text', value });
const link = (href: string, label: string): Node => ({ type: 'element', tagName: 'a', properties: { href }, children: [text(label)] });

describe('rehypeUnpublishedLinks', () => {
  it('unwraps links to posts that are scheduled for later and keeps live links', () => {
    const tree: Node = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'p',
          children: [
            text('See '),
            link('/blog/cors-errors-explained/', 'CORS'),
            text(' and '),
            link('/blog/yaml-vs-json-config/', 'YAML vs JSON'),
            text(' and '),
            link('/tools/developer/json-editor/', 'the editor'),
          ],
        },
      ],
    };
    rehypeUnpublishedLinks()(tree);
    const p = tree.children![0]!;
    const kinds = p.children!.map((c) => (c.tagName === 'a' ? `a:${String(c.properties!.href)}` : `t:${c.value}`));
    expect(kinds).toEqual(['t:See ', 'a:/blog/cors-errors-explained/', 't: and ', 't:YAML vs JSON', 't: and ', 'a:/tools/developer/json-editor/']);
  });
});
