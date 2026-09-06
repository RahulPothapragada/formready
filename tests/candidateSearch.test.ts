import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BUDGET,
  geometryLadder,
  searchCandidates,
  type EncodeFn,
} from '../src/features/preparation/generateCandidates';
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
  it('reports that PNG size cannot be tuned when no geometry fits', async () => {
    const outcome = await searchCandidates({
      sourceWidth: 800,
      sourceHeight: 920,
      // PNG at any permitted size is far above 50 KB with this encoder.
      requirements: requirements([PNG_ONLY, size('max', 'lte', 50)]),
      encode: fakeEncoder(),
      now: clock,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failure.kind).toBe('png-size-not-controllable');
    expect(outcome.failure.suggestions).toContain('review-requirements');
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
