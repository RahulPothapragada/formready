import { describe, expect, it } from 'vitest';
import { canExport, createJob, jobReducer, type JobAction } from '../src/app/jobReducer';
import type { Candidate, Job, Rule, SourceDocument, ValidationReport } from '../src/domain/types';

const RULE: Rule = {
  id: 'max',
  field: 'fileSize',
  operator: 'lte',
  value: 50,
  unit: 'KB',
  origin: 'extracted',
  reviewState: 'confirmed',
};

const SOURCE: SourceDocument = {
  id: 'src-1',
  blob: new Blob(['original']),
  filename: 'photo.jpg',
  decodedFormat: 'jpeg',
  width: 800,
  height: 920,
  orientation: 1,
};

function run(job: Job, actions: JobAction[]): Job {
  return actions.reduce(jobReducer, job);
}

/** Drives a job all the way to a verified, reviewed, exportable state. */
function readyJob(): Job {
  let job = run(createJob('job-1'), [
    {
      type: 'ADD_INSTRUCTIONS',
      source: { id: 'ins-1', type: 'pasted-text', originalText: 'Under 50 KB', editedText: 'Under 50 KB' },
    },
    { type: 'SET_PROPOSALS', rules: [RULE], manualChecks: [] },
    { type: 'CONFIRM_REQUIREMENTS', confirmedAt: 1 },
    { type: 'SET_SOURCE_DOCUMENT', source: SOURCE },
    { type: 'APPROVE_GEOMETRY', crop: null, rotation: 0 },
  ]);

  const candidate: Candidate = {
    id: 'cand-1',
    blob: new Blob(['prepared']),
    sourceId: SOURCE.id,
    jobRevision: job.revision,
    metadata: { format: 'jpeg', byteLength: 40_000, width: 800, height: 920 },
    attempts: 4,
  };
  const report: ValidationReport = {
    candidateId: candidate.id,
    jobRevision: job.revision,
    results: [
      { ruleId: RULE.id, field: 'fileSize', outcome: 'pass', expected: '', actual: '' },
    ],
    warnings: [],
    checkedAt: 2,
  };

  job = run(job, [
    { type: 'START_PREPARATION', transform: job.transform! },
    { type: 'PREPARATION_SUCCEEDED', candidate, report },
    {
      type: 'SET_USER_REVIEW',
      review: {
        candidateId: candidate.id,
        jobRevision: job.revision,
        visuallyReviewed: true,
        acknowledgedManualCheckIds: [],
        reviewedAt: 3,
      },
    },
  ]);

  return job;
}

describe('export gate', () => {
  it('opens only after checks pass and the user has reviewed the output', () => {
    const job = readyJob();
    expect(job.status).toBe('EXPORT_READY');
    expect(canExport(job)).toBe(true);
  });

  it('stays closed until the user confirms they looked at the file', () => {
    const job = readyJob();
    const unreviewed = jobReducer(job, {
      type: 'SET_USER_REVIEW',
      review: { ...job.review!, visuallyReviewed: false },
    });
    expect(canExport(unreviewed)).toBe(false);
  });

  it('stays closed while any exact check fails', () => {
    const job = readyJob();
    const failing: Job = {
      ...job,
      report: {
        ...job.report!,
        results: [{ ruleId: 'max', field: 'fileSize', outcome: 'fail', expected: '', actual: '' }],
      },
    };
    expect(canExport(failing)).toBe(false);
  });
});

describe('stale-result invalidation', () => {
  it('drops the candidate when a rule changes after preparation', () => {
    const job = readyJob();
    const edited = jobReducer(job, {
      type: 'UPDATE_RULE',
      rule: { ...RULE, value: 20 },
    });

    expect(edited.revision).toBe(job.revision + 1);
    expect(edited.candidate).toBeNull();
    expect(edited.report).toBeNull();
    expect(edited.review).toBeNull();
    expect(canExport(edited)).toBe(false);
  });

  it('drops the candidate when the source document changes', () => {
    const edited = jobReducer(readyJob(), {
      type: 'SET_SOURCE_DOCUMENT',
      source: { ...SOURCE, id: 'src-2' },
    });
    expect(edited.candidate).toBeNull();
    expect(canExport(edited)).toBe(false);
  });

  it('drops the candidate when the crop changes', () => {
    const edited = jobReducer(readyJob(), {
      type: 'APPROVE_GEOMETRY',
      crop: { x: 0, y: 0, width: 400, height: 460 },
      rotation: 0,
    });
    expect(edited.candidate).toBeNull();
    expect(canExport(edited)).toBe(false);
  });

  it('drops the candidate when the byte convention changes', () => {
    // 50 KB means a different number of bytes, so prior checks no longer apply.
    const edited = jobReducer(readyJob(), { type: 'SET_BYTE_CONVENTION', convention: 'binary' });
    expect(edited.candidate).toBeNull();
    expect(edited.confirmed).toBeNull();
  });

  it('ignores a result that arrives after the job moved on', () => {
    const job = readyJob();
    const edited = jobReducer(job, { type: 'UPDATE_RULE', rule: { ...RULE, value: 20 } });

    // A worker started before the edit finally reports back.
    const late = jobReducer(edited, {
      type: 'PREPARATION_SUCCEEDED',
      candidate: { ...job.candidate!, jobRevision: job.revision },
      report: { ...job.report!, jobRevision: job.revision },
    });

    expect(late.candidate).toBeNull();
    expect(late).toEqual(edited);
  });

  it('ignores a late failure from a cancelled run', () => {
    const job = readyJob();
    const edited = jobReducer(job, { type: 'UPDATE_RULE', rule: { ...RULE, value: 20 } });
    const late = jobReducer(edited, {
      type: 'PREPARATION_FAILED',
      jobRevision: job.revision,
      failure: { kind: 'no-candidate-in-budget', message: '', suggestions: [] },
    });
    expect(late.status).not.toBe('NEEDS_FIX');
  });
});

describe('original preservation', () => {
  it('never replaces the source blob during preparation or export', async () => {
    const job = readyJob();
    const exported = jobReducer(job, { type: 'MARK_EXPORTED' });

    expect(exported.source!.blob).toBe(SOURCE.blob);
    expect(await exported.source!.blob.text()).toBe('original');
  });

  it('keeps the job after export so the user can prepare another file', () => {
    const exported = jobReducer(readyJob(), { type: 'MARK_EXPORTED' });
    expect(exported.status).toBe('EXPORTED');
    expect(exported.confirmed).not.toBeNull();
    expect(exported.source).not.toBeNull();
  });

  it('restores a recoverable state after cancellation, keeping rules and source', () => {
    const preparing = jobReducer(readyJob(), {
      type: 'START_PREPARATION',
      transform: readyJob().transform!,
    });
    const cancelled = jobReducer(preparing, { type: 'CANCEL_PREPARATION' });

    expect(cancelled.status).toBe('DOCUMENT_READY');
    expect(cancelled.confirmed).not.toBeNull();
    expect(cancelled.source).not.toBeNull();
  });
});
