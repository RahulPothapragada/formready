/**
 * Job state machine (section 10 of the specification).
 *
 * The reducer is pure — ids and timestamps arrive on actions rather than being
 * generated here, so every transition is reproducible in a test.
 *
 * One invariant does most of the work: any change to the source document, the
 * approved crop, or the confirmed rules bumps `revision` and drops the
 * candidate, its report, and the user's review. Downstream code compares
 * revisions instead of trying to reason about which edits invalidate what.
 */

import type {
  ByteConvention,
  Candidate,
  ConfirmedRequirements,
  CropRect,
  DocumentKind,
  InstructionSource,
  Job,
  ManualCheck,
  PreparationFailure,
  Rule,
  SourceDocument,
  TransformPlan,
  UserReview,
  ValidationReport,
} from '../types';

export function createJob(id: string): Job {
  return {
    id,
    revision: 0,
    status: 'EMPTY',
    documentKind: 'photo',
    instructionSource: null,
    proposedRules: [],
    proposedManualChecks: [],
    byteConvention: 'decimal',
    confirmed: null,
    source: null,
    transform: null,
    candidate: null,
    report: null,
    review: null,
    failure: null,
  };
}

export type JobAction =
  | { type: 'ADD_INSTRUCTIONS'; source: InstructionSource }
  | { type: 'EDIT_INSTRUCTION_TEXT'; text: string }
  | { type: 'SET_PROPOSALS'; rules: Rule[]; manualChecks: ManualCheck[] }
  | { type: 'UPDATE_RULE'; rule: Rule }
  | { type: 'REMOVE_RULE'; ruleId: string }
  | { type: 'SET_BYTE_CONVENTION'; convention: ByteConvention }
  | { type: 'SET_DOCUMENT_KIND'; kind: DocumentKind }
  | { type: 'CONFIRM_REQUIREMENTS'; confirmedAt: number }
  | { type: 'REOPEN_REQUIREMENTS' }
  | { type: 'SET_SOURCE_DOCUMENT'; source: SourceDocument }
  | { type: 'APPROVE_GEOMETRY'; crop: CropRect | null; rotation: 0 | 90 | 180 | 270 }
  | { type: 'START_PREPARATION'; transform: TransformPlan }
  | { type: 'PREPARATION_SUCCEEDED'; candidate: Candidate; report: ValidationReport }
  | { type: 'PREPARATION_FAILED'; jobRevision: number; failure: PreparationFailure }
  | { type: 'CANCEL_PREPARATION' }
  | { type: 'SET_USER_REVIEW'; review: UserReview }
  | { type: 'MARK_EXPORTED' }
  | { type: 'CLEAR_JOB'; nextId: string }
  /** Replaces state wholesale with a job read back from device storage. */
  | { type: 'RESTORE_JOB'; job: Job };

/**
 * Bumps the revision and discards everything derived from the previous one.
 * Called by every action that changes an input to preparation.
 */
function invalidate(job: Job): Job {
  return {
    ...job,
    revision: job.revision + 1,
    candidate: null,
    report: null,
    review: null,
    failure: null,
  };
}

