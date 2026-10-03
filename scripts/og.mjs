/**
 * Generates 1200x630 Open Graph images for every tool, every blog post and a default,
 * plus PNG app icons, using sharp to rasterise an SVG template. Runs as `prebuild`.
 *
 * Output: public/og/<slug>.png, public/og/blog-<id>.png, public/og/default.png,
 *         public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png
 */
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.join(ROOT, 'public', 'og');
await mkdir(OUT, { recursive: true });

// Read the registry without a TS loader: pull the object literals with a tolerant regex.
const fullSrc = await readFile(path.join(ROOT, 'src/data/tools.ts'), 'utf8');
// Only scan the TOOLS array so category entries are not mistaken for tools.
const registrySrc = fullSrc.slice(fullSrc.indexOf('export const TOOLS'));
const tools = [...registrySrc.matchAll(/\{\s*slug:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?tagline:\s*'([^']+)'[\s\S]*?status:\s*'(live|soon)'/g)].map(
  (m) => ({ slug: m[1], name: m[2], tagline: m[3], status: m[4] }),
);

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Wrap text to lines of at most `max` characters. */
function wrap(text, max) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max) {
      lines.push(cur.trim());
      cur = w;
    } else cur += ' ' + w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.slice(0, 3);
}

function template({ title, subtitle, kicker }) {
  const titleLines = wrap(title, 26);
  const titleSize = titleLines.length > 2 ? 60 : 72;
  const titleY = 300 - (titleLines.length - 1) * (titleSize * 0.55);
  const subLines = wrap(subtitle ?? '', 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17181d"/><stop offset="1" stop-color="#23253a"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M40 0H0V40" fill="none" stroke="#ffffff" stroke-opacity="0.06"/>
    </pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <circle cx="1050" cy="80" r="260" fill="#4f46e5" fill-opacity="0.18"/>
  <g transform="translate(80 72)">
    <rect width="56" height="56" rx="14" fill="#4f46e5"/>
    <path d="M36 18.4a11.4 11.4 0 1 0 0 19.2" stroke="#fff" stroke-width="5.2" stroke-linecap="round" fill="none"/>
    <circle cx="38.5" cy="28" r="3.5" fill="#fff"/>
    <text x="72" y="40" font-family="Archivo, Inter, Arial, sans-serif" font-size="30" font-weight="700" fill="#fff">Cuisdev</text>
  </g>
  ${kicker ? `<text x="80" y="200" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="600" fill="#a5b4fc" letter-spacing="2">${escape(kicker.toUpperCase())}</text>` : ''}
  ${titleLines
    .map(
      (l, i) =>
        `<text x="80" y="${titleY + i * titleSize * 1.1}" font-family="Archivo, Inter, Arial, sans-serif" font-size="${titleSize}" font-weight="800" fill="#ffffff">${escape(l)}</text>`,
    )
    .join('')}
  ${subLines
    .map(
      (l, i) =>
        `<text x="80" y="${titleY + titleLines.length * titleSize * 1.1 + 20 + i * 38}" font-family="Inter, Arial, sans-serif" font-size="28" fill="#c7c9d6">${escape(l)}</text>`,
    )
    .join('')}
  <g transform="translate(80 548)" font-family="Inter, Arial, sans-serif" font-size="22" fill="#9aa0b4">
    <text x="0" y="0">Free</text><text x="90" y="0">Private, runs in your browser</text><text x="470" y="0">No sign-up</text>
    <text x="1040" y="0" text-anchor="end" fill="#a5b4fc">cuisdev.com</text>
  </g>
</svg>`;
}

async function render(svg, file) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(file);
}

let count = 0;
// Default
await render(template({ title: 'Free online tools that never see your data', subtitle: 'Format JSON, convert files, edit images and more. Everything runs in your browser.' }), path.join(OUT, 'default.png'));
count++;

// Tools (live and soon, so cards shared before launch still have an image)
for (const t of tools) {
  await render(template({ kicker: 'Free online tool', title: t.name, subtitle: t.tagline }), path.join(OUT, `${t.slug}.png`));
  count++;
}

// Blog posts
const blogDir = path.join(ROOT, 'src/content/blog');
if (existsSync(blogDir)) {
  for (const f of await readdir(blogDir)) {
    if (!f.endsWith('.mdx') && !f.endsWith('.md')) continue;
    const src = await readFile(path.join(blogDir, f), 'utf8');
    const title = /^title:\s*(.+)$/m.exec(src)?.[1]?.replace(/^['"]|['"]$/g, '') ?? f;
    const id = f.replace(/\.mdx?$/, '');
    await render(template({ kicker: 'Guide', title, subtitle: 'Read on the Cuisdev blog' }), path.join(OUT, `blog-${id}.png`));
    count++;
  }
}

// App icons from the logo
const logo = await readFile(path.join(ROOT, 'public/logo.svg'));
for (const [size, name] of [[192, 'icon-192.png'], [512, 'icon-512.png'], [180, 'apple-touch-icon.png']]) {
  await sharp(logo).resize(size, size).png().toFile(path.join(ROOT, 'public', name));
}

// favicon.ico (16, 32 and 48 px PNGs in an ICO container). Pages link favicon.svg, but
// browsers and crawlers still request /favicon.ico by default.
{
  const sizes = [16, 32, 48];
  const pngs = await Promise.all(sizes.map((s) => sharp(logo).resize(s, s).png().toBuffer()));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s, 0); // width
    e.writeUInt8(s, 1); // height
    e.writeUInt8(0, 2); // palette colours
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    entries.push(e);
  });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(ROOT, 'public', 'favicon.ico'), Buffer.concat([header, ...entries, ...pngs]));
}

console.log(`og: generated ${count} social images, 3 app icons and favicon.ico`);
