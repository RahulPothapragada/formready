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

export function prepareCandidate(options: PrepareOptions): Promise<PrepareOutcome> {
  const instance = getWorker();
  const runId = crypto.randomUUID();

  return new Promise((resolve) => {
    const cleanup = () => {
      instance.removeEventListener('message', onMessage);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const onMessage = (event: MessageEvent<PrepareResponse>) => {
      const message = event.data;
      if (message.runId !== runId) return;

      if (message.type === 'progress') {
        options.onProgress?.({ stage: message.stage, attempts: message.attempts });
        return;
      }

      cleanup();
      if (message.type === 'result') {
        resolve({
          ok: true,
          blob: message.blob,
          metadata: message.metadata,
          attempts: message.attempts,
        });
      } else {
        resolve({ ok: false, failure: message.failure });
      }
    };

    const onAbort = () => {
      instance.postMessage({ type: 'cancel', runId } satisfies PrepareCancel);
      cleanup();
      // Cancellation is an outcome, not an error: the caller returns the user to
      // a recoverable state with the original and the rules intact.
      resolve({
        ok: false,
        failure: { kind: 'cancelled', message: 'Preparation was cancelled.', suggestions: [] },
      });
    };

    instance.addEventListener('message', onMessage);
    options.signal?.addEventListener('abort', onAbort, { once: true });

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
  });
}

/** Releases the worker under memory pressure (NFR-05). */
export function releasePreparation(): void {
  worker?.terminate();
  worker = null;
}
