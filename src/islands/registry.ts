/**
 * Island keys that ToolIsland.astro knows how to render. The dynamic tool route checks
 * every live tool's `island` against this list at build time so a typo fails the build
 * instead of shipping an empty page.
 */
export const ISLAND_KEYS = ['json-editor', 'code-formatter', 'text-diff', 'image-editor', 'pdf-converter', 'converter', 'codec', 'jwt-decoder'] as const;

export type IslandKey = (typeof ISLAND_KEYS)[number];

export const hasIsland = (key: string | undefined): key is IslandKey =>
  !!key && (ISLAND_KEYS as readonly string[]).includes(key);
