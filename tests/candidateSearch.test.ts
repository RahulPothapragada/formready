import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BUDGET,
  geometryLadder,
  searchCandidates,
  type EncodeFn,
} from '../src/features/preparation/generateCandidates';
import { orientedSize } from '../src/services/imageCodec';
import { UNBOUNDED } from '../src/domain/constraints';
import type { ConfirmedRequirements, Rule } from '../src/domain/types';

/**
 * Synthetic encoder. JPEG size scales with pixel count and quality; PNG ignores
 * quality entirely, which is the behaviour that makes PNG size limits hard.
 * Using a model rather than a real canvas keeps this suite runnable in Node.
 */
function fakeEncoder(jpegFactor = 0.12, pngFactor = 0.9): EncodeFn {
  return async ({ width, height, format, quality }) => {
    const pixels = width * height;
    const byteLength =
      format === 'jpeg'
        ? Math.round(pixels * jpegFactor * (quality ?? 0.5))
        : Math.round(pixels * pngFactor);
    return {
      blob: new Blob([new Uint8Array(1)]),
      metadata: { format, byteLength, width, height },
    };
  };
}

function requirements(rules: Rule[]): ConfirmedRequirements {
  return {
    rules,
    byteConvention: 'decimal',
    manualChecks: [],
    documentKind: 'photo',
    confirmedAt: 0,
  };
}

function size(id: string, operator: 'lt' | 'lte' | 'gt' | 'gte', value: number): Rule {
  return {
    id,
    field: 'fileSize',
    operator,
    value,
    unit: 'KB',
    origin: 'extracted',
    reviewState: 'confirmed',
  };
}

const JPEG_ONLY: Rule = {
  id: 'fmt',
  field: 'format',
  allowed: ['jpeg'],
  origin: 'extracted',
  reviewState: 'confirmed',
};

const PNG_ONLY: Rule = {
  id: 'fmt',
  field: 'format',
  allowed: ['png'],
  origin: 'extracted',
  reviewState: 'confirmed',
};

const clock = () => 0;

describe('geometry ladder', () => {
  it('honours an exact size as a single target', () => {
    const ladder = geometryLadder(800, 920, { min: 200, max: 200 }, { min: 230, max: 230 });
    expect(ladder).toEqual([{ width: 200, height: 230 }]);
  });

  it('preserves the aspect ratio and starts from the largest permitted box', () => {
    const ladder = geometryLadder(1000, 500, { min: null, max: 400 }, { min: null, max: null });
    expect(ladder[0]).toEqual({ width: 400, height: 200 });
    expect(ladder[0].width / ladder[0].height).toBeCloseTo(2);
  });

  it('descends far enough to reach a tight byte budget from a phone photo', () => {
    // A 12 MP source squeezed into ~50 KB lands near 600×800. A ladder that
    // bottoms out around half size never gets there.
    const ladder = geometryLadder(3000, 4000, { min: null, max: null }, { min: null, max: null });
    const smallest = ladder[ladder.length - 1];

    expect(smallest.width).toBeLessThanOrEqual(400);
    expect(smallest.width * smallest.height).toBeLessThan(3000 * 4000 * 0.02);
  });

  it('descends monotonically and keeps the aspect ratio at every step', () => {
    const ladder = geometryLadder(3000, 4000, { min: null, max: null }, { min: null, max: null });

    for (let index = 1; index < ladder.length; index += 1) {
      expect(ladder[index].width).toBeLessThan(ladder[index - 1].width);
      expect(ladder[index].width / ladder[index].height).toBeCloseTo(0.75, 1);
    }
  });

  it('stops descending once a minimum dimension would be breached', () => {
    const ladder = geometryLadder(400, 400, { min: 380, max: 400 }, { min: 380, max: 400 });
    expect(ladder.every((step) => step.width >= 380)).toBe(true);
  });
});

