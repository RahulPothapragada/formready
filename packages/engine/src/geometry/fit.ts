/**
 * Output geometry arithmetic.
 *
 * Separated from the platform's imaging code because the candidate search needs
 * it and must stay portable — this is the line the Android port cuts along. The
 * search decides *what size* to produce; the platform decides *how* to produce
 * it.
 */

/**
 * Source dimensions as they appear after the approved rotation.
 *
 * A quarter turn swaps width and height, so geometry must be planned against
 * the rotated shape. Planning against the unrotated one produces target boxes
 * with the wrong aspect ratio, which rendering then stretches into — exactly
 * the silent distortion FR-07 forbids.
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
 * Largest box inside the given bounds that keeps the source aspect ratio.
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
