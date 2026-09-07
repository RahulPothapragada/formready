/// <reference lib="webworker" />
/**
 * Preparation worker.
 *
 * `render()` is synchronous canvas work and a 12 MP source takes hundreds of
 * milliseconds per attempt. Running the search on the main thread blocks the UI
 * and — worse — makes Cancel unresponsive precisely while the user most wants
 * it, which NFR-03 does not allow. Everything from decode to verification
 * happens here instead.
 *
 * Verification stays inside the worker. FR-09's independence is about reading
 * the produced bytes rather than the encoder's parameters, not about which
 * thread does the reading, so the property is preserved.
 */

import { searchCandidates, type SearchBudget } from '../features/preparation/generateCandidates';
import { decode, encode, orientedSize, render } from '../services/imageCodec';
import { measure } from '../services/verifier';
import type {
  CandidateMetadata,
  ConfirmedRequirements,
  CropRect,
  PreparationFailure,
} from '../domain/types';

export type PrepareStage = 'decoding' | 'searching' | 'verifying';

export interface PrepareRequest {
  type: 'prepare';
  /** Unique per run, so a late reply can be matched to the run that made it. */
  runId: string;
  jobRevision: number;
  source: Blob;
  crop: CropRect | null;
  rotation: 0 | 90 | 180 | 270;
  requirements: ConfirmedRequirements;
  budget?: SearchBudget;
}

export interface PrepareCancel {
  type: 'cancel';
  runId: string;
}

export type PrepareResponse =
  | { type: 'progress'; runId: string; jobRevision: number; stage: PrepareStage; attempts: number }
  | {
      type: 'result';
      runId: string;
      jobRevision: number;
      blob: Blob;
      metadata: CandidateMetadata;
      attempts: number;
    }
  | { type: 'failure'; runId: string; jobRevision: number; failure: PreparationFailure };

/** Raised when a target box would distort the approved crop. */
class StretchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StretchError';
  }
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

let activeRunId: string | null = null;
let activeController: AbortController | null = null;

function post(response: PrepareResponse) {
  // Never speak for a run that has been superseded or cancelled.
  if (response.runId !== activeRunId) return;
  scope.postMessage(response);
}

async function prepare(request: PrepareRequest): Promise<void> {
  const { runId, jobRevision, requirements } = request;
  const controller = new AbortController();
  activeRunId = runId;
  activeController = controller;

  let bitmap: ImageBitmap | null = null;

  try {
    post({ type: 'progress', runId, jobRevision, stage: 'decoding', attempts: 0 });
    bitmap = await decode(request.source);
    const held = bitmap;

    // Plan against what will actually be encoded: the *cropped* region, after
    // rotation. Planning from the whole image gives target boxes with the
    // uncropped aspect ratio — a 600x600 crop of a 1200x800 photo was planned
    // as 600x400 — and `render()` then stretches the crop to fill them.
    const cropped = request.crop
      ? { width: request.crop.width, height: request.crop.height }
      : { width: held.width, height: held.height };
    const planned = orientedSize(cropped.width, cropped.height, request.rotation);

    post({ type: 'progress', runId, jobRevision, stage: 'searching', attempts: 0 });

    const outcome = await searchCandidates({
      sourceWidth: planned.width,
      sourceHeight: planned.height,
      requirements,
      budget: request.budget,
      signal: controller.signal,
      onAttempt: (attempts) =>
        post({ type: 'progress', runId, jobRevision, stage: 'searching', attempts }),
      encode: async (encodeRequest) => {
        // FR-07: the output must keep the shape the user approved. If a target
        // box would distort it, that is a decision for the user to make on the
        // crop screen, not something to absorb here.
        const requested = encodeRequest.width / encodeRequest.height;
        const approved = planned.width / planned.height;
        if (Math.abs(requested - approved) / approved > 0.01) {
          throw new StretchError(
            `Meeting these dimensions would change the shape of your image (${encodeRequest.width}x${encodeRequest.height} from ${Math.round(planned.width)}x${Math.round(planned.height)}). Adjust the crop to match.`,
          );
        }

        const canvas = render({
          bitmap: held,
          crop: request.crop,
          rotation: request.rotation,
          targetWidth: encodeRequest.width,
          targetHeight: encodeRequest.height,
        });
        const blob = await encode(canvas, encodeRequest.format, encodeRequest.quality);
        // Measured from the produced bytes, never from `encodeRequest`.
        return { blob, metadata: await measure(blob) };
      },
    });

    if (controller.signal.aborted) return;

    if (!outcome.ok) {
      post({ type: 'failure', runId, jobRevision, failure: outcome.failure });
      return;
    }

    post({
      type: 'progress',
      runId,
      jobRevision,
      stage: 'verifying',
      attempts: outcome.attempts,
    });

    post({
      type: 'result',
      runId,
      jobRevision,
      blob: outcome.result.blob,
      metadata: outcome.result.metadata,
      attempts: outcome.attempts,
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error instanceof StretchError) {
      post({
        type: 'failure',
        runId,
        jobRevision,
        failure: { kind: 'geometry-conflict', message: error.message, suggestions: ['adjust-crop'] },
      });
      return;
    }
    post({
      type: 'failure',
      runId,
      jobRevision,
      failure: {
        kind: 'decode-failed',
        message:
          error instanceof Error
            ? error.message
            : 'This image could not be prepared on this device.',
        suggestions: ['choose-clearer-image'],
      },
    });
  } finally {
    // Decoded bitmaps hold full pixel buffers; on a phone these add up fast.
    bitmap?.close();
    if (activeRunId === runId) {
      activeRunId = null;
      activeController = null;
    }
  }
}

scope.onmessage = (event: MessageEvent<PrepareRequest | PrepareCancel>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    if (activeRunId === message.runId) {
      activeController?.abort();
      activeRunId = null;
      activeController = null;
    }
    return;
  }

  // A new run supersedes whatever is in flight.
  activeController?.abort();
  void prepare(message);
};
