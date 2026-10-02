/**
 * Tool registry: the single source of truth for every tool on the site.
 *
 * Adding a tool = one entry here + one MDX file in src/content/tools/<slug>.mdx
 * + (for live tools) one island registered in src/islands/registry.ts.
 * Nav, sitemap, category hubs, schema, related links and OG images all derive from this file.
 */

export type CategorySlug =
  | 'developer'
  | 'text'
  | 'image'
  | 'pdf'
  | 'converters'
  | 'calculators'
  | 'finance';

export interface Category {
  slug: CategorySlug;
  name: string;
  /** Short line under the name on cards and hubs. */
  tagline: string;
  /** SEO title for the hub page (without brand suffix). */
  title: string;
  /** Meta description for the hub page. */
  description: string;
  /** Lucide icon name, see src/components/Icon.astro */
  icon: string;
  /** Hub page FAQ, feeds FAQPage schema. */
  faq: { q: string; a: string }[];
}

export type ToolStatus = 'live' | 'soon';

export interface Tool {
  /** URL slug and primary keyword, lowercase-hyphenated. Never change after publishing. */
  slug: string;
  category: CategorySlug;
  /** Display name, also the H1. */
  name: string;
  /** SEO <title> without brand suffix. 45-55 chars. */
  title: string;
  /** One-line value proposition on cards. */
  tagline: string;
  /** Meta description, 140-155 chars. */
  description: string;
  keywords: string[];
  /** Slugs of related tools for cross-linking. */
  related: string[];
  status: ToolStatus;
  /** Lucide icon name. */
  icon: string;
  /** Island key in src/islands/registry.ts (live tools only). */
  island?: string;
  /** Props passed to the island so one component can serve several pages. */
  islandProps?: Record<string, unknown>;
  /** ISO date first published, used in schema and "Added" badges. */
  since: string;
  /** Mark for the home page "popular" strip. */
  featured?: boolean;
}

