/**
 * Getting the verified file out of the app.
 *
 * Download is always available. Web Share is offered only when the browser
 * actually reports it can share this file, so the button never appears and then
 * fails (P1, spec section 3).
 */

import { EXTENSION_BY_FORMAT } from './imageCodec';
import type { Candidate, DocumentKind } from '../domain/types';

export type ExportMethod = 'download' | 'share';

export interface ExportOutcome {
  method: ExportMethod;
  filename: string;
}

const KIND_LABEL: Record<DocumentKind, string> = {
  photo: 'photo',
  signature: 'signature',
  printed: 'document',
  other: 'file',
};

/**
 * Names the file after its *decoded* format, so a JPEG never leaves the app
 * with a `.png` extension (FR-13).
 */
export function buildFilename(candidate: Candidate, kind: DocumentKind, stamp: string): string {
  return `formready-${KIND_LABEL[kind]}-${stamp}.${EXTENSION_BY_FORMAT[candidate.metadata.format]}`;
}

export function canShare(blob: Blob, filename: string): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] });
  } catch {
    return false;
  }
}

export async function download(blob: Blob, filename: string): Promise<ExportOutcome> {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { method: 'download', filename };
  } finally {
    // Revoked on the next frame: revoking synchronously can cancel the
    // download in some mobile browsers before it starts.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }
}

export async function share(blob: Blob, filename: string): Promise<ExportOutcome> {
  const file = new File([blob], filename, { type: blob.type });
  await navigator.share({ files: [file], title: filename });
  return { method: 'share', filename };
}
