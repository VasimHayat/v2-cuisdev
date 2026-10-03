# Content calendar

Blog posts live in `src/content/blog/`. A post goes live on the first build on or after its `publishDate` (see `src/lib/blog.ts`). The deploy workflow rebuilds every Tuesday and Thursday at 06:00 UTC. To change the cadence, edit the dates in each post's frontmatter.

| Date | Post | Target search | Tools |
| --- | --- | --- | --- |
| 2026-10-03 | [What is CORS and how to fix CORS errors](../src/content/blog/cors-errors-explained.mdx) | fix cors error / what is cors | api-request-tester, json-editor |
| 2026-10-03 | [What is Base64 encoding and when should you use it](../src/content/blog/what-is-base64.mdx) | what is base64 / base64 encoding explained | base64-encode-decode, image-converter |
| 2026-10-03 | [JWT explained: structure, signing and security mistakes](../src/content/blog/jwt-explained-security.mdx) | what is jwt / jwt security | jwt-decoder, base64-encode-decode, hash-generator |
| 2026-10-03 | [Cron syntax explained with 30 real-world examples](../src/content/blog/cron-syntax-examples.mdx) | cron syntax / cron examples | cron-parser, timestamp-converter |
| 2026-10-03 | [WebP vs AVIF vs JPEG vs PNG: which image format to use](../src/content/blog/webp-vs-avif-vs-jpeg.mdx) | webp vs avif / best image format for web | image-converter, image-compressor |
| 2026-10-03 | [Unix timestamps explained: seconds, milliseconds and 2038](../src/content/blog/unix-timestamp-explained.mdx) | what is unix timestamp / epoch time | timestamp-converter, date-difference-calculator |
| 2026-10-03 | [Markdown cheat sheet: GitHub Flavored Markdown with examples](../src/content/blog/markdown-cheat-sheet.mdx) | markdown cheat sheet / markdown syntax | markdown-preview, html-entity-encoder |
| 2026-10-06 | [UUID v4 vs v7: which to use for database primary keys](../src/content/blog/uuid-v4-vs-v7.mdx) | uuid v7 vs v4 primary key | uuid-generator, hash-generator |
| 2026-10-08 | [How to reduce image size without losing visible quality](../src/content/blog/reduce-image-size.mdx) | reduce image size without losing quality | image-compressor, image-resizer, image-converter |
| 2026-10-13 | [URL encoding explained: percent-encoding, + vs %20](../src/content/blog/url-encoding-explained.mdx) | url encoding / percent encoding | url-encode-decode, api-request-tester |
| 2026-10-15 | [How to calculate percentages: change, increase and points](../src/content/blog/calculate-percentages.mdx) | how to calculate percentage increase | percentage-calculator, compound-interest-calculator |
| 2026-10-20 | [MD5, SHA-1, SHA-256 and BLAKE3 compared: which hash to use](../src/content/blog/which-hash-algorithm.mdx) | md5 vs sha256 / which hash algorithm | hash-generator, password-generator |
| 2026-10-22 | [Why are PDFs so large? How to reduce PDF file size](../src/content/blog/reduce-pdf-file-size.mdx) | reduce pdf file size | pdf-compress, image-compressor |
| 2026-10-27 | [Regex cheat sheet: 25 patterns you will actually use](../src/content/blog/regex-cheat-sheet-practical.mdx) | regex cheat sheet / common regex patterns | regex-tester, find-and-replace |
| 2026-10-29 | [camelCase, snake_case, kebab-case: naming conventions by language](../src/content/blog/naming-conventions-camel-snake-kebab.mdx) | camelcase vs snake_case | case-converter, slug-generator |
| 2026-11-03 | [How long should a password be? Entropy explained](../src/content/blog/password-length-entropy.mdx) | how long should a password be | password-generator, hash-generator |
| 2026-11-05 | [How to open JSON in Excel and when to convert to CSV first](../src/content/blog/open-json-in-excel.mdx) | open json in excel / json to excel | json-to-csv, json-editor |
| 2026-11-10 | [How EMI is calculated: formula, worked example, amortization](../src/content/blog/how-emi-is-calculated.mdx) | emi calculation formula | loan-emi-calculator, compound-interest-calculator |
| 2026-11-12 | [HEX, RGB, HSL and OKLCH: CSS color formats explained](../src/content/blog/css-color-formats-oklch.mdx) | oklch css / css color formats | color-converter, color-picker-from-image |
| 2026-11-17 | [How to extract pages from a PDF on Windows, Mac and online](../src/content/blog/extract-pages-from-pdf.mdx) | extract pages from pdf | pdf-split, pdf-page-reorder |
| 2026-11-19 | [YAML gotchas: the Norway problem, indentation and anchors](../src/content/blog/yaml-gotchas.mdx) | yaml norway problem / yaml pitfalls | json-to-yaml, yaml-to-json |
| 2026-11-24 | [How diff works: reading unified diffs and patch files](../src/content/blog/how-diff-works-unified-diff.mdx) | how to read a diff / unified diff format | text-diff-checker, code-formatter |
| 2026-11-26 | [Favicon sizes: the files and HTML tags you actually need](../src/content/blog/favicon-sizes.mdx) | favicon sizes / favicon html | favicon-generator, image-resizer |
| 2026-12-01 | [Compound interest explained: the formula and starting early](../src/content/blog/compound-interest-explained.mdx) | compound interest formula explained | compound-interest-calculator, percentage-calculator |
| 2026-12-03 | [HTML escaping and XSS: how to escape user input correctly](../src/content/blog/html-escaping-xss.mdx) | html escape xss prevention | html-entity-encoder, url-encode-decode |
| 2026-12-08 | [Natural sort order: why file10 sorts before file2](../src/content/blog/natural-sort-order.mdx) | natural sort / sort numbers as text | sort-lines, remove-duplicate-lines |
| 2026-12-10 | [How QR codes work and how to make one that always scans](../src/content/blog/how-qr-codes-work.mdx) | how do qr codes work | qr-code-generator, url-encode-decode |
| 2026-12-15 | [JSON vs JSON5 vs JSONC: what each allows and when to use it](../src/content/blog/json-vs-json5-jsonc.mdx) | json5 vs json / json with comments | json-validator, json-formatter |
| 2026-12-17 | [Aspect ratios explained: 16:9, 4:3, 1:1 and when to use each](../src/content/blog/aspect-ratios-explained.mdx) | aspect ratio explained | image-editor, image-resizer |
| 2026-12-22 | [How to count business days between two dates](../src/content/blog/count-business-days.mdx) | calculate business days between dates | date-difference-calculator, age-calculator |
| 2026-12-24 | [SQL style guide: formatting queries your team can read](../src/content/blog/sql-style-guide.mdx) | sql formatting best practices | sql-formatter, code-formatter |
| 2026-12-29 | [How text becomes binary: ASCII, Unicode and UTF-8 explained](../src/content/blog/text-to-binary-utf8.mdx) | how text is stored in binary / utf-8 explained | text-to-binary, number-base-converter |
| 2026-12-31 | [How to combine images into one PDF on any device](../src/content/blog/combine-images-into-pdf.mdx) | combine images into pdf / jpg to pdf | pdf-converter, image-resizer |
| 2027-01-05 | [Word counts for essays, articles, meta tags and social posts](../src/content/blog/word-count-guidelines.mdx) | how many words / character limits | word-counter, case-converter |
| 2027-01-07 | [How to generate realistic test data for APIs and prototypes](../src/content/blog/generate-test-data.mdx) | generate fake json test data | mock-json-generator, uuid-generator |
| 2027-01-12 | [Binary, hex and octal: a practical guide to number bases](../src/content/blog/number-bases-guide.mdx) | binary to hex / number bases explained | number-base-converter, text-to-binary |
| 2027-01-14 | [What makes a good URL slug for SEO](../src/content/blog/url-slug-best-practices.mdx) | url slug best practices | slug-generator, url-encode-decode |
| 2027-01-19 | [BMI explained: what it measures and where it falls short](../src/content/blog/bmi-explained.mdx) | what is bmi / bmi limitations | bmi-calculator, unit-converter |
| 2027-01-21 | [How to open and edit large JSON files without crashing](../src/content/blog/edit-large-json-files.mdx) | open large json file | json-editor, json-minifier |
| 2027-01-26 | [What DPI to use when converting a PDF to images](../src/content/blog/pdf-to-image-dpi.mdx) | pdf to image dpi / pdf to png quality | pdf-to-image, image-compressor |
| 2027-01-28 | [Remove duplicate lines in Excel, Sheets, VS Code and the terminal](../src/content/blog/remove-duplicate-lines-everywhere.mdx) | remove duplicate lines | remove-duplicate-lines, sort-lines |
| 2027-02-02 | [How to calculate age in Excel, Google Sheets and code](../src/content/blog/calculate-age-excel-code.mdx) | calculate age in excel | age-calculator, date-difference-calculator |
| 2027-02-04 | [GraphQL query basics: fields, variables, fragments, directives](../src/content/blog/graphql-query-basics.mdx) | graphql query tutorial | graphql-formatter, api-request-tester |
| 2027-02-09 | [How to build a color palette from a photo](../src/content/blog/color-palette-from-photo.mdx) | color palette from image | color-picker-from-image, color-converter |
| 2027-02-11 | [XML vs JSON: when XML is still the right choice](../src/content/blog/xml-vs-json.mdx) | xml vs json | xml-formatter, json-formatter |
| 2027-02-16 | [Metric vs imperial: the conversions that trip people up](../src/content/blog/metric-imperial-pitfalls.mdx) | metric to imperial conversion mistakes | unit-converter, percentage-calculator |
| 2027-02-18 | [How to rearrange, rotate and delete PDF pages without Acrobat](../src/content/blog/rearrange-pdf-pages.mdx) | rearrange pdf pages | pdf-page-reorder, pdf-split |
| 2027-02-23 | [How code formatters like Prettier work, and how to set one up](../src/content/blog/how-code-formatters-work.mdx) | prettier setup / code formatter | code-formatter, text-diff-checker |
| 2027-02-25 | [Find and replace with regex: 12 recipes for cleaning text](../src/content/blog/regex-find-replace-recipes.mdx) | regex find and replace examples | find-and-replace, regex-tester |
| 2027-03-02 | [Does minifying JSON make APIs faster? Gzip, Brotli and numbers](../src/content/blog/minify-json-api-performance.mdx) | minify json performance | json-minifier, json-formatter |
| 2027-03-04 | [Lorem ipsum: where it comes from and when not to use it](../src/content/blog/lorem-ipsum-history.mdx) | what does lorem ipsum mean | lorem-ipsum-generator, word-counter |
| 2027-03-09 | [How to resize images for the web: srcset, density and file size](../src/content/blog/resize-images-for-web.mdx) | resize images for website | image-resizer, image-compressor |
| 2027-03-11 | [YAML vs JSON for configuration files](../src/content/blog/yaml-vs-json-config.mdx) | yaml vs json for config | yaml-to-json, json-to-yaml |
| 2027-03-16 | [How to calculate a tip in your head in seconds](../src/content/blog/calculate-tip-mental-math.mdx) | how to calculate tip | tip-calculator, percentage-calculator |
| 2027-03-18 | [JSON formatting conventions: indentation, key order, newlines](../src/content/blog/json-formatting-best-practices.mdx) | json formatting best practices | json-formatter, json-validator |
