/**
 * Turning a live job into something that can be stored, and back again.
 *
 * Kept pure and separate from the storage layer so the rules about what may
 * survive a reload are testable without a browser.
 *
 * Two of those rules matter:
 *
 *   - A snapshot carries a version. When the shape of a job changes, an old
 *     snapshot is discarded rather than half-read; restoring a job with fields
 *     the current code does not understand is worse than starting again.
 *   - `PREPARING` never survives. It describes work that was in flight, and
 *     after a reload that work is gone. Restoring it would leave the Prepare
 *     screen waiting on a worker that does not exist.
 */

import type { Job, JobStatus } from '../types';

/** Bump whenever the Job shape changes in a way old snapshots cannot satisfy. */
export const SNAPSHOT_VERSION = 1;

export interface JobSnapshot {
  version: number;
  savedAt: number;
  job: Job;
}

export function toSnapshot(job: Job, savedAt: number): JobSnapshot {
  return { version: SNAPSHOT_VERSION, savedAt, job };
}

/** Statuses that describe work in progress rather than a resting state. */
const TRANSIENT: Partial<Record<JobStatus, JobStatus>> = {
  PREPARING: 'DOCUMENT_READY',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Enough of a shape check to be confident the object came from this app and
 * this version of it. Deliberately shallow: the version gate is what protects
 * against structural drift, and a deep validation of a type containing Blobs
 * buys little beyond it.
 */
function looksLikeJob(value: unknown): value is Job {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.revision === 'number' &&
    typeof value.status === 'string' &&
    Array.isArray(value.proposedRules) &&
    Array.isArray(value.proposedManualChecks)
  );
}

/**
 * Restores a job from a stored snapshot, or returns `null` if the snapshot is
 * missing, from another version, or not a job at all. A `null` means "start
 * fresh", never an error the user has to deal with.
 */
export function fromSnapshot(value: unknown): Job | null {
  if (!isRecord(value)) return null;
  if (value.version !== SNAPSHOT_VERSION) return null;
  if (!looksLikeJob(value.job)) return null;

  const job = value.job;
  const status = TRANSIENT[job.status] ?? job.status;

  // A run that was interrupted leaves no candidate and no failure to show —
  // the user simply prepares again.
  const interrupted = status !== job.status;

  return {
    ...job,
    status,
    candidate: interrupted ? null : job.candidate,
    report: interrupted ? null : job.report,
    review: interrupted ? null : job.review,
    failure: interrupted ? null : job.failure,
  };
}

/** Nothing worth keeping yet — avoids writing an empty job on first load. */
export function isWorthSaving(job: Job): boolean {
  return job.instructionSource !== null || job.source !== null || job.proposedRules.length > 0;
}

/** Human-readable summary for the "saved" indicator. */
export function describeSnapshot(job: Job): string {
  if (job.candidate) return 'prepared file';
  if (job.source) return 'document';
  if (job.confirmed) return 'confirmed requirements';
  return 'requirements';
}
