/**
 * Image -> single-page PDF, for the (common) case where a field requires
 * PDF and the vault only has a photo/signature image. pdf-lib is pure JS
 * (Uint8Array in, Uint8Array out) with no Node/Buffer polyfills needed, so
 * it bundles cleanly — but it's ~1MB, so this module is imported only by
 * background.ts (a service worker, loaded once), never by content.ts
 * (injected into every page). See formatConvertRule.ts for the
 * page-side "does this field need PDF?" check.
 *
 * Deliberately narrow: this converts an already-decoded raster image into a
 * PDF. It does not, and will not, convert Word/Excel/PPT documents — that
 * needs a real office-document engine, which cannot run client-side.
 */

import { PDFDocument } from 'pdf-lib';
import type { ImageFormat } from '../../src/domain/types';

export async function imageToPdf(imageBytes: Uint8Array, format: ImageFormat): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const embedded = format === 'jpeg' ? await pdfDoc.embedJpg(imageBytes) : await pdfDoc.embedPng(imageBytes);
  const page = pdfDoc.addPage([embedded.width, embedded.height]);
  page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes as BlobPart], { type: 'application/pdf' });
}
