/**
 * Decoding, geometry, and encoding against the browser image APIs.
 *
 * Format is always determined by reading the file's magic bytes, never by
 * trusting the filename extension (FR-06).
 */

import type { CropRect, ImageFormat } from '../domain/types';

/** Guardrails from section 3. Re-measure on the target phone before release. */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 20_000_000;

const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export const EXTENSION_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
};

export class UnsupportedImageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UnsupportedImageError';
  }
}

/**
 * Identifies JPEG and PNG from their file signatures.
 * Pure and synchronous so it can be unit-tested without a browser.
 */
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && pngSignature.every((byte, i) => bytes[i] === byte)) {
    return 'png';
  }
  return null;
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

/**
 * Source dimensions as they appear after the approved rotation.
 *
 * A quarter turn swaps width and height, so the candidate search must plan
 * geometry against the rotated shape. Planning against the unrotated one
 * produces target boxes with the wrong aspect ratio, which `render()` then
 * stretches into — exactly the silent distortion FR-07 forbids.
 */
export function orientedSize(
  width: number,
  height: number,
  rotation: 0 | 90 | 180 | 270,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

/**
 * Largest box inside `bounds` that keeps the source aspect ratio.
 * Used to avoid stretching a face or a signature when only a maximum is given.
 */
export function fitWithinAspect(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number | null,
  maxHeight: number | null,
): { width: number; height: number } {
  const widthScale = maxWidth === null ? Infinity : maxWidth / sourceWidth;
  const heightScale = maxHeight === null ? Infinity : maxHeight / sourceHeight;
  // Never upscale: enlarging pixels implies detail the source does not have.
  const scale = Math.min(widthScale, heightScale, 1);
  if (!Number.isFinite(scale)) return { width: sourceWidth, height: sourceHeight };
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}
