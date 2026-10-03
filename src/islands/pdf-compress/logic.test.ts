import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { CompressError, DEFAULT_PREFS, buildRasterPdf, compressedName, countPages, describeOutcome, normalizePrefs, optimizePdf, presetFor, rasterPixels } from './logic';

async function noisyJpeg(width: number, height: number, quality = 95): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 251;
  return new Uint8Array(await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer());
}

async function textPdf(pages = 2, title = 'Quarterly report'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) doc.addPage([595, 842]).drawText(`Page ${i}`, { x: 50, y: 780, size: 24, font });
  doc.setTitle(title);
  doc.setAuthor('Ada Lovelace');
  return doc.save();
}

describe('optimizePdf', () => {
  it('keeps every page and the metadata when asked', async () => {
    const out = await optimizePdf(await textPdf(3), { keepMetadata: true });
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getTitle()).toBe('Quarterly report');
    expect(doc.getAuthor()).toBe('Ada Lovelace');
    expect(doc.getProducer()).toBe('Cuisdev PDF Compress');
  });
  it('drops metadata when asked', async () => {
    const doc = await PDFDocument.load(await optimizePdf(await textPdf(1), { keepMetadata: false }));
    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getAuthor()).toBeUndefined();
  });
  it('removes objects that no page uses', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    await doc.embedJpg(await noisyJpeg(400, 400)); // embedded but never drawn
    const bloated = await doc.save();
    const out = await optimizePdf(bloated, { keepMetadata: true });
    expect(out.length).toBeLessThan(bloated.length / 4);
    expect(await countPages(out)).toBe(1);
  });
  it('rejects files that are not PDFs', async () => {
    await expect(optimizePdf(new TextEncoder().encode('not a pdf'), { keepMetadata: true })).rejects.toBeInstanceOf(CompressError);
  });
});

describe('buildRasterPdf', () => {
  it('writes one JPEG page per input at the given size', async () => {
    const jpeg = await noisyJpeg(120, 160, 60);
    const out = await buildRasterPdf(
      [
        { jpeg, width: 595, height: 842 },
        { jpeg, width: 842, height: 595 },
      ],
      { title: 'scan' },
    );
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(1).getSize()).toEqual({ width: 842, height: 595 });
    expect(doc.getTitle()).toBe('scan');
  });
  it('refuses an empty page list', async () => {
    await expect(buildRasterPdf([])).rejects.toThrow(/no pages/);
  });
  it('gets much smaller than a PDF holding a large high-quality image', async () => {
    const big = await PDFDocument.create();
    const img = await big.embedJpg(await noisyJpeg(1600, 1200, 98));
    big.addPage([800, 600]).drawImage(img, { x: 0, y: 0, width: 800, height: 600 });
    const original = await big.save();
    const small = await buildRasterPdf([{ jpeg: await noisyJpeg(800, 600, 50), width: 800, height: 600 }]);
    expect(small.length).toBeLessThan(original.length / 2);
  });
});

describe('describeOutcome', () => {
  it('reports savings', () => {
    const o = describeOutcome(1_000_000, 400_000);
    expect(o).toMatchObject({ saved: 600_000, percent: 60, larger: false, noGain: false });
    expect(o.message).toBe('Saved 585.9 KB (60% smaller).');
  });
  it('flags results that are larger or barely smaller', () => {
    expect(describeOutcome(1000, 1200)).toMatchObject({ larger: true, saved: -200, percent: -20 });
    expect(describeOutcome(1000, 1200).message).toMatch(/keep the original/);
    expect(describeOutcome(100_000, 99_500)).toMatchObject({ noGain: true, larger: false });
    expect(describeOutcome(100_000, 99_500).message).toMatch(/already compact/);
  });
});

describe('helpers', () => {
  it('names the output', () => {
    expect(compressedName('Report Q3.PDF')).toBe('Report Q3-compressed.pdf');
    expect(compressedName('.pdf')).toBe('document-compressed.pdf');
  });
  it('estimates raster pixels and matches presets', () => {
    expect(rasterPixels({ width: 612, height: 792 }, 72)).toBe(612 * 792);
    expect(rasterPixels({ width: 612, height: 792 }, 144)).toBe(1224 * 1584);
    expect(presetFor(96, 70)).toBe('medium');
    expect(presetFor(96, 71)).toBeNull();
  });
  it('normalises stored prefs', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ mode: 'raster', dpi: 120, quality: 55, grayscale: true, keepMetadata: false })).toEqual({ mode: 'raster', dpi: 120, quality: 55, grayscale: true, keepMetadata: false });
    expect(normalizePrefs({ mode: 'zip', dpi: 999, quality: 0 })).toEqual(DEFAULT_PREFS);
  });
});
