# Cuisdev Rebuild Plan (Astro)

Oct 2, 2026 · @AG Dev

## Executive summary

Cuisdev becomes a static-first Astro site that ships 40 to 60 free browser-based tools in 6 months, each on its own keyword-targeted page, backed by a shared design system and an SEO layer that is generated, not hand-written. Today the site is one static landing page with a single working tool and broken SEO basics, so the first three weeks fix the foundation before any new tool ships.

Three bets drive the plan:

- **Volume of precise pages beats one big page.** Tool traffic is long-tail. Each tool gets a URL, a title, an FAQ and an explainer that answer one search query.
- **Static HTML wins the crawl and the speed test.** Astro renders every tool page to HTML at build time and hydrates only the interactive widget, so Lighthouse stays green and Google indexes full content.
- **Privacy-first processing is the brand.** Every tool runs in the browser. No uploads, no accounts, no waiting. That is the headline on every page.

The plan runs in four phases: Foundation (weeks 1 to 3), Core tools (weeks 3 to 10), Growth engine (weeks 6 onward), and Monetization (month 4 onward).

## Current state audit

The live site is a single static landing page on Hostinger with one working tool and several SEO defects that must be fixed before any marketing. Checked on 2 October 2026 against [cuisdev.com](https://cuisdev.com/), its [sitemap](https://cuisdev.com/sitemap.xml) and [robots.txt](https://cuisdev.com/robots.txt).

| Area | Finding | Severity |
| --- | --- | --- |
| Tools | Only the JSON Editor at `/jsoneditor/` works. Image Editor, Stock Analyzer (dropped from the plan on 2 Oct 2026), PDF Converter, Code Formatter and Diff Checker are "Coming Soon" | High |
| Canonical | JSON Editor canonical points to `https://yourdomain.com/jsoneditor/` (placeholder never replaced). Homepage has no canonical | Critical |
| Structured data | SoftwareApplication schema names the product "ToolHub", not Cuisdev | High |
| Sitemap | One URL. Example entries for app2 and app3 are commented out | High |
| Missing pages | `/about`, `/blog`, `/tools`, `/pricing`, `/privacy`, `/contact` all return 404, yet the nav and footer link to them | Critical |
| Trust signals | Homepage claims 500K+ monthly users, 15+ tools and a 4.9 rating. None are true yet | High |
| Open Graph | No `og:image`, no `og:url`. Shared links render without a preview | Medium |
| Tech | Tailwind loaded from the CDN script at runtime, Google Fonts loaded unoptimised, no build step | Medium |
| Hosting | Hostinger (hcdn). Homepage responds in about 240 ms, 34 KB. Acceptable | Low |
| Robots | Allows all, points to sitemap. Correct | OK |

What is worth keeping: the brand positioning (fast, private, free, in-browser), the Archivo and JetBrains Mono type pairing, and the JSON Editor itself, which is a built bundle using the Ace editor and can be ported as an Astro island.

## Goals and success metrics

The target is 100K organic sessions a month within 12 months, reached by shipping tool pages fast and keeping every one of them technically perfect. Targets below are planning figures based on comparable tool sites, not forecasts.

| Metric | 3 months | 6 months | 12 months |
| --- | --- | --- | --- |
| Live tools | 25 | 50 | 80+ |
| Indexed pages (tools + blog) | 60 | 150 | 350 |
| Organic sessions / month | 5K | 30K | 100K |
| Keywords in top 10 | 50 | 300 | 1,000 |
| Core Web Vitals (all pages) | Green | Green | Green |
| Lighthouse SEO + Performance | 95+ | 95+ | 95+ |
| Returning visitor share | 15% | 25% | 35% |
| Avg. tool session length | 1.5 min | 2 min | 2.5 min |

Two leading indicators to watch weekly from month one: pages indexed in Google Search Console, and impressions per tool page. A tool page with impressions but no clicks needs a better title; one with no impressions needs internal links or a content refresh.

## Tech stack (Astro)

Astro 5 with static output is the core. Every page is HTML at build time, and only the tool widget itself ships JavaScript, which is exactly the shape a tool site needs for SEO and speed.

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Astro 5, static output, View Transitions | Zero JS by default, islands for tools, built-in sitemap and content collections |
| UI islands | Preact (or React where a library needs it) | Small runtime for interactive tools; `client:visible` loads a tool only when scrolled into view |
| Styling | Tailwind CSS 4 compiled at build, design tokens in CSS variables | No runtime CDN script, purged CSS under 15 KB, dark mode via `class` strategy |
| Components | shadcn-style primitives ported to Astro/Preact, Lucide icons | Consistent buttons, inputs, tabs, toasts across 60+ tools |
| Content | Astro Content Collections (MDX) for blog, tool docs and FAQs | Type-safe frontmatter, schema-validated, drives SEO fields automatically |
| Tool registry | One `tools.ts` file: slug, name, category, keywords, description, related | Single source for All Tools page, sitemap, nav, schema, internal links |
| SEO | `@astrojs/sitemap`, custom `<SEO>` component, JSON-LD builders | Every page gets canonical, OG, Twitter, schema from the registry, no manual tags |
| Heavy processing | WASM libs: `@squoosh/lib` or `wasm-vips` (images), `pdf-lib` + `pdfjs-dist` (PDF), Web Workers | Keeps the UI thread free, keeps the "never leaves your browser" promise |
| Code editing | Ace (already used) or CodeMirror 6 | CodeMirror 6 is lighter and tree-shakable; migrate once the first port is stable |
| Search | Pagefind (static search index built at deploy) | Instant tool search with no backend |
| Analytics | Plausible or GA4 + Google Search Console + Bing Webmaster | Privacy-friendly option matches the brand; GSC is non-negotiable |
| Hosting | Hostinger kept as host (decided 2 Oct 2026), with Hostinger CDN, SSL and DNS (no Cloudflare) | Existing account; deploy via GitHub Actions over FTP, redirects and caching in .htaccess |
| Quality gates | Lighthouse CI, Playwright smoke tests per tool, `astro check`, ESLint, Prettier | Fails the build if any page drops below 95 Performance or SEO |
| Repo | Monorepo in `v2-cusidev`, pnpm, GitHub Actions | One deploy pipeline, uploads to Hostinger on merge to main |

Island strategy: the tool widget hydrates with `client:visible` or `client:idle`. The page shell, explainer, FAQ and related-tools list stay as static HTML and cost zero JavaScript.

## Site architecture and URL structure

Flat, category-grouped URLs with no more than two levels, so every tool is one click from the category hub and two from the homepage. Slugs are the primary keyword, lowercase, hyphenated, and never change once published.

```
cuisdev.com/
├── tools/                         All tools index with search and category filters
│   ├── developer/                 Category hub (SEO page, lists tools + intro)
│   │   ├── json-formatter/
│   │   ├── json-validator/
│   │   ├── json-to-csv/
│   │   └── ...
│   ├── text/
│   ├── image/
│   ├── pdf/
│   ├── converters/
│   └── calculators/
├── blog/                          Articles and guides (MDX)
│   └── how-to-validate-json/
├── about/  contact/  privacy/  terms/
├── sitemap-index.xml  robots.txt  rss.xml
└── 404
```

The existing `/jsoneditor/` stays live and 301-redirects to `/tools/developer/json-editor/` so no equity is lost.

Project layout in the repo:

```
src/
├── components/        Shared UI: Header, Footer, ToolShell, SEO, FAQ, RelatedTools
├── islands/           Interactive tools, one folder each (Preact)
├── content/
│   ├── tools/         One MDX per tool: explainer, how-to, FAQ, keywords
│   └── blog/
├── data/tools.ts      Tool registry: slug, category, name, tagline, related[]
├── layouts/           BaseLayout, ToolLayout, ArticleLayout
├── lib/seo/           JSON-LD builders, title/description templates
├── pages/
│   └── tools/[category]/[slug].astro   One dynamic route renders every tool
└── styles/tokens.css  Design tokens (colour, type, spacing, radius)
```

Every tool page is produced by one dynamic route reading the registry plus its MDX entry. Adding a tool means adding one registry entry, one MDX file and one island component. Nav, sitemap, schema, category hub and related-tool links update themselves.

## Design system and UI/UX

The look is clean, dense and confident: a developer-grade product, not a marketing template. One design token file drives every tool so 60 pages feel like one product.

**Visual language**

- Type: Archivo for headings (already in use), Inter for body, JetBrains Mono for code and tool output. Self-hosted, subset, `font-display: swap`.
- Colour: neutral slate palette with one accent (indigo or teal) used only for primary actions and focus states. Semantic tokens for success, warning, error. Full dark mode, system default, with a toggle that persists.
- Spacing on an 8 px grid, radius 8 px, 1 px borders, subtle shadows only on floating elements. No gradients on content surfaces, no decorative blobs.
- Icons from Lucide, one weight, 20 px in UI and 24 px in tool cards.

**Page templates**

| Template | Purpose | Key elements |
| --- | --- | --- |
| Home | Convert a first-time visitor into a tool user in one scroll | Search bar hero, category grid, most-used tools, trust strip (private, free, no sign-up), latest articles |
| Category hub | Rank for "online developer tools" style queries | Intro paragraph, tool cards with one-line value, FAQ |
| Tool page | Rank and convert for one query | Tool above the fold, sticky action bar, then How to use, Features, FAQ, Related tools, explainer |
| Article | Rank for informational queries and feed tools | Table of contents, inline tool embeds, author box, related tools |
| Utility | About, Contact, Privacy, Terms, 404 | Short, indexed, linked from footer |

**Tool shell (shared by every tool)**

- Input on the left, output on the right on desktop; stacked on mobile with a swipe or tab switch.
- Sticky action bar: Copy, Download, Clear, Sample data, Share link, Full-screen. Every action gives a toast.
- Drag-and-drop and paste anywhere on the page for files and text.
- Keyboard shortcuts (Ctrl+Enter to run, Ctrl+Shift+C to copy) with a `?` cheat-sheet.
- Settings persist per tool in `localStorage` (indent size, theme, last mode).
- Empty state shows a one-line instruction and a Load sample button, never a blank box.
- Errors are inline, specific and point at the line or byte, not a red banner.

**UX rules**

- Tool is usable within 1 second of load with no cookie wall, sign-up or modal.
- No ads above the fold on tool pages. One ad slot below the tool, one in the sidebar on desktop only.
- Every page passes WCAG 2.2 AA: contrast, focus rings, labels, reduced-motion respected.
- Command palette (Ctrl+K) to jump between tools from any page.
- Recently used and Favourite tools shown on the home page and in the header dropdown.

## SEO strategy

SEO is generated from the tool registry and enforced by the build, so a page cannot ship with a missing canonical or a duplicate title. The four pillars below are ordered by how early they matter.

**1. Technical foundation (week 1 to 2)**

- Static HTML for every page. No client-side routing for content.
- One canonical per page, absolute URL, generated from the route. The current `yourdomain.com` canonical disappears with the rebuild.
- Sitemap index split by type (tools, blog, pages) with `lastmod` from git commit dates. Submitted to Google and Bing.
- `robots.txt` allows all, blocks `/api/` and preview paths.
- Clean 404 with search and popular tools. 301 map for every old URL, including `/jsoneditor/`.
- HTTPS via Hostinger SSL, HSTS and compression set in .htaccess. `www` redirects to apex.
- Core Web Vitals green on mobile for every template (targets in the Performance section).
- `hreflang` scaffolding ready for later localisation, English only at launch.

**2. On-page template (every tool page)**

| Element | Rule |
| --- | --- |
| Title | \`{Tool name} - {Primary benefit} |
| Meta description | 140 to 155 characters, states what it does, that it is free and in-browser, with a call to action |
| H1 | Exactly one, matches the primary keyword, not the brand |
| Above the fold | The working tool, one sentence of what it does, the privacy promise |
| Body | How to use (numbered), Features (bullets), 300 to 600 words of genuine explainer, FAQ with 4 to 8 questions |
| Internal links | 4 to 6 related tools, category hub, 1 to 2 blog posts. Anchor text is the target page's keyword |
| Media | OG image per tool, auto-generated at build with the tool name on brand background, 1200x630 |
| URL | `/tools/{category}/{keyword-slug}/`, never changes |

**3. Structured data (JSON-LD, generated)**

- `WebSite` with `SearchAction` on the home page (enables the sitelinks search box).
- `SoftwareApplication` on every tool page with correct name, `applicationCategory`, `offers` price 0, `operatingSystem` Web.
- `FAQPage` on tool pages and category hubs from the MDX FAQ block.
- `BreadcrumbList` on every page below the home.
- `Article` with author and dates on blog posts. `Organization` in the footer with logo and social profiles.
- Validated in CI with the Schema.org validator before deploy.

**4. Keyword and internal-link strategy**

- One primary keyword per tool page, 2 to 4 secondary variants woven into the H2s and FAQ. No two pages target the same primary keyword.
- Split high-volume intents into separate pages: JSON formatter, JSON validator, JSON minifier and JSON viewer are four URLs, cross-linked, not one.
- Category hubs act as topical authority pages linking down to every tool in the group.
- Blog posts link up to tools with exact-match anchors. Tools link sideways to siblings and down to posts.
- A monthly audit from Search Console: pages with impressions but CTR under 2% get new titles; pages with no impressions after 60 days get a content refresh or more internal links.

**Trust and E-E-A-T**

- Real About page with the team, a Contact page that works, a Privacy policy that explains local-only processing, and Terms.
- Remove all unverifiable stats. Replace with facts that are true today: number of tools live, open-source status, zero data stored.
- Author bylines on articles, last-updated dates on tool explainers, changelog page listing shipped tools.

## Tool catalogue and launch order

Ship the six tools already promised on the homepage first, then expand cluster by cluster. Each wave is chosen so that every new tool has siblings to link to on day one.

| Wave | Weeks | Category | Tools |
| --- | --- | --- | --- |
| 1 Promised | 3 to 5 | Developer, Image, PDF | JSON Editor (port), JSON Formatter, JSON Validator, Code Formatter (JS, CSS, HTML, SQL), Text Diff Checker, Image Editor (crop, resize, rotate), PDF Converter (image to PDF, merge) |
| 2 Developer core | 5 to 7 | Developer | JSON Minifier, JSON to CSV, JSON to YAML, YAML to JSON, XML Formatter, Base64 Encode/Decode, URL Encode/Decode, JWT Decoder, Regex Tester, UUID Generator, Hash Generator (MD5, SHA-1, SHA-256), HTML Entity Encoder, Timestamp Converter, Cron Parser |
| 3 Text | 7 to 8 | Text | Word Counter, Case Converter, Lorem Ipsum, Markdown Preview, Slug Generator, Remove Duplicate Lines, Sort Lines, Text to Binary, Find and Replace |
| 4 Image and PDF | 8 to 11 | Image, PDF | Image Compressor, Image Converter (PNG, JPG, WebP, AVIF), Image Resizer, Favicon Generator, Color Picker from Image, PDF Split, PDF Compress, PDF to Image, PDF Page Reorder |
| 5 Converters and calculators | 11 to 14 | Converters, Calculators | Unit Converter (length, weight, temperature), Percentage Calculator, Loan and EMI Calculator, Age Calculator, Date Difference, BMI Calculator, Tip Calculator, Color Converter (HEX, RGB, HSL), Number Base Converter |
| 6 Advanced | 14+ | Developer, Calculators | SQL Formatter, GraphQL Formatter, Mock JSON Generator, API Request Tester, Password Generator, QR Code Generator, Compound Interest Calculator |

Selection rules for anything beyond this list:

- Search demand exists (checked in Search Console, Google Trends or a keyword tool) and the intent is "do this now", not "learn about this".
- It can run fully in the browser. Anything needing a server is a Pro feature, not a free tool.
- It can be built in under 3 days using the shared tool shell. Bigger tools are split into smaller ones.
- It has at least 3 natural sibling tools to link to.

Each tool ships with its registry entry, MDX explainer, FAQ, OG image, Playwright smoke test and a Lighthouse pass. A tool is not "done" until all six exist.

## Content and growth engine

Tools bring the transactional traffic; content brings the informational traffic and the backlinks that lift every tool page. Content starts in week 6, once there are tools worth linking to.

**Blog and guides**

- Two posts a week, 800 to 1,500 words, each answering one query a tool user has: "How to validate JSON", "PNG vs WebP for websites", "Why does my JSON have a trailing comma error".
- Every post embeds the relevant tool as a live island, not a screenshot. The post is the explanation, the tool is the proof.
- Formats that work in this niche: error-message explainers, format comparisons, cheat sheets, "X vs Y" pages, and "best free tools for Z" round-ups that include competitors honestly.
- Each post has a real author, a last-updated date and a short changelog when refreshed.

**Programmatic pages (month 3 onward)**

- Conversion pairs: "PNG to WebP", "JSON to YAML", "inches to cm". One template, hundreds of URLs, each with a unique intro, a worked example and the live tool preset to that pair.
- Only generate pairs with measurable demand. Thin pages hurt the whole domain, so each needs at least 150 words of genuinely specific text.
- Error-code pages for common developer errors that a tool fixes, with the tool preloaded.

**Distribution and backlinks**

- Launch each wave on Product Hunt, Hacker News (Show HN), and the relevant subreddits. One well-timed launch per wave, not per tool.
- List on AlternativeTo, SaaSHub, free-tool directories and GitHub awesome lists. Open-source the tool code on GitHub to earn developer links.
- Republish condensed versions of posts on dev.to and Hashnode with canonical back to Cuisdev.
- Embeddable widgets: a small JSON validator or colour converter other sites can embed, with a credit link.
- Reach out to tutorial authors who link to competitors with broken or ad-heavy tools.

**Retention**

- Progressive Web App install prompt after the second visit, so repeat users bypass search entirely.
- Recent tools, favourites and saved presets stored locally. No account required.
- Optional email digest, one a month, listing new tools. Collected on the blog only, never gated on tool pages.
- Shareable result links where the payload is small enough to encode in the URL (colour values, calculator inputs, regex patterns).

## Performance and Core Web Vitals

Every template must hit the targets below on a throttled mobile profile in Lighthouse CI, and the build fails if it does not. Speed is a ranking factor and, for a tool site, the product itself.

| Metric | Target | How |
| --- | --- | --- |
| Largest Contentful Paint | under 1.8 s | Static HTML, critical CSS inlined, hero has no images, fonts preloaded |
| Interaction to Next Paint | under 150 ms | Heavy work in Web Workers and WASM, never on the main thread |
| Cumulative Layout Shift | under 0.05 | Fixed-height tool container, reserved ad slots, font metrics matched with fallback |
| Time to First Byte | under 200 ms globally | Hostinger CDN cache, immutable asset hashes, long cache headers in .htaccess |
| JavaScript per tool page | under 80 KB gzipped (JSON editor pages: about 325 KB, the vanilla-jsoneditor engine) | Preact islands, CodeMirror 6 tree-shaken, lazy-load WASM on first use |
| CSS per page | under 15 KB | Tailwind purged at build, tokens in one stylesheet |
| Lighthouse Performance, SEO, Accessibility, Best Practices | 95 or higher each | Enforced in CI on home, hub, tool and article templates |

Additional rules:

- Fonts self-hosted, subset to Latin, two weights each, `font-display: swap` with size-adjusted fallbacks.
- Images served as AVIF with WebP fallback through Astro's image component, lazy-loaded below the fold.
- Third-party scripts limited to analytics and, later, one ad provider, both loaded after the page is interactive.
- Service worker caches the shell and tool bundles so a returning user loads any tool offline.
- Real-user monitoring through the Web Vitals library sent to analytics, reviewed monthly alongside Search Console's Core Web Vitals report.

## Phased timeline

Four overlapping phases over 24 weeks. The relaunch at week 3 is the only hard gate: nothing new is promoted until the foundation is live and clean.

&#91;embedded content: rebuild roadmap · 4 phases, 3 gates\]

Phases overlap on purpose. Content starts at week 6 so the first posts have tools to link to, and monetization waits until week 16 so ad review sees a mature site.

| Phase | Weeks | Deliverables | Exit gate |
| --- | --- | --- | --- |
| 1 Foundation | 1 to 3 | Astro project, design tokens, tool shell, SEO component, registry, JSON Editor ported, About/Contact/Privacy/Terms, blog shell, 301 map, analytics, Search Console, Lighthouse CI | Site relaunched, Lighthouse 95+, zero broken links, sitemap submitted |
| 2 Core tools | 3 to 14 | Waves 1 to 5 from the catalogue (about 50 tools), category hubs, OG image generator, Pagefind search, command palette, PWA | 50 tools live, each with explainer, FAQ, test and schema |
| 3 Growth engine | 6 onward | Two posts a week, programmatic conversion pages, Product Hunt and Show HN launches per wave, directory listings, open-source repo, monthly SEO audit loop | 30K organic sessions a month by month 6 |
| 4 Monetization | 16 onward | Ad slots below the fold, Pro tier (API, larger files, no ads), Stripe checkout, usage limits | First revenue; ads never above the tool |

Weekly cadence from week 3: Monday plan, ship tools Tuesday to Thursday, Friday is SEO review and content. Every pull request gets a preview URL and a Lighthouse report before merge.

## Monetization

The free tools stay free forever, because they are the SEO engine. Revenue comes from a light ad layer and a Pro tier for power users, introduced only after traffic exists.

| Stream | When | Model | Rules |
| --- | --- | --- | --- |
| Display ads | Month 4, after 10K sessions a month | Google AdSense first, move to Ezoic or Mediavine at their thresholds | One slot below the tool, one sidebar slot on desktop. Never above the fold, never inside the tool, never on article intros |
| Pro tier | Month 5 | Monthly or yearly subscription via Stripe | No ads, larger file limits, batch processing, saved presets synced, priority support |
| API access | Month 6 | Metered API for the formatters and converters | Free key with low limits for developers, paid tiers above. Drives backlinks from docs and GitHub |
| Affiliate | Opportunistic | Hosting, domain and developer-tool referrals inside relevant articles only | Disclosed, relevant, never in tool pages |

Pricing is decided at month 4 with real usage data. Until then, the Pricing nav item is removed rather than pointing at a page that does not exist.

## Immediate next steps

The first week is about fixing what hurts today and getting a deployable Astro skeleton in the repo, which is currently empty.

- [ ] Approve the stack and the URL structure in this document
- [ ] Scaffold the Astro 5 project in `v2-cusidev` with Tailwind 4, Preact, sitemap, MDX and the tool registry
- [ ] Build the design tokens, BaseLayout, Header, Footer and the shared ToolShell
- [ ] Write the SEO component and JSON-LD builders; wire them to the registry
- [ ] Port the JSON Editor as the first island and set up the 301 from `/jsoneditor/`
- [ ] Create About, Contact, Privacy, Terms, 404 and the blog shell
- [ ] Remove the unverifiable stats and the Pricing link from the homepage copy
- [ ] Set up GitHub Actions deploy to Hostinger, Lighthouse CI and Playwright
- [ ] Register Google Search Console and Bing Webmaster, submit the new sitemap
- [ ] Relaunch at the end of week 3, then start wave 1 of the tool catalogue

Decided 2 Oct 2026: Hostinger for hosting, GA4 for analytics. Still open: whether to open-source the tool code from day one.


## Progress log

| Date | Done | Next |
| --- | --- | --- |
| 2 Oct 2026 | Astro 5 foundation, SEO layer, 20 pages, GA4 wired (G-TZH65SMVNE), Hostinger deploy workflow, 55-tool registry, JSON Editor rebuilt as a two-panel workspace on vanilla-jsoneditor (text/tree/table, copy/transform/compare, local documents in the URL). 6 local commits on main, nothing pushed. | Add FTP secrets and push for the first deploy; then wave 1: Code Formatter and Text Diff Checker (logic exists in G:\HW_RESOURCES\Github\cusidev to port). |
| 3 Oct 2026 | Wave 1 started: Code Formatter (JS, TS, HTML, CSS, SCSS, JSON, SQL; beautify via Prettier and sql-formatter, minify via terser, csso and hand-written HTML/JSON/SQL passes; language auto-detect; errors underlined) and Text Diff Checker (side-by-side and inline, line/word/char granularity, ignore case and whitespace, collapsed unchanged regions, change navigation, unified diff export) are live. Shared CodeMirror editor and toolbar controls. Vitest added with 29 logic tests. Verified headless in Chrome. | Push for the first deploy once FTP secrets exist; then Image Editor and PDF Converter to finish wave 1, and SQL Formatter can reuse the formatter island with `language: 'sql'`. |
| 3 Oct 2026 (later) | Image Editor live: interactive crop box with handles and aspect presets, rotate and flip with the crop following, resize by pixels, percent or preset, brightness/contrast/saturation/hue/grayscale/sepia/blur with hold-to-compare, undo/redo/reset, PNG/JPG/WebP export with live size estimate, paste and drop. 16 geometry tests. Verified headless in Chrome including a real download. | PDF Converter closes wave 1. Then wave 2 (developer core). |
| 3 Oct 2026 (evening) | PDF Converter live, which completes wave 1: images and PDFs in any mix into one PDF, drag reorder, per-image rotation, per-PDF page ranges, fit-to-image or A4/Letter/Legal/A3/A5 pages with margins and orientation, original JPG/PNG bytes kept, title and author, pdf-lib lazy-loaded. 12 tests (57 total). Verified headless in Chrome; downloaded PDF checked with pdf-lib. | Wave 2 (developer core): Base64, URL encoder, JWT decoder, regex tester, hash generator, UUID, timestamp, etc. Much of the logic exists in the old prototype. |
| 3 Oct 2026 (wave 2 start) | One converter island serves JSON to CSV, JSON to YAML and YAML to JSON (3 pages live): swap direction, delimiter auto-detect, header and typing options, dot-notation flattening, multi-document YAML, positioned errors underlined in the editor. Shared JSON error scanner added for V8 messages without a position. 13 tests (70 total). Verified headless in Chrome. | Next wave 2 tools: XML Formatter, Base64, URL encoder, JWT decoder, regex tester, UUID, hash generator, HTML entities, timestamp, cron. |
| 3 Oct 2026 (XML) | XML Formatter live by extending the Code Formatter with an XML language (own tokenizer: pretty print with mixed content kept inline, minify, well-formedness errors with line and column), locked to XML via islandProps. Auto-detect now separates XML from HTML. 11 tests (81 total). Verified headless in Chrome. | Next: Base64, URL encoder and HTML entity encoder as one codec island; then JWT decoder, regex tester, UUID, hash generator, timestamp, cron. |
| 3 Oct 2026 (codecs) | One codec island serves Base64, URL encode/decode and HTML entities (3 pages live): URL-safe, wrapped and data URL Base64, file encoding and binary download with image preview; component, whole-URL and form percent-encoding with repeated decoding and a URL breakdown; essential, non-ASCII, decimal and hex entity escaping with legacy and Windows-1252 decoding. Paste detection switches to Decode. 12 tests (93 total). Verified headless in Chrome. 15 tool pages live. | Next: JWT decoder, regex tester, UUID generator, hash generator, timestamp converter, cron parser. |
