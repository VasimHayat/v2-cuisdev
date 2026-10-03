/**
 * Tool registry: the single source of truth for every tool on the site.
 *
 * The catalogue and wave order follow docs/PLAN.md ("Tool catalogue and launch order").
 * Adding a tool = one entry here + one MDX file in src/content/tools/<slug>.mdx
 * + (for live tools) one island in src/islands/ToolIsland.astro and registry.ts.
 * Nav, sitemap, category hubs, schema, related links and OG images all derive from this file.
 */

export type CategorySlug = 'developer' | 'text' | 'image' | 'pdf' | 'converters' | 'calculators';

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

/** Launch wave from docs/PLAN.md. 1 = promised on the old homepage, 6 = advanced. */
export type Wave = 1 | 2 | 3 | 4 | 5 | 6;

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
  wave: Wave;
  /** Lucide icon name. */
  icon: string;
  /** Island key in src/islands/registry.ts (live tools only). */
  island?: string;
  /** Props passed to the island so one component can serve several pages. */
  islandProps?: Record<string, unknown>;
  /** ISO date published (live) or target date (soon). Used in schema and the changelog. */
  since: string;
  /** Mark for the home page "popular" strip. */
  featured?: boolean;
}

export const WAVES: Record<Wave, { name: string; weeks: string }> = {
  1: { name: 'Promised tools', weeks: 'weeks 3 to 5' },
  2: { name: 'Developer core', weeks: 'weeks 5 to 7' },
  3: { name: 'Text tools', weeks: 'weeks 7 to 8' },
  4: { name: 'Image and PDF', weeks: 'weeks 8 to 11' },
  5: { name: 'Converters and calculators', weeks: 'weeks 11 to 14' },
  6: { name: 'Advanced', weeks: 'week 14 onward' },
};

export const CATEGORIES: Category[] = [
  {
    slug: 'developer',
    name: 'Developer tools',
    tagline: 'Format, validate, encode and inspect data',
    title: 'Free Online Developer Tools',
    description:
      'Free online developer tools: JSON formatter and validator, code formatter, diff checker, Base64 and URL encoders, JWT decoder, regex tester, hash generator and more. All run in your browser.',
    icon: 'code',
    faq: [
      { q: 'Are these developer tools really free?', a: 'Yes. Every tool on Cuisdev is free with no sign-up, no usage caps and no watermarks.' },
      { q: 'Is my code or data uploaded to a server?', a: 'No. All processing happens in your browser using JavaScript and WebAssembly. Nothing you paste or drop is sent anywhere.' },
      { q: 'Can I use these tools offline?', a: 'Once a tool page has loaded it keeps working without a connection, and the site can be installed as an app for offline use.' },
    ],
  },
  {
    slug: 'text',
    name: 'Text tools',
    tagline: 'Count, clean, convert and transform text',
    title: 'Free Online Text Tools',
    description:
      'Free online text tools: word counter, case converter, duplicate line remover, sort lines, lorem ipsum generator, markdown preview, find and replace. Fast, private, no sign-up.',
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
      'Free online image tools: compress, convert PNG to WebP or AVIF, resize, crop, pick colours and generate favicons in your browser. No upload, no sign-up.',
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
      'Free online PDF tools that work in your browser: merge, split, compress, reorder pages, convert images to PDF and PDF to images. Files stay on your device.',
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
      { q: 'Do the data format converters change my values?', a: 'No. Converting between JSON, YAML, CSV and XML preserves every value. Only the representation changes.' },
    ],
  },
  {
    slug: 'calculators',
    name: 'Calculators',
    tagline: 'Percentages, dates, loans and everyday maths',
    title: 'Free Online Calculators',
    description:
      'Free online calculators for percentages, dates, age, loans and EMI, compound interest, BMI, tips and more. Clear results with the working shown. Not financial advice.',
    icon: 'calculator',
    faq: [
      { q: 'Do the calculators show how the result was reached?', a: 'Yes. Each calculator shows the formula and the intermediate steps so you can check the working.' },
      { q: 'Are the loan and interest calculators financial advice?', a: 'No. They are for information only. Check the figures with your lender or adviser before making a decision.' },
    ],
  },
];

