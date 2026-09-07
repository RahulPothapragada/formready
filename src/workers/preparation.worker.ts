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

    // Plan against the rotated shape: a quarter turn swaps the aspect ratio,
    // and a ladder built on the unrotated one produces target boxes that
    // `render()` would stretch into.
    const planned = orientedSize(held.width, held.height, request.rotation);

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
