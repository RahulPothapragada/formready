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

export function recognize(image: Blob, options: RecognizeOptions): Promise<OcrOutcome> {
  const instance = getWorker();

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      instance.removeEventListener('message', onMessage);
      options.signal?.removeEventListener('abort', onAbort);
    };

    const onMessage = (event: MessageEvent<OcrResponse>) => {
      const message = event.data;
      if (message.jobId !== options.jobId) return;

      if (message.type === 'progress') {
        // Real stage names from Tesseract, not invented percentages.
        options.onProgress?.({ stage: message.stage, progress: message.progress });
        return;
      }

      cleanup();
      if (message.type === 'result') {
        resolve({ text: message.text, words: message.words });
      } else {
        reject(new Error(message.message));
      }
    };

    const onAbort = () => {
      const cancel: OcrRequest | { type: 'cancel'; jobId: string } = {
        type: 'cancel',
        jobId: options.jobId,
      };
      instance.postMessage(cancel);
      cleanup();
      reject(new DOMException('OCR cancelled.', 'AbortError'));
    };

    instance.addEventListener('message', onMessage);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    instance.postMessage({ type: 'recognize', jobId: options.jobId, image } satisfies OcrRequest);
  });
}

/** Releases the worker and its language data under memory pressure (NFR-05). */
export function releaseOcr(): void {
  worker?.terminate();
  worker = null;
}