export const CATEGORIES: Category[] = [
  {
    slug: 'developer',
    name: 'Developer tools',
    tagline: 'Format, validate, encode and inspect data',
    title: 'Free Online Developer Tools',
    description:
      'Free online developer tools: JSON formatter and validator, Base64 and URL encoders, JWT decoder, regex tester, hash generator and more. All run in your browser.',
    icon: 'code',
    faq: [
      {
        q: 'Are these developer tools really free?',
        a: 'Yes. Every tool on Cuisdev is free with no sign-up, no usage caps and no watermarks.',
      },
      {
        q: 'Is my code or data uploaded to a server?',
        a: 'No. All processing happens in your browser using JavaScript and WebAssembly. Nothing you paste or drop is sent anywhere.',
      },
      {
        q: 'Can I use these tools offline?',
        a: 'Once a tool page has loaded it keeps working without a connection, and the site can be installed as an app for offline use.',
      },
    ],
  },
  {
    slug: 'text',
    name: 'Text tools',
    tagline: 'Count, clean, convert and transform text',
    title: 'Free Online Text Tools',
    description:
      'Free online text tools: word counter, case converter, duplicate line remover, lorem ipsum generator, markdown preview and more. Fast, private, no sign-up.',
    icon: 'type',
    faq: [
      { q: 'Is there a limit on text length?', a: 'No practical limit. The tools run locally so they handle documents of several megabytes without slowing down.' },
      { q: 'Do you store the text I paste?', a: 'Never. Text is processed in your browser and discarded when you close the tab.' },
    ],
  },
  {
    slug: 'image',
    name: 'Image tools',
    tagline: 'Compress, convert, resize and edit images',
    title: 'Free Online Image Tools',
    description:
      'Free online image tools: compress, convert PNG to WebP, resize, crop and edit images in your browser. No upload, no quality loss you did not choose.',
    icon: 'image',
    faq: [
      { q: 'Are my images uploaded?', a: 'No. Images are processed in your browser with WebAssembly codecs. They never leave your device.' },
      { q: 'What formats are supported?', a: 'PNG, JPEG, WebP, AVIF, GIF and SVG for input. Output formats depend on the tool.' },
    ],
  },
  {
    slug: 'pdf',
    name: 'PDF tools',
    tagline: 'Merge, split, compress and convert PDFs',
    title: 'Free Online PDF Tools',
    description:
      'Free online PDF tools that work in your browser: merge, split, compress, reorder pages and convert images to PDF. Files stay on your device.',
    icon: 'file-text',
    faq: [
      { q: 'Is it safe to use these PDF tools with confidential documents?', a: 'Yes. Unlike most online PDF sites, Cuisdev processes files locally in your browser. Nothing is uploaded.' },
      { q: 'Is there a file size limit?', a: 'The limit is your device memory. Files of 100 MB and more work on a typical laptop.' },
    ],
  },
  {
    slug: 'converters',
    name: 'Converters',
    tagline: 'Units, colours, number bases and data formats',
    title: 'Free Online Converters',
    description:
      'Free online converters for units, colours, number bases, timestamps and data formats like JSON, YAML, CSV and XML. Instant results, no sign-up.',
    icon: 'repeat',
    faq: [
      { q: 'How accurate are the unit conversions?', a: 'Conversions use exact SI definitions and are shown to a configurable number of decimal places.' },
    ],
  },
  {
    slug: 'calculators',
    name: 'Calculators',
    tagline: 'Percentages, dates, loans and everyday maths',
    title: 'Free Online Calculators',
    description:
      'Free online calculators for percentages, dates, age, loans and EMI, BMI, tips and more. Clear results with the working shown.',
    icon: 'calculator',
    faq: [
      { q: 'Do the calculators show how the result was reached?', a: 'Yes. Each calculator shows the formula and the intermediate steps so you can check the working.' },
    ],
  },
  {
    slug: 'finance',
    name: 'Finance tools',
    tagline: 'Analyse stocks, returns and compound growth',
    title: 'Free Online Finance Tools',
    description:
      'Free online finance tools: stock analyzer, compound interest and return calculators. Visual, fast and free. Not financial advice.',
    icon: 'trending-up',
    faq: [
      { q: 'Is the stock data real-time?', a: 'Data is delayed and provided for information only. Check your broker before making decisions.' },
    ],
  },
];

