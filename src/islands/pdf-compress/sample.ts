/**
 * Browser-only sample PDF for the PDF tools: three pages with real text, and a large
 * high-quality photo-like image on page 2 so compression has something to work on.
 */
import { loadPdfLib } from '../pdf-converter/pdf';

function photoJpeg(width: number, height: number): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Canvas is not available.'));
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#1f3b73');
  sky.addColorStop(0.55, '#e9896a');
  sky.addColorStop(1, '#2d4a31');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  // Fine noise defeats JPEG compression the way a real photo does.
  const img = ctx.getImageData(0, 0, width, height);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = (seed % 41) - 20;
    img.data[i] = Math.max(0, Math.min(255, img.data[i]! + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1]! + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2]! + n));
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `bold ${Math.round(width / 16)}px system-ui, sans-serif`;
  ctx.fillText('Site survey, north ridge', width * 0.05, height * 0.12);
  return new Promise((resolve, reject) =>
    c.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('Could not encode the sample photo.'))), 'image/jpeg', 0.97),
  );
}

export async function makeSamplePdf(): Promise<File> {
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const A4: [number, number] = [595.28, 841.89];

  const p1 = doc.addPage(A4);
  p1.drawText('Field report', { x: 56, y: 770, size: 28, font: bold, color: rgb(0.12, 0.13, 0.2) });
  const lines = [
    'This sample PDF was generated in your browser.',
    'Page 2 holds a large, high quality photograph, which is what',
    'makes most real PDFs heavy. Page 3 is plain text and vector shapes.',
    '',
    'Try both modes: Optimise keeps text selectable and usually saves',
    'a little. Compress images re-renders every page as a JPEG and',
    'saves far more on scanned or photo-heavy documents.',
  ];
  lines.forEach((t, i) => p1.drawText(t, { x: 56, y: 720 - i * 20, size: 13, font, color: rgb(0.3, 0.32, 0.38) }));

  const p2 = doc.addPage(A4);
  const photo = await doc.embedJpg(await photoJpeg(2400, 1600));
  p2.drawText('Photo', { x: 56, y: 780, size: 20, font: bold });
  p2.drawImage(photo, { x: 56, y: 400, width: 483, height: 322 });

  const p3 = doc.addPage(A4);
  p3.drawText('Summary table', { x: 56, y: 780, size: 20, font: bold });
  for (let r = 0; r < 8; r++) {
    p3.drawRectangle({ x: 56, y: 700 - r * 28, width: 483, height: 28, borderColor: rgb(0.75, 0.77, 0.82), borderWidth: 0.8 });
    p3.drawText(`Row ${r + 1}`, { x: 66, y: 709 - r * 28, size: 11, font });
    p3.drawText(`${(r + 1) * 137} m`, { x: 300, y: 709 - r * 28, size: 11, font });
  }
  doc.setTitle('Field report sample');
  doc.setAuthor('Cuisdev');
  const bytes = await doc.save();
  return new File([bytes as BlobPart], 'field-report.pdf', { type: 'application/pdf' });
}
