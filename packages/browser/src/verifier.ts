/**
 * Independent verification of produced bytes (FR-09).
 *
 * This module deliberately accepts a Blob and nothing else. It does not receive
 * the encoder settings that were requested, because a report built from
 * requested settings restates intent rather than checking the result. Every
 * number below comes from re-reading the file the user is about to download.
 */

import { buildValidationReport } from '@formready/engine';
import type {
  Candidate,
  CandidateMetadata,
  ConfirmedRequirements,
  ValidationReport,
} from '@formready/engine';
import { UnsupportedImageError, asBlob, decode, readFormat } from './imaging';

/** Reads format, byte count, and pixel dimensions from the bytes themselves. */
export async function measure(blob: Blob): Promise<CandidateMetadata> {
  const format = await readFormat(blob);
  if (!format) {
    throw new UnsupportedImageError('The prepared file is not a readable JPEG or PNG.');
  }

  const bitmap = await decode(blob);
  try {
    return {
      format,
      byteLength: blob.size,
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    // Bitmaps hold decoded pixel buffers; on a phone these add up fast (NFR-05).
    bitmap.close();
  }
}

/**
 * Produces the checklist shown on the review screen.
 *
 * `checkedAt` is passed in rather than read from the clock so the report is
 * reproducible in tests.
 */
export async function verify(
  candidate: Omit<Candidate, 'metadata'>,
  requirements: ConfirmedRequirements,
  checkedAt: number,
): Promise<{ candidate: Candidate; report: ValidationReport }> {
  const metadata = await measure(asBlob(candidate.blob));
  const verified: Candidate = { ...candidate, metadata };
  return {
    candidate: verified,
    report: buildValidationReport(verified, requirements, checkedAt),
  };
}

/**
 * Last check before the bytes leave the app (NFR-09).
 *
 * Re-decodes the candidate and confirms it still measures the way the report
 * says it does. The report is what the user was shown and what the export gate
 * was opened on; this makes sure the file being handed over is the file that
 * was described, rather than trusting that nothing swapped underneath.
 */
export async function stillMatchesReport(candidate: Candidate): Promise<boolean> {
  try {
    const measured = await measure(asBlob(candidate.blob));
    return (
      measured.format === candidate.metadata.format &&
      measured.byteLength === candidate.metadata.byteLength &&
      measured.width === candidate.metadata.width &&
      measured.height === candidate.metadata.height
    );
  } catch {
    return false;
  }
}

/**
 * Post-export integrity check (NFR-09): re-reads what actually left the app and
 * confirms it is byte-identical to what was verified.
 */
export async function matchesVerifiedCandidate(
  exported: Blob,
  candidate: Candidate,
): Promise<boolean> {
  if (exported.size !== candidate.metadata.byteLength) return false;
  const [a, b] = await Promise.all([exported.arrayBuffer(), asBlob(candidate.blob).arrayBuffer()]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  return left.length === right.length && left.every((byte, i) => byte === right[i]);
}