describe('JPEG search', () => {
  it('finds a candidate inside an upper bound', async () => {
    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([JPEG_ONLY, size('max', 'lte', 50)]),
      encode: fakeEncoder(),
      now: clock,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metadata.byteLength).toBeLessThanOrEqual(50_000);
    expect(outcome.result.metadata.format).toBe('jpeg');
  });

  it('respects a two-sided window', async () => {
    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([JPEG_ONLY, size('min', 'gte', 20), size('max', 'lte', 50)]),
      encode: fakeEncoder(),
      now: clock,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metadata.byteLength).toBeGreaterThanOrEqual(20_000);
    expect(outcome.result.metadata.byteLength).toBeLessThanOrEqual(50_000);
  });

  it('treats an exclusive bound as excluding the stated value', async () => {
    const encode = vi.fn(fakeEncoder());
    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([JPEG_ONLY, size('max', 'lt', 50)]),
      encode,
      now: clock,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metadata.byteLength).toBeLessThan(50_000);
  });

  it('finds a candidate for a tight budget from a full phone photo', async () => {
    // The case the device harness caught: 12 MP source, 20–50 KB window, no
    // dimension rules. Only reachable if the ladder descends far enough.
    const outcome = await searchCandidates({
      sourceWidth: 3000,
      sourceHeight: 4000,
      requirements: requirements([JPEG_ONLY, size('min', 'gte', 20), size('max', 'lte', 50)]),
      encode: fakeEncoder(),
      now: clock,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metadata.byteLength).toBeGreaterThanOrEqual(20_000);
    expect(outcome.result.metadata.byteLength).toBeLessThanOrEqual(50_000);
    expect(outcome.attempts).toBeLessThanOrEqual(DEFAULT_BUDGET.maxAttempts);
  });

  it('rejects a hopeless geometry in one attempt rather than bisecting it', async () => {
    const encode = vi.fn(fakeEncoder());
    await searchCandidates({
      sourceWidth: 3000,
      sourceHeight: 4000,
      requirements: requirements([JPEG_ONLY, size('max', 'lte', 50)]),
      encode,
      now: clock,
    });

    // Every call that is not the final bisection run should sit at the quality
    // floor — the cheap probe that proves a geometry cannot work.
    const qualities = encode.mock.calls.map((call) => call[0].quality);
    const floorProbes = qualities.filter((quality) => quality === 0.2).length;
    expect(floorProbes).toBeGreaterThan(1);
  });

  it('bisects rather than sweeping, so it stays well inside the attempt budget', async () => {
    const encode = vi.fn(fakeEncoder());
    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([JPEG_ONLY, size('max', 'lte', 50)]),
      encode,
      now: clock,
    });

    expect(outcome.attempts).toBeLessThanOrEqual(DEFAULT_BUDGET.maxAttempts);
    expect(encode.mock.calls.length).toBeLessThanOrEqual(8);
  });
});

describe('PNG search', () => {
  it('shrinks to fit when the geometry is free to move', async () => {
    // With no dimension rules, PNG can still meet a size limit by getting
    // smaller — geometry is a real lever even though quality is not.
    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([PNG_ONLY, size('max', 'lte', 50)]),
      encode: fakeEncoder(),
      now: clock,
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.metadata.format).toBe('png');
    expect(outcome.result.metadata.byteLength).toBeLessThanOrEqual(50_000);
  });

  it('reports the PNG dead-end when dimensions are pinned', async () => {
    // "PNG, exactly 200 × 230, under 20 KB" — the geometry cannot move and the
    // quality argument does nothing, so no file satisfies this.
    const exact: Rule[] = [
      {
        id: 'w',
        field: 'width',
        operator: 'eq',
        value: 200,
        unit: 'px',
        origin: 'extracted',
        reviewState: 'confirmed',
      },
      {
        id: 'h',
        field: 'height',
        operator: 'eq',
        value: 230,
        unit: 'px',
        origin: 'extracted',
        reviewState: 'confirmed',
      },
    ];

    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([PNG_ONLY, size('max', 'lte', 20), ...exact]),
      encode: fakeEncoder(),
      now: clock,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('png-size-not-controllable');
    expect(outcome.failure.suggestions).toContain('review-requirements');
    // One geometry, one attempt — there is nothing else to try.
    expect(outcome.attempts).toBe(1);
  });

  it('prefers JPEG when both formats are allowed, since only it has a size lever', async () => {
    const encode = vi.fn(fakeEncoder());
    const both: Rule = { ...JPEG_ONLY, allowed: ['png', 'jpeg'] };
    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([both, size('max', 'lte', 50)]),
      encode,
      now: clock,
    });

    expect(outcome.ok).toBe(true);
    expect(encode.mock.calls[0][0].format).toBe('jpeg');
  });
});

