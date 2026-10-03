/**
 * Island keys that ToolIsland.astro knows how to render. The dynamic tool route checks
 * every live tool's `island` against this list at build time so a typo fails the build
 * instead of shipping an empty page.
 */
export const ISLAND_KEYS = ['json-editor', 'code-formatter', 'text-diff', 'image-editor', 'pdf-converter', 'converter', 'codec', 'jwt-decoder', 'regex-tester', 'uuid-generator', 'hash-generator', 'timestamp-converter', 'cron-parser', 'word-counter', 'case-converter', 'slug-generator', 'lorem-ipsum-generator', 'markdown-preview', 'line-tools', 'find-and-replace', 'text-to-binary', 'image-batch', 'favicon-generator', 'color-picker-from-image', 'pdf-pages', 'pdf-to-image', 'pdf-compress'] as const;

export type IslandKey = (typeof ISLAND_KEYS)[number];

export const hasIsland = (key: string | undefined): key is IslandKey =>
  !!key && (ISLAND_KEYS as readonly string[]).includes(key);
