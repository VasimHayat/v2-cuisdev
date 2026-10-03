/**
 * Rehype plugin: turn links to blog posts that are not published yet into plain text.
 *
 * Posts are written ahead and go live on their publishDate (see src/lib/blog.ts). A post
 * that goes live in October may link to one scheduled for March; until March that link
 * would be a 404. This plugin unwraps such links at build time, keeping their text, so
 * the link appears automatically on the first build after the target is published.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BLOG_DIR = fileURLToPath(new URL('../content/blog/', import.meta.url));

/** Slugs of posts that are drafts or dated in the future, as of this build. */
function unpublishedSlugs(now = Date.now()) {
  const out = new Set();
  for (const file of readdirSync(BLOG_DIR)) {
    if (!file.endsWith('.mdx') && !file.endsWith('.md')) continue;
    const src = readFileSync(BLOG_DIR + file, 'utf8');
    const fm = /^---\n([\s\S]*?)\n---/.exec(src)?.[1] ?? '';
    const date = /^publishDate:\s*["']?([0-9T:.\-Z+]+)/m.exec(fm)?.[1];
    const draft = /^draft:\s*true\s*$/m.test(fm);
    const time = date ? Date.parse(date) : NaN;
    if (draft || !Number.isFinite(time) || time > now) out.add(file.replace(/\.mdx?$/, ''));
  }
  return out;
}

export default function rehypeUnpublishedLinks() {
  return (tree) => {
    const hidden = unpublishedSlugs();
    if (hidden.size === 0) return;
    const walk = (node) => {
      if (!node.children) return;
      const next = [];
      for (const child of node.children) {
        const href = child.type === 'element' && child.tagName === 'a' ? String(child.properties?.href ?? '') : '';
        const m = /^\/blog\/([a-z0-9-]+)\/?(#.*)?$/.exec(href);
        if (m && hidden.has(m[1])) {
          // Keep the link text, drop the link.
          for (const grandchild of child.children ?? []) {
            walk(grandchild);
            next.push(grandchild);
          }
          continue;
        }
        walk(child);
        next.push(child);
      }
      node.children = next;
    };
    walk(tree);
  };
}
