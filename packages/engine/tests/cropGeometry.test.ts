import { describe, expect, it } from 'vitest';
import {
  centredCrop,
  clampCrop,
  MIN_CROP,
  resizeFromHandle,
  roundCrop,
  scaleAboutCentre,
  visualCropToSource,
  visualSize,
  withAspect,
} from '@formready/engine';
import type { CropRect } from '@formready/engine';

/**
 * The rotation conversion is the part that can be wrong without looking wrong:
 * the editor shows the rotated view, the pipeline crops the unrotated source,
 * and a bad conversion simply keeps the wrong part of the picture.
 */

const SOURCE = { width: 400, height: 200 }; // landscape

describe('visual size', () => {
  it('swaps the axes for a quarter turn only', () => {
    expect(visualSize(SOURCE, 0)).toEqual({ width: 400, height: 200 });
    expect(visualSize(SOURCE, 180)).toEqual({ width: 400, height: 200 });
    expect(visualSize(SOURCE, 90)).toEqual({ width: 200, height: 400 });
    expect(visualSize(SOURCE, 270)).toEqual({ width: 200, height: 400 });
  });
});

describe('visual crop to source', () => {
  it('is the identity with no rotation', () => {
    const crop: CropRect = { x: 10, y: 20, width: 100, height: 50 };
    expect(visualCropToSource(crop, 0, SOURCE)).toEqual(crop);
  });

  it('maps the whole visual frame back onto the whole source', () => {
    // Whatever the rotation, selecting everything must select everything.
    for (const rotation of [0, 90, 180, 270] as const) {
      const bounds = visualSize(SOURCE, rotation);
      expect(visualCropToSource({ x: 0, y: 0, ...bounds }, rotation, SOURCE)).toEqual({
        x: 0,
        y: 0,
        width: 400,
        height: 200,
      });
    }
  });

  it('sends the top-left of a 90-degree view to the bottom-left of the source', () => {
    // Rotating 90 clockwise puts the source's bottom-left corner top-left.
    const corner: CropRect = { x: 0, y: 0, width: 50, height: 100 };
    expect(visualCropToSource(corner, 90, SOURCE)).toEqual({
      x: 0,
      y: 150,
      width: 100,
      height: 50,
    });
  });

  it('sends the top-left of a 270-degree view to the top-right of the source', () => {
    const corner: CropRect = { x: 0, y: 0, width: 50, height: 100 };
    expect(visualCropToSource(corner, 270, SOURCE)).toEqual({
      x: 300,
      y: 0,
      width: 100,
      height: 50,
    });
  });

  it('mirrors both axes at 180 degrees', () => {
    const corner: CropRect = { x: 0, y: 0, width: 100, height: 50 };
    expect(visualCropToSource(corner, 180, SOURCE)).toEqual({
      x: 300,
      y: 150,
      width: 100,
      height: 50,
    });
  });

  it('always produces a rectangle that fits inside the source', () => {
    const crop: CropRect = { x: 30, y: 40, width: 120, height: 90 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const bounds = visualSize(SOURCE, rotation);
      const fitted = clampCrop(crop, bounds);
      const mapped = visualCropToSource(fitted, rotation, SOURCE);

      expect(mapped.x).toBeGreaterThanOrEqual(0);
      expect(mapped.y).toBeGreaterThanOrEqual(0);
      expect(mapped.x + mapped.width).toBeLessThanOrEqual(SOURCE.width);
      expect(mapped.y + mapped.height).toBeLessThanOrEqual(SOURCE.height);
    }
  });

  it('preserves the selected area under every rotation', () => {
    const crop: CropRect = { x: 10, y: 20, width: 60, height: 40 };
    for (const rotation of [0, 90, 180, 270] as const) {
      const mapped = visualCropToSource(crop, rotation, SOURCE);
      expect(mapped.width * mapped.height).toBe(crop.width * crop.height);
    }
  });
});

describe('clamping', () => {
  it('keeps the rectangle inside the image', () => {
    expect(clampCrop({ x: -50, y: -50, width: 100, height: 50 }, SOURCE)).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    expect(clampCrop({ x: 380, y: 190, width: 100, height: 50 }, SOURCE)).toEqual({
      x: 300,
      y: 150,
      width: 100,
      height: 50,
    });
  });

  it('never lets the frame collapse below the minimum', () => {
    const tiny = clampCrop({ x: 10, y: 10, width: 1, height: 1 }, SOURCE);
    expect(tiny.width).toBe(MIN_CROP);
    expect(tiny.height).toBe(MIN_CROP);
  });

  it('caps a frame larger than the image', () => {
    expect(clampCrop({ x: 0, y: 0, width: 9999, height: 9999 }, SOURCE)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 200,
    });
  });
});

