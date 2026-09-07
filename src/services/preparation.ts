/**
 * Main-thread client for the preparation worker.
 *
 * Mirrors services/ocr.ts: one long-lived worker, requests tagged with a run id,
 * and replies matched by that id so a result from a superseded run is dropped
 * rather than shown.
 */

import type {
  PrepareCancel,
  PrepareRequest,
  PrepareResponse,
  PrepareStage,
} from '../workers/preparation.worker';
import type { SearchBudget } from '../features/preparation/generateCandidates';
import type {
  CandidateMetadata,
  ConfirmedRequirements,
  CropRect,
  PreparationFailure,
} from '../domain/types';

export type { PrepareStage };

export interface PrepareProgress {
  stage: PrepareStage;
  /** Real encode attempts so far, never a synthesised percentage. */
  attempts: number;
}

export interface PrepareOptions {
  jobRevision: number;
  source: Blob;
  crop: CropRect | null;
  rotation: 0 | 90 | 180 | 270;
  requirements: ConfirmedRequirements;
  budget?: SearchBudget;
  onProgress?: (progress: PrepareProgress) => void;
  signal?: AbortSignal;
}

export type PrepareOutcome =
  | { ok: true; blob: Blob; metadata: CandidateMetadata; attempts: number }
  | { ok: false; failure: PreparationFailure };

let worker: Worker | null = null;

function getWorker(): Worker {
  worker ??= new Worker(new URL('../workers/preparation.worker.ts', import.meta.url), {
    type: 'module',
  });
  return worker;
}

/**
 * A worker that has errored cannot be trusted for the next run, so it is
 * dropped and a fresh one built on demand.
 */
function discardWorker(): void {
  worker?.terminate();
  worker = null;
}

/** Nothing should sit on the Prepare screen indefinitely. */
const PREPARE_TIMEOUT_MS = 90_000;

function failure(kind: PreparationFailure['kind'], message: string): PrepareOutcome {
  return {
    ok: false,
    failure: {
      kind,
      message,
      suggestions: kind === 'cancelled' ? [] : ['adjust-crop', 'choose-clearer-image'],
    },
  };
}

/**
 * Runs one preparation, settling exactly once.
 *
 * Every way this can end is handled: a result, a reported failure, the worker
 * erroring, a message that cannot be deserialised, the worker failing to
 * construct at all, an abort that arrived before the call, and a deadline. Any
 * of them left unhandled leaves the Prepare screen showing progress forever,
 * with no path out but a reload.
 */
export function prepareCandidate(options: PrepareOptions): Promise<PrepareOutcome> {
  if (options.signal?.aborted) {
    return Promise.resolve(failure('cancelled', 'Preparation was cancelled.'));
  }

  let instance: Worker;
  try {
    instance = getWorker();
  } catch {
    discardWorker();
    return Promise.resolve(
      failure('decode-failed', 'The file preparer could not start on this device.'),
    );
  }

  const runId = crypto.randomUUID();

  return new Promise((resolve) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;

    const settle = (outcome: PrepareOutcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    };

    const cleanup = () => {
      if (deadline) clearTimeout(deadline);
      instance.removeEventListener('message', onMessage);
      instance.removeEventListener('error', onError);
      instance.removeEventListener('messageerror', onMessageError);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const onMessage = (event: MessageEvent<PrepareResponse>) => {
      const message = event.data;
      if (message?.runId !== runId) return;

      if (message.type === 'progress') {
        options.onProgress?.({ stage: message.stage, attempts: message.attempts });
        return;
      }

      if (message.type === 'result') {
        settle({
          ok: true,
          blob: message.blob,
          metadata: message.metadata,
          attempts: message.attempts,
        });
        return;
      }

      settle({ ok: false, failure: message.failure });
    };

    const onError = () => {
      discardWorker();
      settle(failure('decode-failed', 'Preparing the file failed unexpectedly. Try again.'));
    };

    const onMessageError = () => {
      discardWorker();
      settle(failure('decode-failed', 'The prepared file could not be read back. Try again.'));
    };

    const onAbort = () => {
      instance.postMessage({ type: 'cancel', runId } satisfies PrepareCancel);
      // Cancellation is an outcome, not an error: the caller returns the user to
      // a recoverable state with the original and the rules intact.
      settle(failure('cancelled', 'Preparation was cancelled.'));
    };

    instance.addEventListener('message', onMessage);
    instance.addEventListener('error', onError);
    instance.addEventListener('messageerror', onMessageError);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    deadline = setTimeout(() => {
      discardWorker();
      settle(
        failure(
          'no-candidate-in-budget',
          'Preparing this file is taking longer than expected. Try a smaller image.',
        ),
      );
    }, PREPARE_TIMEOUT_MS);

    try {
      instance.postMessage({
        type: 'prepare',
        runId,
        jobRevision: options.jobRevision,
        source: options.source,
        crop: options.crop,
        rotation: options.rotation,
        requirements: options.requirements,
        budget: options.budget,
      } satisfies PrepareRequest);
    } catch {
      discardWorker();
      settle(failure('decode-failed', 'This image could not be sent for preparation.'));
    }
  });
}

/** Releases the worker under memory pressure (NFR-05). */
export function releasePreparation(): void {
  discardWorker();
}
