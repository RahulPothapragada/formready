/**
 * The browser's half of the imaging seam.
 *
 * Everything here needs a canvas or a decoder, which is exactly why it is not
 * in the engine. The engine decides what size and format to produce; this
 * module produces it. An Android adapter replaces this file and nothing else.
 */

import { MIME_BY_FORMAT, sniffFormat } from '@formready/engine';
import type { BinarySource, CropRect, ImageFormat } from '@formready/engine';

// Re-exported so browser callers have one import for the imaging surface.
export {
  EXTENSION_BY_FORMAT,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  fitWithinAspect,
  orientedSize,
  sniffFormat,
} from '@formready/engine';

/**
 * Narrows the engine's opaque payload to a real `Blob`.
 *
 * The engine deliberately does not name browser types, so it carries documents
 * as `BinarySource`. On this platform every payload originates from a file
 * input, a canvas, or IndexedDB — all of which produce Blobs — so the narrowing
 * is sound here and nowhere else. An Android adapter writes its own equivalent.
 */
export function asBlob(source: BinarySource): Blob {
  return source as Blob;
}

export class UnsupportedImageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnsupportedImageError';
  }
}



export async function readFormat(blob: Blob): Promise<ImageFormat | null> {
  const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  return sniffFormat(header);
}

/**
 * Decodes to a bitmap with EXIF orientation already applied, so every width and
 * height downstream is the visual one. This must happen before the crop editor
 * renders, or approved crop rectangles land on the wrong axis.
 */
export async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (cause) {
    throw new UnsupportedImageError('This file could not be opened as a JPEG or PNG image.', {
      cause,
    });
  }
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export interface RenderRequest {
  bitmap: ImageBitmap;
  crop: CropRect | null;
  rotation: 0 | 90 | 180 | 270;
  targetWidth: number;
  targetHeight: number;
}

/** Applies the user-approved crop and rotation, then scales to the target box. */
export function render(request: RenderRequest): OffscreenCanvas | HTMLCanvasElement {
  const { bitmap, crop, rotation, targetWidth, targetHeight } = request;
  const source = crop ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  const quarterTurn = rotation === 90 || rotation === 270;

  const canvas = createCanvas(targetWidth, targetHeight);
  const context = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!context) throw new UnsupportedImageError('This device could not prepare the image.');

  context.imageSmoothingQuality = 'high';
  context.translate(targetWidth / 2, targetHeight / 2);
  context.rotate((rotation * Math.PI) / 180);

  const drawWidth = quarterTurn ? targetHeight : targetWidth;
  const drawHeight = quarterTurn ? targetWidth : targetHeight;
  context.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    -drawWidth / 2,
    -drawHeight / 2,
    drawWidth,
    drawHeight,
  );

  return canvas;
}

/**
 * Encodes a rendered canvas.
 *
 * `quality` applies to JPEG only. The canvas APIs ignore it for PNG, so PNG
 * size can only be influenced through geometry — see generateCandidates.ts.
 */
export async function encode(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  format: ImageFormat,
  quality?: number,
): Promise<Blob> {
  const type = MIME_BY_FORMAT[format];
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type, quality });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new UnsupportedImageError('The image could not be saved.')),
      type,
      quality,
    );
  });
}
