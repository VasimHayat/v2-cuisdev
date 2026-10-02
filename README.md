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
```

## Add a tool

1. Add an entry to `src/data/tools.ts`. Keep `status: 'soon'` until the island is done.
2. Write `src/content/tools/<slug>.mdx` with `howTo`, `features`, `faq` and an explainer body.
3. Build the island in `src/islands/<slug>/` (Preact) and register it in `src/islands/registry.ts`.
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
