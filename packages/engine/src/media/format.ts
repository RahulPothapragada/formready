/**
 * Format identification and the input guardrails.
 *
 * Pure byte inspection with no imaging API involved, so it runs identically in
 * a browser, in Node, and inside an embedded JavaScript runtime on Android.
 */

import type { ImageFormat } from '../types';

/**
 * Guardrails from section 3 of the specification. Measured on the target phone
 * (Android 10, 8 cores/8 GB, Chrome Mobile) via /feasibility on 2026-09-07:
 * the decode ceiling was 24 MP with nothing else running. A live session also
 * holds the OCR worker and preview bitmaps, so the shipped limit sits below the
 * measured ceiling rather than at it. See docs/feasibility.md.
 */
export const MAX_INPUT_BYTES = 10 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 18_000_000;

export const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export const EXTENSION_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
};

/**
 * Identifies JPEG and PNG from their file signatures.
 *
 * Format is always determined by reading the bytes, never by trusting a
 * filename extension (FR-06).
 */
export function sniffFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && pngSignature.every((byte, index) => bytes[index] === byte)) {
    return 'png';
  }
  return null;
}