describe('aspect handling', () => {
  it('shrinks the longer axis rather than growing past the bounds', () => {
    const square = withAspect({ x: 0, y: 0, width: 200, height: 100 }, 1);
    expect(square.width).toBe(100);
    expect(square.height).toBe(100);
  });

  it('centres a required shape inside the image', () => {
    // 1:1 inside a 400x200 landscape gives a 200x200 square, centred.
    expect(centredCrop(SOURCE, 1)).toEqual({ x: 100, y: 0, width: 200, height: 200 });
  });

  it('uses the whole image when nothing is required', () => {
    expect(centredCrop(SOURCE, null)).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });

  it('holds the ratio while a corner is dragged', () => {
    const start: CropRect = { x: 100, y: 0, width: 200, height: 200 };
    const dragged = resizeFromHandle(start, 'nw', { x: 200, y: 100 }, SOURCE, 1);
    expect(dragged.width / dragged.height).toBeCloseTo(1);
  });

  it('keeps the opposite corner pinned while dragging', () => {
    const start: CropRect = { x: 100, y: 20, width: 200, height: 100 };
    const dragged = resizeFromHandle(start, 'nw', { x: 150, y: 50 }, SOURCE, null);
    // The south-east corner must not move.
    expect(dragged.x + dragged.width).toBeCloseTo(300);
    expect(dragged.y + dragged.height).toBeCloseTo(120);
  });
});

describe('pinch scaling', () => {
  it('scales about the centre', () => {
    const start: CropRect = { x: 100, y: 50, width: 200, height: 100 };
    const smaller = scaleAboutCentre(start, 0.5, SOURCE);
    expect(smaller.width).toBe(100);
    expect(smaller.height).toBe(50);
    expect(smaller.x + smaller.width / 2).toBeCloseTo(200);
    expect(smaller.y + smaller.height / 2).toBeCloseTo(100);
  });

  it('stops growing at the image edge instead of overflowing', () => {
    const grown = scaleAboutCentre({ x: 0, y: 0, width: 400, height: 200 }, 4, SOURCE);
    expect(grown).toEqual({ x: 0, y: 0, width: 400, height: 200 });
  });
});

describe('rounding', () => {
  it('rounds to whole pixels without losing the far edge', () => {
    // Rounding x and width independently can shift the right edge by a pixel;
    // the edges are rounded instead.
    expect(roundCrop({ x: 10.6, y: 20.2, width: 99.9, height: 50.1 })).toEqual({
      x: 11,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('never produces a zero-sized rectangle', () => {
    const tiny = roundCrop({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Aspect must hold through every editing path, not only the drag handles.
 * Clamping each axis to its own limit changed the ratio, and the output was
 * then stretched to fit — the silent distortion FR-07 forbids.
 */
describe('aspect survives every path', () => {
  const bounds = { width: 1200, height: 800 };
  const ratio = (crop: { width: number; height: number }) => crop.width / crop.height;

  it('keeps the ratio when a pinch would overflow the image', () => {
    const start = { x: 0, y: 0, width: 600, height: 800 };
    const grown = scaleAboutCentre(start, 2, bounds, ratio(start));
    expect(ratio(grown)).toBeCloseTo(ratio(start), 4);
  });

  it('keeps the ratio when clamping an oversized rectangle', () => {
    const clamped = clampCrop({ x: 0, y: 0, width: 2400, height: 1600 }, bounds, 1.5);
    expect(ratio(clamped)).toBeCloseTo(1.5, 4);
    expect(clamped.width).toBeLessThanOrEqual(bounds.width);
    expect(clamped.height).toBeLessThanOrEqual(bounds.height);
  });

  it('keeps the ratio when one axis alone is edited numerically', () => {
    const edited = clampCrop({ x: 0, y: 0, width: 900, height: 400 }, bounds, 0.75);
    expect(ratio(edited)).toBeCloseTo(0.75, 4);
  });

  it('stays inside the image after shaping', () => {
    for (const aspect of [0.5, 0.75, 1, 1.5, 3]) {
      const clamped = clampCrop({ x: 1100, y: 700, width: 900, height: 900 }, bounds, aspect);
      expect(clamped.x + clamped.width).toBeLessThanOrEqual(bounds.width + 0.001);
      expect(clamped.y + clamped.height).toBeLessThanOrEqual(bounds.height + 0.001);
      expect(ratio(clamped)).toBeCloseTo(aspect, 4);
    }
  });

  it('leaves free-form crops able to fill each axis independently', () => {
    expect(clampCrop({ x: 0, y: 0, width: 2400, height: 1600 }, bounds)).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
  });
});
