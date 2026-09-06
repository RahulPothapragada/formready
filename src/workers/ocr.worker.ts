/// <reference lib="webworker" />
/**
 * OCR worker. Keeps Tesseract off the main thread so progress and Cancel stay
 * responsive (NFR-03).
 *
 * Asset paths point at `public/models/`, served from the app's own origin, so
 * the offline claim in FR-15 holds after the service worker has cached them.
 * Pointing these at a CDN would silently break offline operation.
 */

import { createWorker, type Worker } from 'tesseract.js';

export interface OcrRequest {
  type: 'recognize';
  jobId: string;
  image: Blob;
}

export interface OcrCancel {
  type: 'cancel';
  jobId: string;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export type OcrResponse =
  | { type: 'progress'; jobId: string; stage: string; progress: number }
  | { type: 'result'; jobId: string; text: string; words: OcrWord[] }
  | { type: 'error'; jobId: string; message: string };

let worker: Worker | null = null;
let activeJobId: string | null = null;

async function getWorker(jobId: string): Promise<Worker> {
  if (worker) return worker;
  worker = await createWorker('eng', 1, {
    workerPath: '/models/tesseract/worker.min.js',
    corePath: '/models/tesseract/',
    langPath: '/models/tesseract/lang',
    // tessdata-fast keeps the offline bundle to a few MB rather than ~20 MB.
    gzip: true,
    logger: (message) => {
      if (activeJobId !== jobId) return;
      post({
        type: 'progress',
        jobId,
        stage: message.status,
        progress: message.progress,
      });
    },
  });
  return worker;
}

function post(response: OcrResponse) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(response);
}

self.onmessage = async (event: MessageEvent<OcrRequest | OcrCancel>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    activeJobId = null;
    return;
  }

  activeJobId = message.jobId;
  try {
    const instance = await getWorker(message.jobId);
    // `blocks` is opt-in and carries the word boxes used for optional image
    // overlays. Text highlighting works from character offsets and does not
    // depend on it.
    const { data } = await instance.recognize(message.image, undefined, {
      text: true,
      blocks: true,
    });

    // A result that arrives after the user moved on is dropped, not posted.
    if (activeJobId !== message.jobId) return;

    const words: OcrWord[] = (data.blocks ?? [])
      .flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .flatMap((line) => line.words)
      .map((word) => ({
        text: word.text,
        // Confidence belongs to OCR metadata only. It is never reused as a
        // probability that the file or the extracted rule is correct.
        confidence: word.confidence,
        bbox: word.bbox,
      }));

    post({ type: 'result', jobId: message.jobId, text: data.text, words });
  } catch (error) {
    if (activeJobId !== message.jobId) return;
    post({
      type: 'error',
      jobId: message.jobId,
      message: error instanceof Error ? error.message : 'OCR failed.',
    });
  }
};