export function jobReducer(job: Job, action: JobAction): Job {
  switch (action.type) {
    case 'ADD_INSTRUCTIONS':
      return {
        ...invalidate(job),
        instructionSource: action.source,
        confirmed: null,
        status: 'INSTRUCTIONS_ADDED',
      };

    case 'EDIT_INSTRUCTION_TEXT': {
      if (!job.instructionSource) return job;
      // originalText is preserved so corrections stay distinguishable (FR-01).
      return {
        ...invalidate(job),
        instructionSource: { ...job.instructionSource, editedText: action.text },
        confirmed: null,
        status: 'RULES_REVIEW',
      };
    }

    case 'SET_PROPOSALS':
      return {
        ...job,
        proposedRules: action.rules,
        proposedManualChecks: action.manualChecks,
        status: 'RULES_REVIEW',
      };

    case 'UPDATE_RULE': {
      const exists = job.proposedRules.some((rule) => rule.id === action.rule.id);
      const proposedRules = exists
        ? job.proposedRules.map((rule) => (rule.id === action.rule.id ? action.rule : rule))
        : [...job.proposedRules, action.rule];
      return { ...invalidate(job), proposedRules, confirmed: null, status: 'RULES_REVIEW' };
    }

    case 'REMOVE_RULE':
      return {
        ...invalidate(job),
        proposedRules: job.proposedRules.filter((rule) => rule.id !== action.ruleId),
        confirmed: null,
        status: 'RULES_REVIEW',
      };

    case 'SET_BYTE_CONVENTION':
      // Changes what every size rule means in bytes, so it invalidates too.
      return {
        ...invalidate(job),
        byteConvention: action.convention,
        confirmed: null,
        status: 'RULES_REVIEW',
      };

    case 'SET_DOCUMENT_KIND':
      return { ...invalidate(job), documentKind: action.kind, confirmed: null };

    case 'CONFIRM_REQUIREMENTS': {
      // Snapshot only confirmed rules. Proposals the user never resolved stay
      // out of the contract rather than riding along as assumptions.
      const confirmed: ConfirmedRequirements = {
        rules: job.proposedRules.filter((rule) => rule.reviewState !== 'rejected'),
        byteConvention: job.byteConvention,
        manualChecks: job.proposedManualChecks,
        documentKind: job.documentKind,
        confirmedAt: action.confirmedAt,
      };
      return {
        ...invalidate(job),
        confirmed,
        status: job.source ? 'DOCUMENT_READY' : 'RULES_CONFIRMED',
      };
    }

    case 'REOPEN_REQUIREMENTS':
      return { ...invalidate(job), confirmed: null, status: 'RULES_REVIEW' };

    case 'SET_SOURCE_DOCUMENT':
      return {
        ...invalidate(job),
        source: action.source,
        transform: null,
        status: job.confirmed ? 'DOCUMENT_READY' : 'RULES_REVIEW',
      };

    case 'APPROVE_GEOMETRY': {
      if (!job.source) return job;
      const next = invalidate(job);
      return {
        ...next,
        transform: {
          sourceId: job.source.id,
          jobRevision: next.revision,
          crop: action.crop,
          rotation: action.rotation,
          // Target geometry is resolved by the preparation planner; the crop
          // approval only records what the user agreed to look at.
          targetWidth: action.crop?.width ?? job.source.width,
          targetHeight: action.crop?.height ?? job.source.height,
          format: job.source.decodedFormat,
        },
        status: job.confirmed ? 'DOCUMENT_READY' : 'RULES_REVIEW',
      };
    }

    case 'START_PREPARATION':
      if (!job.confirmed || !job.source) return job;
      return { ...job, transform: action.transform, failure: null, status: 'PREPARING' };

    case 'PREPARATION_SUCCEEDED':
      // Late arrival from a run started before an edit: discard it (FR-11).
      if (action.candidate.jobRevision !== job.revision) return job;
      if (action.report.jobRevision !== job.revision) return job;
      return {
        ...job,
        candidate: action.candidate,
        report: action.report,
        review: null,
        failure: null,
        status: 'OUTPUT_REVIEW',
      };

    case 'PREPARATION_FAILED':
      if (action.jobRevision !== job.revision) return job;
      return { ...job, candidate: null, report: null, failure: action.failure, status: 'NEEDS_FIX' };

    case 'CANCEL_PREPARATION':
      // Returns to a recoverable input state; the original and rules survive.
      if (job.status !== 'PREPARING') return job;
      return { ...job, failure: null, status: 'DOCUMENT_READY' };

    case 'SET_USER_REVIEW': {
      if (!job.candidate || action.review.candidateId !== job.candidate.id) return job;
      if (action.review.jobRevision !== job.revision) return job;
      return {
        ...job,
        review: action.review,
        status: action.review.visuallyReviewed ? 'EXPORT_READY' : 'OUTPUT_REVIEW',
      };
    }

    case 'MARK_EXPORTED':
      if (job.status !== 'EXPORT_READY') return job;
      // Export does not clear the job — that requires an explicit action.
      return { ...job, status: 'EXPORTED' };

    case 'CLEAR_JOB':
      return createJob(action.nextId);

    case 'RESTORE_JOB':
      // The snapshot has already been version-checked and had any in-flight
      // status normalised, so it is adopted as-is rather than merged.
      return action.job;
  }
}

/**
 * Single source of truth for whether the Download button is enabled.
 * Mirrors the export condition in section 4 of the specification.
 */
export function canExport(job: Job): boolean {
  if (!job.candidate || !job.report || !job.review || !job.confirmed) return false;
  if (job.candidate.jobRevision !== job.revision) return false;
  if (job.report.jobRevision !== job.revision) return false;
  if (job.review.jobRevision !== job.revision) return false;
  if (job.review.candidateId !== job.candidate.id) return false;
  if (!job.review.visuallyReviewed) return false;

  const everyManualCheckSeen = job.confirmed.manualChecks.every((check) =>
    job.review!.acknowledgedManualCheckIds.includes(check.id),
  );
  if (!everyManualCheckSeen) return false;

  return job.report.results.every(
    (result) => result.outcome === 'pass' || result.outcome === 'not-applicable',
  );
}
