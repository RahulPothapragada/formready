/**
 * Bounded search for an encoding that satisfies the confirmed rules.
 *
 * Design notes:
 *
 * - JPEG byte size is close enough to monotonic in the quality parameter that a
 *   bisection finds a byte target in ~7 attempts. A linear sweep spends the
 *   whole budget on one geometry; bisecting leaves room to try several.
 * - PNG has no quality lever — the canvas APIs ignore the argument entirely —
 *   so geometry is the only control, and some size windows are simply
 *   unreachable. That case gets its own failure kind rather than a generic one.
 * - Geometries are tried largest first, which implements the "prefer retained
 *   resolution" heuristic in section 7.8 without needing a scoring pass.
 *
 * The encode step is injected so the whole search can be tested in Node against
 * a synthetic size model, with no canvas involved.
 */

import {
  allowedFormats,
  dimensionBounds,
  isImpossible,
  satisfies,
  sizeBounds,
  type Bounds,
} from '../../domain/constraints';
import { fitWithinAspect } from '../../services/imageCodec';
import type {
  CandidateMetadata,
  ConfirmedRequirements,
  ImageFormat,
  PreparationFailure,
} from '../../domain/types';

export interface SearchBudget {
  maxAttempts: number;
  maxMillis: number;
}

/**
 * Starting points to measure on the target phone during work package 1, not
 * achieved timings.
 */
export const DEFAULT_BUDGET: SearchBudget = { maxAttempts: 24, maxMillis: 12_000 };

export interface EncodeRequest {
  width: number;
  height: number;
  format: ImageFormat;
  /** JPEG only; omitted for PNG. */
  quality?: number;
}

export interface EncodeResult {
  blob: Blob;
  metadata: CandidateMetadata;
}

export type EncodeFn = (request: EncodeRequest) => Promise<EncodeResult>;

export interface SearchContext {
  sourceWidth: number;
  sourceHeight: number;
  requirements: ConfirmedRequirements;
  encode: EncodeFn;
  budget?: SearchBudget;
  now?: () => number;
  signal?: AbortSignal;
}

export type SearchOutcome =
  | { ok: true; result: EncodeResult; attempts: number }
  | { ok: false; failure: PreparationFailure; attempts: number };

const QUALITY_FLOOR = 0.2;
const QUALITY_CEILING = 0.95;
const BISECTION_STEPS = 7;

/**
 * Candidate output sizes, largest first.
 *
 * An exact width and height is honoured as given — the crop screen has already
 * made the user approve any aspect-ratio change, so this is not a silent
 * stretch. Otherwise the aspect ratio is preserved and the image is only ever
 * scaled down.
 */
export function geometryLadder(
  sourceWidth: number,
  sourceHeight: number,
  width: Bounds,
  height: Bounds,
): Array<{ width: number; height: number }> {
  if (width.min !== null && width.min === width.max && height.min !== null && height.min === height.max) {
    return [{ width: width.min, height: height.min }];
  }

  const start = fitWithinAspect(sourceWidth, sourceHeight, width.max, height.max);
  const ladder: Array<{ width: number; height: number }> = [];

  // Six steps of ~12% linear reduction reaches roughly a quarter of the
  // original pixel count, which covers most real size limits.
  for (let step = 0; step < 6; step += 1) {
    const scale = Math.pow(0.88, step);
    const candidate = {
      width: Math.max(1, Math.round(start.width * scale)),
      height: Math.max(1, Math.round(start.height * scale)),
    };
    if (width.min !== null && candidate.width < width.min) break;
    if (height.min !== null && candidate.height < height.min) break;
    ladder.push(candidate);
  }

  return ladder.length > 0 ? ladder : [start];
}

function compliant(metadata: CandidateMetadata, size: Bounds, formats: ImageFormat[] | null): boolean {
  if (formats !== null && !formats.includes(metadata.format)) return false;
  return satisfies(metadata.byteLength, size);
}

function failure(
  kind: PreparationFailure['kind'],
  message: string,
  suggestions: PreparationFailure['suggestions'],
): PreparationFailure {
  return { kind, message, suggestions };
}