export const TOOLS: Tool[] = [
  // =============== Wave 1: live now ===============
  {
    slug: 'json-editor',
    category: 'developer',
    name: 'JSON Editor',
    title: 'JSON Editor Online - Edit, Format, Compare & Query JSON',
    tagline: 'Two panels with text, tree and table modes, compare, transform and repair',
    description:
      'Free online JSON editor with two panels: text, tree and table modes, format, sort, query and transform, compare documents, repair broken JSON. Private, in your browser.',
    keywords: ['json editor', 'json editor online', 'json viewer', 'json tree view', 'edit json online', 'online json editor free'],
    related: ['json-formatter', 'json-validator', 'json-minifier', 'json-to-csv'],
    status: 'live',
    wave: 1,
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
    wave: 1,
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
    wave: 1,
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
    wave: 2,
    icon: 'minimize-2',
    island: 'json-editor',
    islandProps: { mode: 'minifier' },
    since: '2026-10-02',
  },

  // =============== Wave 1: promised, coming next (weeks 3 to 5) ===============
  {
    slug: 'code-formatter',
    category: 'developer',
    name: 'Code Formatter',
    title: 'Code Formatter - Beautify JavaScript, CSS, HTML & SQL',
    tagline: 'Beautify JavaScript, TypeScript, CSS, HTML and SQL',
    description:
      'Free online code formatter for JavaScript, TypeScript, CSS, HTML and SQL. Consistent indentation and style in one click. Private, browser-based.',
    keywords: ['code formatter', 'code beautifier', 'javascript formatter', 'css formatter', 'html formatter', 'code minifier', 'prettier online'],
    related: ['json-formatter', 'text-diff-checker', 'sql-formatter'],
    status: 'live',
    wave: 1,
    icon: 'code',
    island: 'code-formatter',
    since: '2026-10-03',
    featured: true,
  },
  {
    slug: 'text-diff-checker',
    category: 'developer',
    name: 'Text Diff Checker',
    title: 'Text Diff Checker - Compare Two Texts Online',
    tagline: 'Compare two texts and highlight every difference',
    description:
      'Free online diff checker. Paste two texts or code snippets and see additions, deletions and changes highlighted line by line. Private and instant.',
    keywords: ['diff checker', 'text compare', 'compare two texts', 'online diff tool', 'side by side diff', 'unified diff'],
    related: ['code-formatter', 'json-formatter', 'find-and-replace'],
    status: 'live',
    wave: 1,
    icon: 'git-compare',
    island: 'text-diff',
    since: '2026-10-03',
    featured: true,
  },
  {
    slug: 'image-editor',
    category: 'image',
    name: 'Image Editor',
    title: 'Online Image Editor - Crop, Resize & Rotate',
    tagline: 'Crop, resize, rotate and export images in your browser',
    description:
      'Free online image editor. Crop, resize, rotate, flip and export to PNG, JPG or WebP without uploading. Fast, private and works on mobile.',
    keywords: ['image editor', 'online image editor', 'crop image online', 'rotate image', 'resize image', 'flip image', 'photo editor online'],
    related: ['image-resizer', 'image-compressor', 'image-converter'],
    status: 'live',
    wave: 1,
    icon: 'crop',
    island: 'image-editor',
    since: '2026-10-03',
    featured: true,
  },
  {
    slug: 'pdf-converter',
    category: 'pdf',
    name: 'PDF Converter',
    title: 'PDF Converter - Images to PDF & Merge PDFs Online',
    tagline: 'Turn images into a PDF or merge PDFs, all offline',
    description:
      'Free online PDF converter. Combine images into one PDF or merge several PDFs in your browser. No upload, no watermark, no sign-up.',
    keywords: ['pdf converter', 'image to pdf', 'merge pdf', 'jpg to pdf', 'png to pdf', 'combine pdf files'],
    related: ['pdf-split', 'pdf-compress', 'pdf-to-image'],
    status: 'live',
    wave: 1,
    icon: 'file-text',
    island: 'pdf-converter',
    since: '2026-10-03',
    featured: true,
  },

  // =============== Wave 2: developer core (weeks 5 to 7) ===============
  {
    slug: 'json-to-csv',
    category: 'converters',
    name: 'JSON to CSV',
    title: 'JSON to CSV Converter Online',
    tagline: 'Flatten JSON arrays into a clean CSV spreadsheet',
    description:
      'Free JSON to CSV converter. Paste a JSON array, get a CSV with headers you can open in Excel or Google Sheets. Nested objects flattened. Private and instant.',
    keywords: ['json to csv', 'convert json to csv', 'json to excel'],
    related: ['json-editor', 'json-to-yaml', 'json-formatter'],
    status: 'live',
    wave: 2,
    icon: 'table',
    island: 'converter',
    islandProps: { from: 'json', to: 'csv' },
    since: '2026-10-03',
  },
  {
    slug: 'json-to-yaml',
    category: 'converters',
    name: 'JSON to YAML',
    title: 'JSON to YAML Converter Online',
    tagline: 'Convert JSON to clean, readable YAML',
    description:
      'Free online JSON to YAML converter. Paste JSON and get valid YAML with your preferred indentation, ready for Kubernetes, CI and config files. Private.',
    keywords: ['json to yaml', 'convert json to yaml', 'json yaml converter'],
    related: ['yaml-to-json', 'json-formatter', 'json-to-csv'],
    status: 'live',
    wave: 2,
    icon: 'repeat',
    island: 'converter',
    islandProps: { from: 'json', to: 'yaml' },
    since: '2026-10-03',
  },
  {
    slug: 'yaml-to-json',
    category: 'converters',
    name: 'YAML to JSON',
    title: 'YAML to JSON Converter Online',
    tagline: 'Turn YAML into JSON and catch indentation mistakes',
    description:
      'Free online YAML to JSON converter with error reporting for bad indentation and tabs. Paste YAML, copy JSON. Runs in your browser, nothing uploaded.',
    keywords: ['yaml to json', 'convert yaml to json', 'yaml json converter'],
    related: ['json-to-yaml', 'json-validator', 'json-formatter'],
    status: 'live',
    wave: 2,
    icon: 'repeat',
    island: 'converter',
    islandProps: { from: 'yaml', to: 'json' },
    since: '2026-10-03',
  },
  {
    slug: 'xml-formatter',
    category: 'developer',
    name: 'XML Formatter',
    title: 'XML Formatter - Beautify & Validate XML Online',
    tagline: 'Pretty print and validate XML, SVG and XHTML',
    description:
      'Free online XML formatter and validator. Indent messy XML, SVG or XHTML, find unclosed tags, minify for production. Private and browser-based.',
    keywords: ['xml formatter', 'xml beautifier', 'xml validator', 'format xml online'],
    related: ['json-formatter', 'code-formatter', 'html-entity-encoder'],
    status: 'live',
    wave: 2,
    icon: 'file-code',
    island: 'code-formatter',
    islandProps: { language: 'xml', lockLanguage: true },
    since: '2026-10-03',
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
    related: ['url-encode-decode', 'jwt-decoder', 'html-entity-encoder'],
    status: 'live',
    wave: 2,
    icon: 'binary',
    island: 'codec',
    islandProps: { kind: 'base64' },
    since: '2026-10-03',
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
    related: ['base64-encode-decode', 'html-entity-encoder', 'slug-generator'],
    status: 'live',
    wave: 2,
    icon: 'link',
    island: 'codec',
    islandProps: { kind: 'url' },
    since: '2026-10-03',
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
    related: ['base64-encode-decode', 'json-editor', 'timestamp-converter'],
    status: 'soon',
    wave: 2,
    icon: 'key',
    since: '2026-11-13',
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
    related: ['find-and-replace', 'text-diff-checker'],
    status: 'soon',
    wave: 2,
    icon: 'regex',
    since: '2026-11-20',
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
    related: ['hash-generator', 'password-generator'],
    status: 'soon',
    wave: 2,
    icon: 'fingerprint',
    since: '2026-11-20',
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
    wave: 2,
    icon: 'hash',
    since: '2026-11-20',
  },
  {
    slug: 'html-entity-encoder',
    category: 'developer',
    name: 'HTML Entity Encoder',
    title: 'HTML Entity Encoder & Decoder Online',
    tagline: 'Escape and unescape HTML entities safely',
    description:
      'Free online HTML entity encoder and decoder. Escape <, >, & and quotes for safe markup, or decode named and numeric entities back to text. Private.',
    keywords: ['html entity encoder', 'html escape', 'html decode', 'unescape html'],
    related: ['url-encode-decode', 'base64-encode-decode', 'xml-formatter'],
    status: 'live',
    wave: 2,
    icon: 'code',
    island: 'codec',
    islandProps: { kind: 'entities' },
    since: '2026-10-03',
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
    related: ['date-difference-calculator', 'cron-parser', 'jwt-decoder'],
    status: 'soon',
    wave: 2,
    icon: 'clock',
    since: '2026-11-20',
  },
  {
    slug: 'cron-parser',
    category: 'developer',
    name: 'Cron Expression Parser',
    title: 'Cron Parser - Explain & Test Cron Expressions',
    tagline: 'Translate cron schedules into plain English and next run times',
    description:
      'Free online cron expression parser. Paste a cron schedule to read it in plain English and see the next 10 run times in your timezone. Private and instant.',
    keywords: ['cron parser', 'cron expression', 'crontab generator', 'cron schedule'],
    related: ['timestamp-converter', 'date-difference-calculator'],
    status: 'soon',
    wave: 2,
    icon: 'timer',
    since: '2026-11-20',
  },

  // =============== Wave 3: text (weeks 7 to 8) ===============
  {
    slug: 'word-counter',
    category: 'text',
    name: 'Word Counter',
    title: 'Word Counter - Count Words, Characters & Sentences',
    tagline: 'Words, characters, sentences, reading time and keyword density',
    description:
      'Free online word counter. Count words, characters with and without spaces, sentences and paragraphs, plus reading time and top keywords. Private.',
    keywords: ['word counter', 'character counter', 'count words online'],
    related: ['case-converter', 'remove-duplicate-lines', 'lorem-ipsum-generator'],
    status: 'soon',
    wave: 3,
    icon: 'type',
    since: '2026-11-20',
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
    related: ['word-counter', 'slug-generator', 'find-and-replace'],
    status: 'soon',
    wave: 3,
    icon: 'case-sensitive',
    since: '2026-11-20',
  },
  {
    slug: 'lorem-ipsum-generator',
    category: 'text',
    name: 'Lorem Ipsum Generator',
    title: 'Lorem Ipsum Generator - Placeholder Text Online',
    tagline: 'Paragraphs, sentences or words of placeholder text',
    description:
      'Free online lorem ipsum generator. Choose paragraphs, sentences or words, with or without the classic opening line, and copy placeholder text instantly.',
    keywords: ['lorem ipsum generator', 'placeholder text', 'dummy text generator'],
    related: ['word-counter', 'markdown-preview'],
    status: 'soon',
    wave: 3,
    icon: 'align-left',
    since: '2026-11-27',
  },
  {
    slug: 'markdown-preview',
    category: 'text',
    name: 'Markdown Preview',
    title: 'Markdown Preview - Live Markdown Editor Online',
    tagline: 'Write Markdown on the left, see rendered HTML on the right',
    description:
      'Free online Markdown editor with live preview, GitHub-flavoured syntax, tables and code blocks. Export HTML or copy the rendered output. Private.',
    keywords: ['markdown preview', 'markdown editor online', 'markdown to html'],
    related: ['lorem-ipsum-generator', 'html-entity-encoder', 'word-counter'],
    status: 'soon',
    wave: 3,
    icon: 'book-open',
    since: '2026-11-27',
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
    wave: 3,
    icon: 'link',
    since: '2026-11-27',
  },
  {
    slug: 'remove-duplicate-lines',
    category: 'text',
    name: 'Remove Duplicate Lines',
    title: 'Remove Duplicate Lines Online',
    tagline: 'Deduplicate, trim and clean lists in seconds',
    description:
      'Free online tool to remove duplicate lines from any text. Options to ignore case, trim whitespace and keep the first or last occurrence. Instant and private.',
    keywords: ['remove duplicate lines', 'deduplicate text', 'unique lines'],
    related: ['sort-lines', 'word-counter', 'find-and-replace'],
    status: 'soon',
    wave: 3,
    icon: 'list-x',
    since: '2026-11-27',
  },
  {
    slug: 'sort-lines',
    category: 'text',
    name: 'Sort Lines',
    title: 'Sort Lines Alphabetically or Numerically Online',
    tagline: 'Sort lines A to Z, Z to A, by number or by length',
    description:
      'Free online line sorter. Sort text alphabetically, numerically, by length or randomly, ascending or descending, case-sensitive or not. Private and instant.',
    keywords: ['sort lines', 'sort text alphabetically', 'alphabetize list'],
    related: ['remove-duplicate-lines', 'case-converter'],
    status: 'soon',
    wave: 3,
    icon: 'arrow-up-down',
    since: '2026-11-27',
  },
  {
    slug: 'text-to-binary',
    category: 'converters',
    name: 'Text to Binary',
    title: 'Text to Binary Converter Online',
    tagline: 'Convert text to binary, hex or octal and back',
    description:
      'Free online text to binary converter. Encode text as binary, hexadecimal or octal bytes and decode them back. UTF-8 aware. Private and instant.',
    keywords: ['text to binary', 'binary to text', 'binary converter'],
    related: ['number-base-converter', 'base64-encode-decode'],
    status: 'soon',
    wave: 3,
    icon: 'binary',
    since: '2026-11-27',
  },
  {
    slug: 'find-and-replace',
    category: 'text',
    name: 'Find and Replace',
    title: 'Find and Replace Text Online',
    tagline: 'Bulk find and replace with plain text or regex',
    description:
      'Free online find and replace tool. Replace words or patterns across large texts with case options and regular expressions, with a live match count. Private.',
    keywords: ['find and replace online', 'replace text online', 'bulk find replace'],
    related: ['regex-tester', 'remove-duplicate-lines', 'text-diff-checker'],
    status: 'soon',
    wave: 3,
    icon: 'search',
    since: '2026-11-27',
  },

  // =============== Wave 4: image and PDF (weeks 8 to 11) ===============
  {
    slug: 'image-compressor',
    category: 'image',
    name: 'Image Compressor',
    title: 'Image Compressor - Compress PNG, JPG & WebP Online',
    tagline: 'Shrink images up to 80% with a live quality preview',
    description:
      'Free online image compressor for PNG, JPEG and WebP. Adjust quality with a live before-and-after preview. Processed in your browser, never uploaded.',
    keywords: ['image compressor', 'compress image online', 'reduce image size'],
    related: ['image-converter', 'image-resizer', 'image-editor'],
    status: 'soon',
    wave: 4,
    icon: 'minimize-2',
    since: '2026-12-04',
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
    related: ['image-compressor', 'image-resizer', 'favicon-generator'],
    status: 'soon',
    wave: 4,
    icon: 'repeat',
    since: '2026-12-04',
  },
  {
    slug: 'image-resizer',
    category: 'image',
    name: 'Image Resizer',
    title: 'Image Resizer - Resize Images Online by Pixels or Percent',
    tagline: 'Resize by pixels, percentage or preset social sizes',
    description:
      'Free online image resizer. Resize by exact pixels, percentage or presets for social media, keeping aspect ratio and quality. Batch supported. Private.',
    keywords: ['image resizer', 'resize image online', 'resize photo'],
    related: ['image-editor', 'image-compressor', 'image-converter'],
    status: 'soon',
    wave: 4,
    icon: 'ruler',
    since: '2026-12-04',
  },
  {
    slug: 'favicon-generator',
    category: 'image',
    name: 'Favicon Generator',
    title: 'Favicon Generator - ICO, PNG & Apple Touch Icons',
    tagline: 'Every favicon size and the HTML to go with it from one image',
    description:
      'Free online favicon generator. Upload a logo and download ICO, PNG and Apple touch icons in every size, plus the manifest and HTML tags. Private.',
    keywords: ['favicon generator', 'ico generator', 'apple touch icon'],
    related: ['image-converter', 'image-resizer'],
    status: 'soon',
    wave: 4,
    icon: 'star',
    since: '2026-12-11',
  },
  {
    slug: 'color-picker-from-image',
    category: 'image',
    name: 'Color Picker from Image',
    title: 'Color Picker from Image - Get HEX & RGB Online',
    tagline: 'Click any pixel to get its HEX, RGB and HSL values',
    description:
      'Free online colour picker from image. Upload a picture, click any pixel and copy its HEX, RGB and HSL. Extract a palette of dominant colours. Private.',
    keywords: ['color picker from image', 'get color from image', 'image color extractor'],
    related: ['color-converter', 'image-editor'],
    status: 'soon',
    wave: 4,
    icon: 'pipette',
    since: '2026-12-11',
  },
  {
    slug: 'pdf-split',
    category: 'pdf',
    name: 'PDF Split',
    title: 'Split PDF Online - Extract Pages Free',
    tagline: 'Extract pages or split a PDF into separate files',
    description:
      'Free online PDF splitter. Extract a page range, split every page into its own file or split at intervals. Runs in your browser, nothing is uploaded.',
    keywords: ['split pdf', 'extract pdf pages', 'pdf splitter'],
    related: ['pdf-converter', 'pdf-page-reorder', 'pdf-compress'],
    status: 'soon',
    wave: 4,
    icon: 'scissors',
    since: '2026-12-11',
  },
  {
    slug: 'pdf-compress',
    category: 'pdf',
    name: 'PDF Compress',
    title: 'Compress PDF Online - Reduce PDF Size Free',
    tagline: 'Reduce PDF file size by recompressing images',
    description:
      'Free online PDF compressor. Reduce PDF size by recompressing embedded images with a quality slider. Processed locally, never uploaded. No watermark.',
    keywords: ['compress pdf', 'reduce pdf size', 'pdf compressor'],
    related: ['pdf-converter', 'pdf-split', 'image-compressor'],
    status: 'soon',
    wave: 4,
    icon: 'minimize-2',
    since: '2026-12-18',
  },
  {
    slug: 'pdf-to-image',
    category: 'pdf',
    name: 'PDF to Image',
    title: 'PDF to Image Converter - PDF to PNG or JPG Online',
    tagline: 'Render PDF pages to PNG or JPG at any resolution',
    description:
      'Free online PDF to image converter. Turn PDF pages into PNG or JPG at the resolution you choose, download one page or all as a ZIP. Private.',
    keywords: ['pdf to image', 'pdf to png', 'pdf to jpg'],
    related: ['pdf-converter', 'image-converter', 'pdf-split'],
    status: 'soon',
    wave: 4,
    icon: 'image',
    since: '2026-12-18',
  },
  {
    slug: 'pdf-page-reorder',
    category: 'pdf',
    name: 'PDF Page Reorder',
    title: 'Reorder, Rotate & Delete PDF Pages Online',
    tagline: 'Drag pages to reorder, rotate or delete them',
    description:
      'Free online PDF page organiser. Drag thumbnails to reorder, rotate or delete pages and save a new PDF. Runs entirely in your browser.',
    keywords: ['reorder pdf pages', 'rearrange pdf', 'rotate pdf pages', 'delete pdf pages'],
    related: ['pdf-split', 'pdf-converter'],
    status: 'soon',
    wave: 4,
    icon: 'layers',
    since: '2026-12-18',
  },

  // =============== Wave 5: converters and calculators (weeks 11 to 14) ===============
  {
    slug: 'unit-converter',
    category: 'converters',
    name: 'Unit Converter',
    title: 'Unit Converter - Length, Weight, Temperature & More',
    tagline: 'Length, weight, temperature, area, volume and speed',
    description:
      'Free online unit converter for length, weight, temperature, area, volume, speed and data sizes. Exact SI definitions, instant results, no sign-up.',
    keywords: ['unit converter', 'metric converter', 'convert units'],
    related: ['number-base-converter', 'percentage-calculator'],
    status: 'soon',
    wave: 5,
    icon: 'ruler',
    since: '2026-12-18',
  },
  {
    slug: 'percentage-calculator',
    category: 'calculators',
    name: 'Percentage Calculator',
    title: 'Percentage Calculator - Increase, Decrease & Share',
    tagline: 'What is X% of Y, percent change and more, with the working',
    description:
      'Free online percentage calculator. Find X percent of a number, percentage increase or decrease, and what percent one number is of another. Working shown.',
    keywords: ['percentage calculator', 'percent change calculator', 'percentage increase'],
    related: ['tip-calculator', 'loan-emi-calculator'],
    status: 'soon',
    wave: 5,
    icon: 'percent',
    since: '2026-12-25',
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
    related: ['compound-interest-calculator', 'percentage-calculator'],
    status: 'soon',
    wave: 5,
    icon: 'calculator',
    since: '2026-12-25',
  },
  {
    slug: 'age-calculator',
    category: 'calculators',
    name: 'Age Calculator',
    title: 'Age Calculator - Exact Age in Years, Months & Days',
    tagline: 'Exact age today or on any date, down to the day',
    description:
      'Free online age calculator. Enter a birth date to get exact age in years, months and days, total days lived and the next birthday countdown.',
    keywords: ['age calculator', 'calculate age', 'how old am i'],
    related: ['date-difference-calculator', 'timestamp-converter'],
    status: 'soon',
    wave: 5,
    icon: 'calendar',
    since: '2026-12-25',
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
    related: ['age-calculator', 'timestamp-converter'],
    status: 'soon',
    wave: 5,
    icon: 'calendar',
    since: '2027-01-01',
  },
  {
    slug: 'bmi-calculator',
    category: 'calculators',
    name: 'BMI Calculator',
    title: 'BMI Calculator - Body Mass Index in Metric or Imperial',
    tagline: 'Body mass index with category and healthy weight range',
    description:
      'Free online BMI calculator in metric or imperial units. Get your body mass index, the WHO category and the healthy weight range for your height.',
    keywords: ['bmi calculator', 'body mass index', 'calculate bmi'],
    related: ['unit-converter', 'age-calculator'],
    status: 'soon',
    wave: 5,
    icon: 'heart',
    since: '2027-01-01',
  },
  {
    slug: 'tip-calculator',
    category: 'calculators',
    name: 'Tip Calculator',
    title: 'Tip Calculator - Split the Bill Online',
    tagline: 'Tip amount, total and per-person share in one tap',
    description:
      'Free online tip calculator. Choose a tip percentage, split the bill between any number of people and see each share, with rounding options.',
    keywords: ['tip calculator', 'split bill calculator', 'gratuity calculator'],
    related: ['percentage-calculator'],
    status: 'soon',
    wave: 5,
    icon: 'coins',
    since: '2027-01-01',
  },
  {
    slug: 'color-converter',
    category: 'converters',
    name: 'Color Converter',
    title: 'Color Converter - HEX, RGB, HSL & OKLCH Online',
    tagline: 'Convert colours between HEX, RGB, HSL and OKLCH',
    description:
      'Free online colour converter. Paste HEX, RGB, HSL or OKLCH and get every other format, a live swatch and a contrast check. Private and instant.',
    keywords: ['color converter', 'hex to rgb', 'rgb to hex', 'hsl to hex'],
    related: ['color-picker-from-image', 'number-base-converter'],
    status: 'soon',
    wave: 5,
    icon: 'palette',
    since: '2027-01-08',
  },
  {
    slug: 'number-base-converter',
    category: 'converters',
    name: 'Number Base Converter',
    title: 'Number Base Converter - Binary, Octal, Decimal & Hex',
    tagline: 'Convert between binary, octal, decimal and hexadecimal',
    description:
      'Free online number base converter. Convert between binary, octal, decimal, hexadecimal and any base from 2 to 36, with big-number support.',
    keywords: ['number base converter', 'binary to decimal', 'hex to decimal', 'decimal to binary'],
    related: ['text-to-binary', 'unit-converter', 'color-converter'],
    status: 'soon',
    wave: 5,
    icon: 'hash',
    since: '2027-01-08',
  },

  // =============== Wave 6: advanced (week 14 onward) ===============
  {
    slug: 'sql-formatter',
    category: 'developer',
    name: 'SQL Formatter',
    title: 'SQL Formatter - Beautify SQL Queries Online',
    tagline: 'Format SQL for MySQL, PostgreSQL, SQLite and SQL Server',
    description:
      'Free online SQL formatter. Beautify queries for MySQL, PostgreSQL, SQLite, SQL Server and BigQuery with keyword casing and indentation options. Private.',
    keywords: ['sql formatter', 'format sql online', 'sql beautifier'],
    related: ['code-formatter', 'graphql-formatter', 'json-formatter'],
    status: 'soon',
    wave: 6,
    icon: 'table',
    since: '2027-01-15',
  },
  {
    slug: 'graphql-formatter',
    category: 'developer',
    name: 'GraphQL Formatter',
    title: 'GraphQL Formatter - Prettify Queries & Schemas Online',
    tagline: 'Format and validate GraphQL queries and schemas',
    description:
      'Free online GraphQL formatter. Prettify queries, mutations and schema definitions, catch syntax errors and minify for production. Private and instant.',
    keywords: ['graphql formatter', 'format graphql', 'graphql prettifier'],
    related: ['sql-formatter', 'code-formatter', 'json-formatter'],
    status: 'soon',
    wave: 6,
    icon: 'braces',
    since: '2027-01-15',
  },
  {
    slug: 'mock-json-generator',
    category: 'developer',
    name: 'Mock JSON Generator',
    title: 'Mock JSON Generator - Fake Test Data Online',
    tagline: 'Generate realistic fake JSON from a simple schema',
    description:
      'Free online mock JSON generator. Describe fields such as name, email, date or number and generate hundreds of realistic records for tests and demos.',
    keywords: ['mock json generator', 'fake json data', 'test data generator'],
    related: ['json-editor', 'uuid-generator', 'json-to-csv'],
    status: 'soon',
    wave: 6,
    icon: 'sparkles',
    since: '2027-01-22',
  },
  {
    slug: 'api-request-tester',
    category: 'developer',
    name: 'API Request Tester',
    title: 'API Request Tester - Send HTTP Requests Online',
    tagline: 'Send GET, POST and other requests and inspect the response',
    description:
      'Free online API request tester. Send GET, POST, PUT and DELETE requests with headers and a body, then inspect status, headers and formatted JSON. Private.',
    keywords: ['api tester', 'http request tester', 'rest client online', 'test api online'],
    related: ['json-editor', 'jwt-decoder', 'url-encode-decode'],
    status: 'soon',
    wave: 6,
    icon: 'send',
    since: '2027-01-22',
  },
  {
    slug: 'password-generator',
    category: 'developer',
    name: 'Password Generator',
    title: 'Password Generator - Strong Random Passwords Online',
    tagline: 'Strong random passwords and passphrases, generated locally',
    description:
      'Free online password generator. Create strong random passwords or memorable passphrases with length and character options. Generated locally, never sent.',
    keywords: ['password generator', 'random password', 'strong password generator'],
    related: ['uuid-generator', 'hash-generator'],
    status: 'soon',
    wave: 6,
    icon: 'lock',
    since: '2027-01-29',
  },
  {
    slug: 'qr-code-generator',
    category: 'converters',
    name: 'QR Code Generator',
    title: 'QR Code Generator - Free, No Sign-Up, SVG & PNG',
    tagline: 'QR codes for URLs, Wi-Fi, contacts and text as SVG or PNG',
    description:
      'Free online QR code generator. Create QR codes for URLs, Wi-Fi, vCards and text, pick colours and error correction, download SVG or PNG. No sign-up.',
    keywords: ['qr code generator', 'free qr code', 'qr code maker'],
    related: ['url-encode-decode', 'favicon-generator'],
    status: 'soon',
    wave: 6,
    icon: 'qr-code',
    since: '2027-01-29',
  },
  {
    slug: 'compound-interest-calculator',
    category: 'calculators',
    name: 'Compound Interest Calculator',
    title: 'Compound Interest Calculator with Yearly Breakdown',
    tagline: 'Growth over time with contributions and a yearly chart',
    description:
      'Free online compound interest calculator. Enter principal, rate, time and regular contributions to see the final amount, total interest and a year-by-year chart.',
    keywords: ['compound interest calculator', 'investment calculator', 'savings calculator'],
    related: ['loan-emi-calculator', 'percentage-calculator'],
    status: 'soon',
    wave: 6,
    icon: 'trending-up',
    since: '2027-02-05',
  },
];