export const TOOLS: Tool[] = [
  // ---------------- Wave 1: live now ----------------
  {
    slug: 'json-editor',
    category: 'developer',
    name: 'JSON Editor',
    title: 'JSON Editor Online - Edit, Validate & Format JSON',
    tagline: 'Edit, validate and format JSON with live error highlighting',
    description:
      'Free online JSON editor with syntax highlighting, live validation, formatting and minifying. Fast, private and browser-based. No sign-up, nothing uploaded.',
    keywords: ['json editor', 'json editor online', 'edit json online', 'online json editor free'],
    related: ['json-formatter', 'json-validator', 'json-minifier', 'json-to-csv'],
    status: 'live',
    icon: 'braces',
    island: 'json-editor',
    islandProps: { mode: 'editor' },
    since: '2025-06-01',
    featured: true,
  },
  {
    slug: 'json-formatter',
    category: 'developer',
    name: 'JSON Formatter',
    title: 'JSON Formatter - Beautify & Pretty Print JSON Online',
    tagline: 'Pretty print messy JSON with your preferred indentation',
    description:
      'Free online JSON formatter and beautifier. Paste JSON, choose 2 or 4 space indentation or tabs, copy the result. Runs in your browser, nothing is uploaded.',
    keywords: ['json formatter', 'json beautifier', 'pretty print json', 'format json online'],
    related: ['json-editor', 'json-validator', 'json-minifier', 'code-formatter'],
    status: 'live',
    icon: 'align-left',
    island: 'json-editor',
    islandProps: { mode: 'formatter' },
    since: '2026-10-02',
    featured: true,
  },
  {
    slug: 'json-validator',
    category: 'developer',
    name: 'JSON Validator',
    title: 'JSON Validator - Check & Fix JSON Syntax Online',
    tagline: 'Find the exact line and character of any JSON syntax error',
    description:
      'Free online JSON validator that pinpoints syntax errors by line and column with a plain-English explanation. Instant, private, browser-based. No sign-up.',
    keywords: ['json validator', 'validate json', 'json syntax checker', 'json lint'],
    related: ['json-editor', 'json-formatter', 'json-minifier'],
    status: 'live',
    icon: 'check-circle',
    island: 'json-editor',
    islandProps: { mode: 'validator' },
    since: '2026-10-02',
    featured: true,
  },
  {
    slug: 'json-minifier',
    category: 'developer',
    name: 'JSON Minifier',
    title: 'JSON Minifier - Compress JSON Online',
    tagline: 'Strip whitespace to shrink JSON for production',
    description:
      'Free online JSON minifier. Remove whitespace and newlines to compress JSON for APIs and config files. See the size saved. Browser-based and private.',
    keywords: ['json minifier', 'minify json', 'compress json', 'json compressor'],
    related: ['json-formatter', 'json-editor', 'json-validator'],
    status: 'live',
    icon: 'minimize-2',
    island: 'json-editor',
    islandProps: { mode: 'minifier' },
    since: '2026-10-02',
  },

  // ---------------- Wave 1: promised, coming next ----------------
  {
    slug: 'code-formatter',
    category: 'developer',
    name: 'Code Formatter',
    title: 'Code Formatter - Beautify JavaScript, CSS, HTML & SQL',
    tagline: 'Beautify JavaScript, TypeScript, CSS, HTML and SQL',
    description:
      'Free online code formatter for JavaScript, TypeScript, CSS, HTML and SQL. Consistent indentation and style in one click. Private, browser-based.',
    keywords: ['code formatter', 'code beautifier', 'javascript formatter', 'css formatter', 'html formatter'],
    related: ['json-formatter', 'text-diff-checker'],
    status: 'soon',
    icon: 'code',
    since: '2026-10-20',
  },
  {
    slug: 'text-diff-checker',
    category: 'developer',
    name: 'Text Diff Checker',
    title: 'Text Diff Checker - Compare Two Texts Online',
    tagline: 'Compare two texts and highlight every difference',
    description:
      'Free online diff checker. Paste two texts or code snippets and see additions, deletions and changes highlighted line by line. Private and instant.',
    keywords: ['diff checker', 'text compare', 'compare two texts', 'online diff tool'],
    related: ['code-formatter', 'json-formatter'],
    status: 'soon',
    icon: 'git-compare',
    since: '2026-10-20',
  },
  {
    slug: 'image-editor',
    category: 'image',
    name: 'Image Editor',
    title: 'Online Image Editor - Crop, Resize & Rotate',
    tagline: 'Crop, resize, rotate and export images in your browser',
    description:
      'Free online image editor. Crop, resize, rotate, flip and export to PNG, JPG or WebP without uploading. Fast, private and works on mobile.',
    keywords: ['image editor', 'online image editor', 'crop image online', 'resize image'],
    related: ['image-compressor', 'image-converter'],
    status: 'soon',
    icon: 'image',
    since: '2026-10-27',
  },
  {
    slug: 'pdf-converter',
    category: 'pdf',
    name: 'PDF Converter',
    title: 'PDF Converter - Images to PDF & Merge PDFs Online',
    tagline: 'Turn images into a PDF or merge PDFs, all offline',
    description:
      'Free online PDF converter. Combine images into one PDF or merge several PDFs in your browser. No upload, no watermark, no sign-up.',
    keywords: ['pdf converter', 'image to pdf', 'merge pdf', 'jpg to pdf'],
    related: ['image-editor'],
    status: 'soon',
    icon: 'file-text',
    since: '2026-10-27',
  },
  {
    slug: 'stock-analyzer',
    category: 'finance',
    name: 'Stock Analyzer',
    title: 'Stock Analyzer - Charts, Ratios & Trends',
    tagline: 'Price charts and key ratios for any listed stock',
    description:
      'Free online stock analyzer with price charts, moving averages and key ratios. Visual, quick and free. For information only, not financial advice.',
    keywords: ['stock analyzer', 'stock analysis tool', 'stock chart online'],
    related: [],
    status: 'soon',
    icon: 'trending-up',
    since: '2026-11-03',
  },

  // ---------------- Wave 2: developer core ----------------
  {
    slug: 'json-to-csv',
    category: 'converters',
    name: 'JSON to CSV',
    title: 'JSON to CSV Converter Online',
    tagline: 'Flatten JSON arrays into a clean CSV spreadsheet',
    description:
      'Free JSON to CSV converter. Paste a JSON array, get a CSV with headers you can open in Excel or Google Sheets. Nested objects flattened. Private and instant.',
    keywords: ['json to csv', 'convert json to csv', 'json to excel'],
    related: ['json-editor', 'json-formatter'],
    status: 'soon',
    icon: 'table',
    since: '2026-11-10',
  },
  {
    slug: 'base64-encode-decode',
    category: 'developer',
    name: 'Base64 Encode / Decode',
    title: 'Base64 Encoder & Decoder Online',
    tagline: 'Encode text or files to Base64 and back',
    description:
      'Free online Base64 encoder and decoder for text and files. UTF-8 safe, URL-safe variant supported. Runs in your browser, nothing is uploaded.',
    keywords: ['base64 encode', 'base64 decode', 'base64 converter'],
    related: ['url-encode-decode', 'jwt-decoder'],
    status: 'soon',
    icon: 'binary',
    since: '2026-11-10',
  },
  {
    slug: 'url-encode-decode',
    category: 'developer',
    name: 'URL Encode / Decode',
    title: 'URL Encoder & Decoder Online',
    tagline: 'Percent-encode or decode URLs and query strings',
    description:
      'Free online URL encoder and decoder. Encode special characters for safe URLs or decode percent-encoded strings. Instant and private.',
    keywords: ['url encode', 'url decode', 'percent encoding'],
    related: ['base64-encode-decode'],
    status: 'soon',
    icon: 'link',
    since: '2026-11-10',
  },
  {
    slug: 'jwt-decoder',
    category: 'developer',
    name: 'JWT Decoder',
    title: 'JWT Decoder - Decode JSON Web Tokens Online',
    tagline: 'Inspect JWT header, payload and expiry without a server',
    description:
      'Free online JWT decoder. Paste a token to see the header, payload claims and expiry in readable JSON. Decoded locally, your token never leaves the browser.',
    keywords: ['jwt decoder', 'decode jwt', 'jwt debugger'],
    related: ['base64-encode-decode', 'json-editor'],
    status: 'soon',
    icon: 'key',
    since: '2026-11-17',
  },
  {
    slug: 'regex-tester',
    category: 'developer',
    name: 'Regex Tester',
    title: 'Regex Tester - Test Regular Expressions Online',
    tagline: 'Live-match regular expressions with group highlighting',
    description:
      'Free online regex tester with live highlighting, capture groups, flags and a quick reference. JavaScript flavour. Private and instant.',
    keywords: ['regex tester', 'regular expression tester', 'regex online'],
    related: ['text-diff-checker'],
    status: 'soon',
    icon: 'regex',
    since: '2026-11-17',
  },
  {
    slug: 'uuid-generator',
    category: 'developer',
    name: 'UUID Generator',
    title: 'UUID Generator - Random v4 UUIDs Online',
    tagline: 'Generate one or thousands of v4 UUIDs',
    description:
      'Free online UUID generator. Create random version 4 UUIDs in bulk, uppercase or lowercase, with or without hyphens. Copy or download instantly.',
    keywords: ['uuid generator', 'guid generator', 'random uuid'],
    related: ['hash-generator'],
    status: 'soon',
    icon: 'fingerprint',
    since: '2026-11-17',
  },
  {
    slug: 'hash-generator',
    category: 'developer',
    name: 'Hash Generator',
    title: 'Hash Generator - MD5, SHA-1, SHA-256 Online',
    tagline: 'Hash text or files with MD5, SHA-1, SHA-256 and SHA-512',
    description:
      'Free online hash generator for MD5, SHA-1, SHA-256 and SHA-512. Hash text or files locally in your browser using the Web Crypto API.',
    keywords: ['hash generator', 'sha256 online', 'md5 generator'],
    related: ['uuid-generator', 'base64-encode-decode'],
    status: 'soon',
    icon: 'hash',
    since: '2026-11-24',
  },
  {
    slug: 'timestamp-converter',
    category: 'converters',
    name: 'Timestamp Converter',
    title: 'Unix Timestamp Converter Online',
    tagline: 'Convert Unix timestamps to dates and back, any timezone',
    description:
      'Free online Unix timestamp converter. Convert epoch seconds or milliseconds to human dates in any timezone and back. Live current timestamp.',
    keywords: ['timestamp converter', 'unix timestamp', 'epoch converter'],
    related: ['date-difference-calculator'],
    status: 'soon',
    icon: 'clock',
    since: '2026-11-24',
  },

  // ---------------- Wave 3: text ----------------
  {
    slug: 'word-counter',
    category: 'text',
    name: 'Word Counter',
    title: 'Word Counter - Count Words, Characters & Sentences',
    tagline: 'Words, characters, sentences, reading time and keyword density',
    description:
      'Free online word counter. Count words, characters with and without spaces, sentences and paragraphs, plus reading time and top keywords. Private.',
    keywords: ['word counter', 'character counter', 'count words online'],
    related: ['case-converter', 'remove-duplicate-lines'],
    status: 'soon',
    icon: 'type',
    since: '2026-12-01',
  },
  {
    slug: 'case-converter',
    category: 'text',
    name: 'Case Converter',
    title: 'Case Converter - UPPER, lower, Title & camelCase',
    tagline: 'Switch between upper, lower, title, sentence, camel and snake case',
    description:
      'Free online case converter. Change text to UPPERCASE, lowercase, Title Case, Sentence case, camelCase, snake_case or kebab-case in one click.',
    keywords: ['case converter', 'uppercase to lowercase', 'title case converter'],
    related: ['word-counter', 'slug-generator'],
    status: 'soon',
    icon: 'case-sensitive',
    since: '2026-12-01',
  },
  {
    slug: 'remove-duplicate-lines',
    category: 'text',
    name: 'Remove Duplicate Lines',
    title: 'Remove Duplicate Lines Online',
    tagline: 'Deduplicate, sort and trim lists in seconds',
    description:
      'Free online tool to remove duplicate lines from any text. Options to ignore case, trim whitespace and sort the result. Instant and private.',
    keywords: ['remove duplicate lines', 'deduplicate text', 'unique lines'],
    related: ['word-counter', 'case-converter'],
    status: 'soon',
    icon: 'list-x',
    since: '2026-12-01',
  },
  {
    slug: 'slug-generator',
    category: 'text',
    name: 'Slug Generator',
    title: 'URL Slug Generator Online',
    tagline: 'Turn any title into a clean, SEO-friendly URL slug',
    description:
      'Free online slug generator. Convert titles to lowercase, hyphenated, ASCII-safe URL slugs with transliteration for accented characters.',
    keywords: ['slug generator', 'url slug', 'seo friendly url'],
    related: ['case-converter', 'url-encode-decode'],
    status: 'soon',
    icon: 'link',
    since: '2026-12-08',
  },

  // ---------------- Wave 4: image & pdf ----------------
  {
    slug: 'image-compressor',
    category: 'image',
    name: 'Image Compressor',
    title: 'Image Compressor - Compress PNG, JPG & WebP Online',
    tagline: 'Shrink images up to 80% with a live quality preview',
    description:
      'Free online image compressor for PNG, JPEG and WebP. Adjust quality with a live before-and-after preview. Processed in your browser, never uploaded.',
    keywords: ['image compressor', 'compress image online', 'reduce image size'],
    related: ['image-converter', 'image-editor'],
    status: 'soon',
    icon: 'minimize-2',
    since: '2026-12-15',
  },
  {
    slug: 'image-converter',
    category: 'image',
    name: 'Image Converter',
    title: 'Image Converter - PNG, JPG, WebP & AVIF Online',
    tagline: 'Convert between PNG, JPG, WebP and AVIF in bulk',
    description:
      'Free online image converter. Convert PNG to WebP, JPG to PNG, WebP to JPG, AVIF and more in bulk. Fast, private and browser-based.',
    keywords: ['image converter', 'png to webp', 'jpg to png', 'webp to jpg'],
    related: ['image-compressor', 'image-editor'],
    status: 'soon',
    icon: 'repeat',
    since: '2026-12-15',
  },

  // ---------------- Wave 5: calculators ----------------
  {
    slug: 'percentage-calculator',
    category: 'calculators',
    name: 'Percentage Calculator',
    title: 'Percentage Calculator - Increase, Decrease & Share',
    tagline: 'What is X% of Y, percent change and more, with the working',
    description:
      'Free online percentage calculator. Find X percent of a number, percentage increase or decrease, and what percent one number is of another. Working shown.',
    keywords: ['percentage calculator', 'percent change calculator', 'percentage increase'],
    related: ['loan-emi-calculator'],
    status: 'soon',
    icon: 'percent',
    since: '2027-01-05',
  },
  {
    slug: 'loan-emi-calculator',
    category: 'calculators',
    name: 'Loan & EMI Calculator',
    title: 'Loan EMI Calculator with Amortisation Schedule',
    tagline: 'Monthly payment, total interest and a full schedule',
    description:
      'Free online loan and EMI calculator. Enter amount, rate and tenure to get the monthly payment, total interest and a month-by-month amortisation schedule.',
    keywords: ['emi calculator', 'loan calculator', 'mortgage calculator'],
    related: ['percentage-calculator'],
    status: 'soon',
    icon: 'calculator',
    since: '2027-01-05',
  },
  {
    slug: 'date-difference-calculator',
    category: 'calculators',
    name: 'Date Difference Calculator',
    title: 'Date Difference Calculator - Days Between Dates',
    tagline: 'Days, weeks, months and years between any two dates',
    description:
      'Free online date difference calculator. Find the exact number of days, weeks, months and years between two dates, including or excluding weekends.',
    keywords: ['date difference calculator', 'days between dates', 'date calculator'],
    related: ['timestamp-converter'],
    status: 'soon',
    icon: 'calendar',
    since: '2027-01-12',
  },
];

