/**
 * Main-thread client for the OCR worker.
 *
 * OCR failure is an expected outcome, not an exception path: the requirements
 * screen always keeps an editable text area, so a user whose screenshot cannot
 * be read can simply type or paste the instructions instead (FR-02).
 */

import type { OcrRequest, OcrResponse, OcrWord } from '../workers/ocr.worker';

export interface OcrProgress {
  stage: string;
  progress: number;
}

export interface OcrOutcome {
  text: string;
  words: OcrWord[];
}

export interface RecognizeOptions {
  jobId: string;
  onProgress?: (progress: OcrProgress) => void;
  signal?: AbortSignal;
}

let worker: Worker | null = null;

function getWorker(): Worker {
  worker ??= new Worker(new URL('../workers/ocr.worker.ts', import.meta.url), {
    type: 'module',
  });
  return worker;
}

/**
 * A worker that has errored is not reusable, and a failed asset load leaves it
 * unable to recognise anything. Dropping it means the next attempt starts clean.
 */
function discardWorker(): void {
  worker?.terminate();
  worker = null;
}

/**
 * Cold start pulls several megabytes of language data. This is generous enough
 * not to cut off a slow first run, and short enough that a wedged worker does
 * not leave the requirements screen waiting forever.
 */
const OCR_TIMEOUT_MS = 120_000;

/**
 * Recognises text, settling exactly once.
 *
 * Failure here is expected rather than exceptional — the screen always keeps an
 * editable text area — so every path is handled explicitly: a result, a
 * reported error, the worker erroring, an undeserialisable message, a worker
 * that will not construct, a signal already aborted, and a deadline.
 */
export function recognize(image: Blob, options: RecognizeOptions): Promise<OcrOutcome> {
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException('OCR cancelled.', 'AbortError'));
  }

  let instance: Worker;
  try {
    instance = getWorker();
  } catch {
    discardWorker();
    return Promise.reject(new Error('Text recognition could not start on this device.'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (deadline) clearTimeout(deadline);
      instance.removeEventListener('message', onMessage);
      instance.removeEventListener('error', onError);
      instance.removeEventListener('messageerror', onError);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      action();
    };

    const onMessage = (event: MessageEvent<OcrResponse>) => {
      const message = event.data;
      if (message?.jobId !== options.jobId) return;

      if (message.type === 'progress') {
        // Real stage names from Tesseract, not invented percentages.
        options.onProgress?.({ stage: message.stage, progress: message.progress });
        return;
      }

      if (message.type === 'result') {
        finish(() => resolve({ text: message.text, words: message.words }));
      } else {
        finish(() => reject(new Error(message.message)));
      }
    };

    const onError = () => {
      discardWorker();
      finish(() => reject(new Error('Text recognition failed on this device.')));
    };

    const onAbort = () => {
      instance.postMessage({ type: 'cancel', jobId: options.jobId });
      finish(() => reject(new DOMException('OCR cancelled.', 'AbortError')));
    };

    instance.addEventListener('message', onMessage);
    instance.addEventListener('error', onError);
    instance.addEventListener('messageerror', onError);
    options.signal?.addEventListener('abort', onAbort, { once: true });

    deadline = setTimeout(() => {
      discardWorker();
      finish(() => reject(new Error('Text recognition took too long. Paste the instructions instead.')));
    }, OCR_TIMEOUT_MS);

    try {
      instance.postMessage({ type: 'recognize', jobId: options.jobId, image } satisfies OcrRequest);
    } catch {
      discardWorker();
      finish(() => reject(new Error('This screenshot could not be sent for recognition.')));
    }
  });
}

/** Releases the worker and its language data under memory pressure (NFR-05). */
export function releaseOcr(): void {
  discardWorker();
}