// ---------------- Helpers ----------------

export const liveTools = (): Tool[] => TOOLS.filter((t) => t.status === 'live');
export const soonTools = (): Tool[] => TOOLS.filter((t) => t.status === 'soon');
export const featuredTools = (): Tool[] => TOOLS.filter((t) => t.featured && t.status === 'live');

export const getTool = (slug: string): Tool | undefined => TOOLS.find((t) => t.slug === slug);
export const getCategory = (slug: string): Category | undefined => CATEGORIES.find((c) => c.slug === slug);

export const toolsInCategory = (slug: CategorySlug): Tool[] => TOOLS.filter((t) => t.category === slug);
export const toolsInWave = (wave: Wave): Tool[] => TOOLS.filter((t) => t.wave === wave);

export const toolPath = (tool: Pick<Tool, 'slug' | 'category'>): string => `/tools/${tool.category}/${tool.slug}/`;

export const categoryPath = (slug: CategorySlug): string => `/tools/${slug}/`;

/** Related tools, resolving slugs and skipping anything not yet live. Falls back to siblings in the category. */
export function relatedTools(tool: Tool, max = 6): Tool[] {
  const explicit = tool.related
    .map(getTool)
    .filter((t): t is Tool => !!t && t.status === 'live' && t.slug !== tool.slug);
  if (explicit.length >= max) return explicit.slice(0, max);
  const siblings = toolsInCategory(tool.category).filter(
    (t) => t.status === 'live' && t.slug !== tool.slug && !explicit.includes(t),
  );
  return [...explicit, ...siblings].slice(0, max);
}

/** Categories that have at least one tool (live or planned), for nav and the home grid. */
export const activeCategories = (): Category[] => CATEGORIES.filter((c) => toolsInCategory(c.slug).length > 0);

// Build-time sanity checks: duplicate slugs or dangling related links fail the build.
{
  const seen = new Set<string>();
  for (const t of TOOLS) {
    if (seen.has(t.slug)) throw new Error(`Duplicate tool slug "${t.slug}" in src/data/tools.ts`);
    seen.add(t.slug);
  }
  for (const t of TOOLS) {
    for (const r of t.related) {
      if (!seen.has(r)) throw new Error(`Tool "${t.slug}" relates to unknown slug "${r}"`);
    }
  }
}
