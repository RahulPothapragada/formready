/**
 * Crop rectangle mathematics.
 *
 * Kept separate from the editor component because it is the part that can be
 * wrong silently. The editor shows the image the way the user will see the
 * finished file — rotated — but the preparation pipeline crops the *source*
 * before rotating it, so the rectangle has to be converted on the way out.
 * Getting that conversion wrong crops the wrong part of a sideways photo and
 * looks, on screen, exactly like it working.
 */

import type { CropRect } from '../../domain/types';

export type Rotation = 0 | 90 | 180 | 270;

export interface Size {
  width: number;
  height: number;
}

/** How the source looks after rotation — a quarter turn swaps the axes. */
export function visualSize(source: Size, rotation: Rotation): Size {
  return rotation === 90 || rotation === 270
    ? { width: source.height, height: source.width }
    : { ...source };
}

/**
 * Converts a rectangle drawn on the rotated view into source coordinates.
 *
 * Derived from where each rotation sends a pixel:
 *   90°  clockwise: source (x, y) appears at (H - y, x)
 *   180°:           source (x, y) appears at (W - x, H - y)
 *   270°:           source (x, y) appears at (y, W - x)
 * and then inverted for the rectangle's own corners.
 */
export function visualCropToSource(
  crop: CropRect,
  rotation: Rotation,
  source: Size,
): CropRect {
  switch (rotation) {
    case 0:
      return { ...crop };
    case 90:
      return {
        x: crop.y,
        y: source.height - crop.x - crop.width,
        width: crop.height,
        height: crop.width,
      };
    case 180:
      return {
        x: source.width - crop.x - crop.width,
        y: source.height - crop.y - crop.height,
        width: crop.width,
        height: crop.height,
      };
    case 270:
      return {
        x: source.width - crop.y - crop.height,
        y: crop.x,
        width: crop.height,
        height: crop.width,
      };
  }
}

/** Smallest crop we let the user make, in image pixels. */
export const MIN_CROP = 24;

/** Keeps a rectangle inside the image, at or above the minimum size. */
export function clampCrop(crop: CropRect, bounds: Size): CropRect {
  const width = Math.min(Math.max(crop.width, MIN_CROP), bounds.width);
  const height = Math.min(Math.max(crop.height, MIN_CROP), bounds.height);
  return {
    width,
    height,
    x: Math.min(Math.max(crop.x, 0), bounds.width - width),
    y: Math.min(Math.max(crop.y, 0), bounds.height - height),
  };
}

/**
 * Forces a rectangle to an aspect ratio by shrinking the longer axis, so the
 * result always still fits inside whatever the caller had.
 */
export function withAspect(crop: CropRect, aspect: number): CropRect {
  const currentAspect = crop.width / crop.height;
  if (Math.abs(currentAspect - aspect) < 0.0001) return { ...crop };

  return currentAspect > aspect
    ? { ...crop, width: crop.height * aspect }
    : { ...crop, height: crop.width / aspect };
}

/**
 * The largest centred rectangle of the requested shape that fits the image.
 * With no required shape, that is the whole image.
 */
export function centredCrop(bounds: Size, aspect: number | null): CropRect {
  if (aspect === null) return { x: 0, y: 0, ...bounds };

  const boundsAspect = bounds.width / bounds.height;
  const width = boundsAspect > aspect ? bounds.height * aspect : bounds.width;
  const height = boundsAspect > aspect ? bounds.height : bounds.width / aspect;

  return {
    x: (bounds.width - width) / 2,
    y: (bounds.height - height) / 2,
    width,
    height,
  };
}

export type Handle = 'nw' | 'ne' | 'se' | 'sw';

/**
 * Moves one corner, keeping the opposite corner pinned. When an aspect is
 * required the rectangle is corrected afterwards and re-anchored, so dragging
 * never produces a shape the output cannot use.
 */
export function resizeFromHandle(
  crop: CropRect,
  handle: Handle,
  pointer: { x: number; y: number },
  bounds: Size,
  aspect: number | null,
): CropRect {
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;

  const anchor = {
    nw: { x: right, y: bottom },
    ne: { x: crop.x, y: bottom },
    se: { x: crop.x, y: crop.y },
    sw: { x: right, y: crop.y },
  }[handle];

  let next: CropRect = {
    x: Math.min(anchor.x, pointer.x),
    y: Math.min(anchor.y, pointer.y),
    width: Math.abs(pointer.x - anchor.x),
    height: Math.abs(pointer.y - anchor.y),
  };

  if (aspect !== null) {
    const shaped = withAspect(next, aspect);
    // Re-pin to the anchor: shaping changes the size, and without this the
    // rectangle creeps away from the corner the user is not dragging.
    next = {
      width: shaped.width,
      height: shaped.height,
      x: pointer.x < anchor.x ? anchor.x - shaped.width : anchor.x,
      y: pointer.y < anchor.y ? anchor.y - shaped.height : anchor.y,
    };
  }

  return clampCrop(next, bounds);
}

/** Scales a rectangle about its own centre, for pinch gestures. */
export function scaleAboutCentre(crop: CropRect, factor: number, bounds: Size): CropRect {
  const centreX = crop.x + crop.width / 2;
  const centreY = crop.y + crop.height / 2;
  const width = crop.width * factor;
  const height = crop.height * factor;

  return clampCrop(
    { x: centreX - width / 2, y: centreY - height / 2, width, height },
    bounds,
  );
}

/** Rounds to whole pixels only at the end, so dragging stays smooth. */
export function roundCrop(crop: CropRect): CropRect {
  const x = Math.round(crop.x);
  const y = Math.round(crop.y);
  return {
    x,
    y,
    width: Math.max(1, Math.round(crop.x + crop.width) - x),
    height: Math.max(1, Math.round(crop.y + crop.height) - y),
  };
}