describe('rotation-aware planning', () => {
  it('swaps the source shape for a quarter turn', () => {
    // A 3000×4000 portrait rotated 90° is a 4000×3000 landscape. Planning
    // against the unrotated shape yields target boxes with the wrong aspect
    // ratio, which render() would then stretch into.
    expect(orientedSize(3000, 4000, 90)).toEqual({ width: 4000, height: 3000 });
    expect(orientedSize(3000, 4000, 270)).toEqual({ width: 4000, height: 3000 });
  });

  it('leaves the shape alone for half turns and no rotation', () => {
    expect(orientedSize(3000, 4000, 0)).toEqual({ width: 3000, height: 4000 });
    expect(orientedSize(3000, 4000, 180)).toEqual({ width: 3000, height: 4000 });
  });

  it('produces a ladder matching the rotated aspect ratio', () => {
    const rotated = orientedSize(3000, 4000, 90);
    const ladder = geometryLadder(rotated.width, rotated.height, { min: null, max: 800 }, UNBOUNDED);

    expect(ladder[0].width).toBeGreaterThan(ladder[0].height);
    expect(ladder[0].width / ladder[0].height).toBeCloseTo(4 / 3, 1);
  });
});

describe('attempt reporting', () => {
  it('reports every attempt in order, with no gaps', async () => {
    const seen: number[] = [];
    const outcome = await searchCandidates({
      sourceWidth: 3000,
      sourceHeight: 4000,
      requirements: requirements([JPEG_ONLY, size('max', 'lte', 50)]),
      encode: fakeEncoder(),
      now: clock,
      onAttempt: (attempts) => seen.push(attempts),
    });

    expect(seen).toEqual(Array.from({ length: seen.length }, (_, index) => index + 1));
    expect(seen[seen.length - 1]).toBe(outcome.attempts);
  });

  it('reports nothing when the rules are contradictory and no encode happens', async () => {
    const seen: number[] = [];
    await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([size('min', 'gte', 100), size('max', 'lte', 50)]),
      encode: fakeEncoder(),
      now: clock,
      onAttempt: (attempts) => seen.push(attempts),
    });

    expect(seen).toEqual([]);
  });
});

describe('failure reporting', () => {
  it('names a contradiction before spending any attempt on encoding', async () => {
    const encode = vi.fn(fakeEncoder());
    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([size('min', 'gte', 100), size('max', 'lte', 50)]),
      encode,
      now: clock,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('geometry-conflict');
    expect(encode).not.toHaveBeenCalled();
  });

  it('distinguishes an unreachable minimum from a generic failure', async () => {
    // A tiny source cannot be made to exceed a large minimum size.
    const outcome = await searchCandidates({
      sourceWidth: 40,
      sourceHeight: 40,
      requirements: requirements([JPEG_ONLY, size('min', 'gte', 500)]),
      encode: fakeEncoder(),
      now: clock,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('min-size-unreachable');
    expect(outcome.failure.suggestions).toContain('choose-clearer-image');
  });

  it('stops at the attempt budget and says so, rather than searching forever', async () => {
    const outcome = await searchCandidates({
      sourceWidth: 5000,
      sourceHeight: 5000,
      requirements: requirements([JPEG_ONLY, size('max', 'lte', 1)]),
      encode: fakeEncoder(),
      budget: { maxAttempts: 3, maxMillis: 12_000 },
      now: clock,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.attempts).toBeLessThanOrEqual(3);
    expect(outcome.failure.kind).toBe('no-candidate-in-budget');
  });

  it('stops at the time budget', async () => {
    let ticks = 0;
    const outcome = await searchCandidates({
      sourceWidth: 5000,
      sourceHeight: 5000,
      requirements: requirements([JPEG_ONLY, size('max', 'lte', 1)]),
      encode: fakeEncoder(),
      budget: { maxAttempts: 999, maxMillis: 100 },
      now: () => (ticks += 40),
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toBeLessThan(10);
  });

  it('reports cancellation distinctly from failure', async () => {
    const controller = new AbortController();
    controller.abort();

    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      requirements: requirements([JPEG_ONLY, size('max', 'lte', 50)]),
      encode: fakeEncoder(),
      signal: controller.signal,
      now: clock,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('cancelled');
  });
});
