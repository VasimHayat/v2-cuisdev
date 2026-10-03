# Cuisdev

Free, private, browser-based tools for developers and professionals. Built with Astro 5, Tailwind 4 and Preact islands. Live at [cuisdev.com](https://cuisdev.com).

The full rebuild plan (audit, SEO strategy, tool catalogue, timeline) is in [docs/PLAN.md](docs/PLAN.md).

## Develop

```bash
npm install
cp .env.example .env     # optional: verification tokens or a staging GA4 ID
npm run dev              # http://localhost:4321
npm run build            # generates OG images, then builds to dist/
npm run preview
npm run check            # astro check (types + templates)
npm test                 # vitest: unit tests for the pure tool logic (src/**/*.test.ts)
```

## JSON editor

The JSON Editor island (`src/islands/json-editor/`) wraps the open-source [vanilla-jsoneditor](https://github.com/josdejong/svelte-jsoneditor) engine (ISC licence, the same engine behind jsoneditoronline.org) in a two-panel shell: local documents in the URL hash (`store.ts`), Copy / Transform / Compare between panels (`diff.ts`), file and URL loading, share links and an optional Gemini drawer. The editor chunk is about 320 KB gzipped and is loaded only on the JSON tool pages.

## Code Formatter and Text Diff Checker

Both islands share `src/islands/shared/CodeEditor.tsx` (a CodeMirror 6 wrapper that follows the design tokens) and `src/islands/shared/controls.tsx` (segmented control, chip toggle, header button). The Code Formatter (`src/islands/code-formatter/`) lazy-loads Prettier, terser, csso and sql-formatter on first use; the Text Diff Checker (`src/islands/text-diff/`) renders jsdiff output as side-by-side or inline rows with collapsed unchanged regions. Their logic lives in pure `logic.ts` modules with Vitest tests next to them.

## Image Editor

`src/islands/image-editor/` is non-destructive: `logic.ts` holds the EditState (rotation, flips, crop, resize, adjustments) and pure geometry such as `dragRect` and `rotateState`; `canvas.ts` decodes files (EXIF orientation via `createImageBitmap`), renders the pipeline with progressive downscaling and canvas filters, and encodes PNG, JPG or WebP. The island keeps undo and redo as a stack of states and renders the preview and the export from the original bitmap.

## PDF Converter

`src/islands/pdf-converter/` combines images and PDFs into one PDF with [pdf-lib](https://pdf-lib.js.org/) (MIT), loaded on first use. `logic.ts` holds page geometry (fit-to-image or named sizes with margins and orientation), page-range parsing and naming; `pdf.ts` reads page counts, converts non-embeddable image formats on a canvas (PNG when transparent, JPEG otherwise) and builds the document. JPEG and PNG sources are embedded byte for byte by default.

## Reusing the Code Formatter for single-language pages

The XML Formatter page is the Code Formatter island with `islandProps: { language: 'xml', lockLanguage: true }`. XML support lives in `src/islands/code-formatter/xml.ts` (tokenizer, pretty printer, minifier, well-formedness check with offsets). A SQL Formatter page can be added the same way with `language: 'sql'`. Locked pages do not overwrite the language preference of the general formatter.

## Encoders and decoders

`src/islands/codec/` is one island for the Base64, URL and HTML entity pages, selected with `islandProps: { kind }`. Each codec is a pure module (`base64.ts`, `url.ts`, `entities.ts`) with tests; `Codec.tsx` adds the Encode/Decode shell, file encoding and binary download for Base64, the URL breakdown, and paste detection that switches to Decode when encoded text lands in an empty editor (the editor reports `wasEmpty` to `onPaste`).

## Data converters

`src/islands/converter/` is one island serving several pages: the registry passes `islandProps: { from, to }` (JSON, CSV or YAML) and the user can swap direction in the toolbar. `logic.ts` wraps papaparse and yaml with positioned errors; `src/islands/shared/json-errors.ts` holds the JSON scanner that locates errors when V8's message carries no position (also used by the Code Formatter).

## Add a tool

1. Add an entry to `src/data/tools.ts`. Keep `status: 'soon'` until the island is done.
2. Write `src/content/tools/<slug>.mdx` with `howTo`, `features`, `faq` and an explainer body.
3. Build the island in `src/islands/<slug>/` (Preact), import it in `src/islands/ToolIsland.astro` and add its key to `src/islands/registry.ts`. Keep pure logic in `logic.ts` with a `logic.test.ts` beside it.
4. Flip `status` to `'live'`, set `island` (and `islandProps` if one island serves several pages).
5. `npm run build`. Nav, sitemap, hub pages, related links, schema and the OG image update themselves.

The build throws if a live tool has no MDX file or no registered island.

## Structure

```
src/
  components/   Header, Footer, SEO, ToolCard, FAQ, CommandPalette, ...
  islands/      Interactive tools (Preact), one folder each + registry.ts
  content/      tools/*.mdx (per-tool docs), blog/*.mdx
  data/tools.ts Tool + category registry (single source of truth)
  layouts/      BaseLayout, ToolLayout, ArticleLayout
  lib/          site.ts (constants), seo.ts (JSON-LD builders)
  pages/        Routes; tools/[category]/[slug].astro renders every tool
  styles/       global.css (Tailwind 4 + design tokens)
scripts/og.mjs  Generates OG images and app icons at prebuild
public/         robots.txt, .htaccess (Hostinger redirects + caching), manifest
```

## Deploy

Pushing to `main` runs `.github/workflows/deploy.yml`: type check, build, Lighthouse CI, then FTPS upload of `dist/` to Hostinger `public_html/`.

Required GitHub secrets: `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`. Optional: `PUBLIC_GSC_VERIFICATION`, `PUBLIC_BING_VERIFICATION`. GA4 uses the production ID by default; override with `PUBLIC_GA_MEASUREMENT_ID`.

Legacy URL `/jsoneditor/` is 301-redirected in `public/.htaccess`.