export async function searchCandidates(context: SearchContext): Promise<SearchOutcome> {
  const { sourceWidth, sourceHeight, requirements, encode } = context;
  const budget = context.budget ?? DEFAULT_BUDGET;
  const now = context.now ?? (() => performance.now());
  const startedAt = now();

  let attempts = 0;
  const exhausted = () =>
    attempts >= budget.maxAttempts || now() - startedAt >= budget.maxMillis;

  const size = sizeBounds(requirements.rules, requirements.byteConvention);
  const width = dimensionBounds(requirements.rules, 'width');
  const height = dimensionBounds(requirements.rules, 'height');
  const formats = allowedFormats(requirements.rules);

  if (isImpossible(size) || isImpossible(width) || isImpossible(height)) {
    return {
      ok: false,
      attempts,
      failure: failure(
        'geometry-conflict',
        'These requirements contradict each other, so no file can satisfy them.',
        ['review-requirements'],
      ),
    };
  }

  // Try JPEG before PNG when both are allowed: it is the only one of the two
  // whose file size can be tuned without changing the pixel dimensions.
  const candidateFormats: ImageFormat[] = formats ?? ['jpeg'];
  const ordered = [...candidateFormats].sort((a, b) => (a === 'jpeg' ? -1 : b === 'jpeg' ? 1 : 0));
  const ladder = geometryLadder(sourceWidth, sourceHeight, width, height);

  let sawTooLarge = false;
  let sawTooSmall = false;

  for (const format of ordered) {
    for (const geometry of ladder) {
      if (context.signal?.aborted) {
        return {
          ok: false,
          attempts,
          failure: failure('cancelled', 'Preparation was cancelled.', []),
        };
      }
      if (exhausted()) break;

      if (format === 'png') {
        attempts += 1;
        const result = await encode({ ...geometry, format });
        if (compliant(result.metadata, size, formats)) return { ok: true, result, attempts };
        if (size.max !== null && result.metadata.byteLength > size.max) sawTooLarge = true;
        if (size.min !== null && result.metadata.byteLength < size.min) sawTooSmall = true;
        continue;
      }

      // Bisect quality for the largest file that still fits the upper bound.
      let low = QUALITY_FLOOR;
      let high = QUALITY_CEILING;
      let best: EncodeResult | null = null;

      for (let step = 0; step < BISECTION_STEPS && !exhausted(); step += 1) {
        const quality = Number(((low + high) / 2).toFixed(3));
        attempts += 1;
        const result = await encode({ ...geometry, format, quality });

        if (compliant(result.metadata, size, formats)) {
          // Keep searching upward: a compliant larger file retains more detail.
          best = result;
          low = quality;
          continue;
        }

        if (size.max !== null && result.metadata.byteLength > size.max) {
          sawTooLarge = true;
          high = quality;
        } else {
          sawTooSmall = true;
          low = quality;
        }
      }

      if (best) return { ok: true, result: best, attempts };
    }
  }

  if (ordered.every((format) => format === 'png') && (sawTooLarge || sawTooSmall)) {
    return {
      ok: false,
      attempts,
      failure: failure(
        'png-size-not-controllable',
        'PNG file size can only be changed by changing the image size, and no permitted size fits this limit. Allowing JPEG, or widening the size limit, would give more room.',
        ['review-requirements', 'adjust-crop'],
      ),
    };
  }

  if (sawTooSmall && !sawTooLarge && size.min !== null) {
    return {
      ok: false,
      attempts,
      failure: failure(
        'min-size-unreachable',
        'Every version of this image came out smaller than the required minimum. A larger or more detailed source image would help.',
        ['choose-clearer-image', 'review-requirements'],
      ),
    };
  }

  return {
    ok: false,
    attempts,
    failure: failure(
      'no-candidate-in-budget',
      "We couldn't find a suitable file with these settings.",
      ['adjust-crop', 'review-requirements', 'choose-clearer-image'],
    ),
  };
}