// ---------------- Helpers ----------------

export const liveTools = (): Tool[] => TOOLS.filter((t) => t.status === 'live');
export const soonTools = (): Tool[] => TOOLS.filter((t) => t.status === 'soon');
export const featuredTools = (): Tool[] => TOOLS.filter((t) => t.featured && t.status === 'live');

export const getTool = (slug: string): Tool | undefined => TOOLS.find((t) => t.slug === slug);
export const getCategory = (slug: string): Category | undefined => CATEGORIES.find((c) => c.slug === slug);

export const toolsInCategory = (slug: CategorySlug): Tool[] => TOOLS.filter((t) => t.category === slug);

export const toolPath = (tool: Pick<Tool, 'slug' | 'category'>): string =>
  `/tools/${tool.category}/${tool.slug}/`;

export const categoryPath = (slug: CategorySlug): string => `/tools/${slug}/`;

/** Related tools, resolving slugs and skipping anything not yet live. Falls back to siblings in the category. */
export function relatedTools(tool: Tool, max = 6): Tool[] {
  const explicit = tool.related.map(getTool).filter((t): t is Tool => !!t && t.status === 'live' && t.slug !== tool.slug);
  if (explicit.length >= max) return explicit.slice(0, max);
  const siblings = toolsInCategory(tool.category).filter(
    (t) => t.status === 'live' && t.slug !== tool.slug && !explicit.includes(t),
  );
  return [...explicit, ...siblings].slice(0, max);
}

/** Categories that have at least one live tool, for nav and the home grid. */
export const activeCategories = (): Category[] =>
  CATEGORIES.filter((c) => toolsInCategory(c.slug).length > 0);
