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

## JWT Decoder

`src/islands/jwt-decoder/logic.ts` decodes compact JWS tokens with specific errors per part, describes registered and common OpenID claims, resolves NumericDate claims, and verifies or signs HS256/HS384/HS512 with WebCrypto. The island keeps the token in sessionStorage only. The sample token is signed with the classic `your-256-bit-secret`.

## Data converters

`src/islands/converter/` is one island serving several pages: the registry passes `islandProps: { from, to }` (JSON, CSV or YAML) and the user can swap direction in the toolbar. `logic.ts` wraps papaparse and yaml with positioned errors; `src/islands/shared/json-errors.ts` holds the JSON scanner that locates errors when V8's message carries no position (also used by the Code Formatter).

## Developer utilities (wave 2)

Five more islands, one folder each with `logic.ts` and tests: `regex-tester/` (matching runs in a Web Worker with a timeout so catastrophic backtracking cannot freeze the page), `uuid-generator/` (v4, v7, v1, v5, v3 plus an inspector), `hash-generator/` (hash-wasm, loaded lazily, streams files, HMAC and compare), `timestamp-converter/` (units auto-detected, every format, zone-aware parsing, batch mode) and `cron-parser/` (cronstrue descriptions, croner next runs per time zone).

## Text tools (wave 3)

`word-counter/` (Intl.Segmenter counting, keyword density, length targets), `case-converter/` (14 cases with acronym-aware word splitting), `slug-generator/` (transliteration, stop words, replacements), `lorem-ipsum-generator/` (seeded, four vocabularies, text/HTML/Markdown), `markdown-preview/` (marked + DOMPurify, synced scroll, formatting buttons, HTML export), `line-tools/` (one island for Remove Duplicate Lines and Sort Lines via `islandProps.kind`, a trim, dedupe, sort, number pipeline), `find-and-replace/` (ordered rules, plain, whole word or regex) and `text-to-binary/` (binary, octal, decimal, hex or code points in UTF-8, UTF-16, Latin-1 or ASCII).

## Image and PDF tools (wave 4)

`image-batch/` serves Image Compressor, Converter and Resizer (`islandProps.kind`) with one decode, resize and encode pipeline, target-size quality search, a before/after compare and zip downloads. `favicon-generator/` writes the ICO container itself and zips every size with the manifest and HTML. `color-picker-from-image/` has a zoomable canvas, loupe, contrast checks and a k-means palette. `pdf-pages/` serves PDF Split and PDF Page Reorder (`kind`) on a page grid with drag and drop, rotation and undo. `pdf-to-image/` renders pages at a chosen DPI, and `pdf-compress/` offers a lossless re-save or a rasterising mode that clearly warns text stops being selectable.

Shared helpers: `src/islands/shared/pdfjs.ts` loads pdf.js and its worker lazily (`loadPdf`, `renderPage`, `renderThumbnail`), and `src/islands/shared/zip.ts` builds zips with fflate. The pdf.js worker ships as `.mjs`, so `public/.htaccess` maps that extension to `text/javascript`.

## Converters and calculators (wave 5)

`unit-converter/` (14 categories with exact constants, mixed expressions like `5 ft 11 in`), `percentage-calculator/`, `tip-calculator/` and `bmi-calculator/` (sharing `calc-kit/`), `loan-emi-calculator/` (amortisation with prepayments, SVG charts, CSV), `date-calculator/` (Age and Date Difference via `islandProps.kind`, all arithmetic on UTC midnights), `color-converter/` (CSS Color 4 parsing and OKLab/OKLCH maths in pure TypeScript) and `number-base-converter/` (BigInt, two's complement, bit grid).

## Advanced tools (wave 6)

SQL Formatter and GraphQL Formatter are the Code Formatter island with the language locked (`islandProps: { language, lockLanguage: true }`); GraphQL uses Prettier's GraphQL plugin plus `minifyGraphql`. `mock-json-generator/` (template placeholders, 38 seeded generators, CSV export), `api-request-tester/` (fetch from the browser, cURL import and export, honest CORS explanation, auth kept in memory and stripped from history), `password-generator/` (rejection sampling over `crypto.getRandomValues`, own 2,370-word passphrase list, nothing generated is stored), `qr-code-generator/` (qrcode for the matrix, own SVG renderer with styles and a logo, PNG at three sizes) and `compound-interest-calculator/` (on calc-kit).

## Tool inputs never reach analytics

Tools must not write their inputs into the address bar while someone edits: GA4's enhanced measurement turns history changes into page views that carry the full URL, and it treats `q`, `s`, `search`, `query` and `keyword` parameters as site searches. Keep state in localStorage and build share links on demand (see `calc-kit/kit.tsx` and `shareQuery` in the converters). `Analytics.astro` also reports a cleaned `page_location` (path plus campaign parameters only), so a visit through a shared link stays clean. Avoid those five parameter names in share links.

## Islands render client-only

`ToolIsland.astro` mounts every island with `client:only="preact"` and a skeleton sized like the tool. Islands read browser state on their first render (saved options, drafts, the user's zone), and Preact's hydration does not correct attributes that differ from the server HTML, so server rendering showed stale options. When adding an island, add its height classes to `SIZES` in `ToolIsland.astro` (use `island:kind` keys when the height depends on `islandProps.kind`, and phone then desktop heights for content-sized tools), and give any pane holding a CodeEditor a bounded height, otherwise the editor grows with its content. Give side-by-side grids a base `grid-cols-[minmax(0,1fr)]` so long unwrapped lines cannot widen the page on phones.

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
