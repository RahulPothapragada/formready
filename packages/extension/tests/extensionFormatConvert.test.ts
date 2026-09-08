import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { imageToPdf } from '../src/formatConvert';
import { fieldRequiresPdfConversion } from '../src/formatConvertRule';

// A real, minimal 1x1 black PNG — not a placeholder, an actual decodable image.
const ONE_PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

describe('imageToPdf', () => {
  it('embeds a real PNG into a single-page PDF sized to the image', async () => {
    const pngBytes = base64ToBytes(ONE_PIXEL_PNG_BASE64);
    const pdfBlob = await imageToPdf(pngBytes, 'png');

    expect(pdfBlob.type).toBe('application/pdf');

    const pdfBytes = new Uint8Array(await pdfBlob.arrayBuffer());
    const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
    expect(header).toBe('%PDF-');

    const reloaded = await PDFDocument.load(pdfBytes);
    expect(reloaded.getPageCount()).toBe(1);
    const page = reloaded.getPage(0);
    expect(page.getWidth()).toBe(1);
    expect(page.getHeight()).toBe(1);
  });
});

describe('fieldRequiresPdfConversion', () => {
  it('requires conversion when only PDF is accepted', () => {
    expect(fieldRequiresPdfConversion('application/pdf')).toBe(true);
    expect(fieldRequiresPdfConversion('.pdf')).toBe(true);
  });

  it('does not require conversion when images are also accepted', () => {
    expect(fieldRequiresPdfConversion('image/jpeg,application/pdf')).toBe(false);
    expect(fieldRequiresPdfConversion('image/*')).toBe(false);
  });

  it('does not require conversion when the accept attribute is empty', () => {
    expect(fieldRequiresPdfConversion('')).toBe(false);
  });
});
