import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_VERSION,
  describeSnapshot,
  fromSnapshot,
  isWorthSaving,
  toSnapshot,
} from '../src/domain/jobSnapshot';
import { createJob, jobReducer } from '../src/app/jobReducer';
import type { Candidate, Job, Rule, SourceDocument } from '../src/domain/types';

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

function jobWithWork(): Job {
  return [
    {
      type: 'ADD_INSTRUCTIONS' as const,
      source: {
        id: 'ins-1',
        type: 'pasted-text' as const,
        originalText: 'Under 50 KB',
        editedText: 'Under 50 KB',
      },
    },
    { type: 'SET_PROPOSALS' as const, rules: [RULE], manualChecks: [] },
    { type: 'CONFIRM_REQUIREMENTS' as const, confirmedAt: 1 },
    { type: 'SET_SOURCE_DOCUMENT' as const, source: SOURCE },
  ].reduce(jobReducer, createJob('job-1'));
}

describe('round trip', () => {
  it('restores a job unchanged', () => {
    const job = jobWithWork();
    const restored = fromSnapshot(toSnapshot(job, 1000));
    expect(restored).toEqual(job);
  });

  it('keeps the original blob intact through storage', async () => {
    const restored = fromSnapshot(toSnapshot(jobWithWork(), 1000))!;
    expect(await restored.source!.blob.text()).toBe('original');
  });

  it('preserves the revision, so stale-result protection survives a reload', () => {
    const job = jobWithWork();
    const restored = fromSnapshot(toSnapshot(job, 1000))!;
    expect(restored.revision).toBe(job.revision);
  });
});

describe('version gating', () => {
  it('discards a snapshot from another version rather than half-reading it', () => {
    const snapshot = toSnapshot(jobWithWork(), 1000);
    expect(fromSnapshot({ ...snapshot, version: SNAPSHOT_VERSION + 1 })).toBeNull();
    expect(fromSnapshot({ ...snapshot, version: SNAPSHOT_VERSION - 1 })).toBeNull();
  });

  it('returns null for anything that is not a snapshot', () => {
    for (const value of [null, undefined, 'nonsense', 42, {}, { version: SNAPSHOT_VERSION }]) {
      expect(fromSnapshot(value)).toBeNull();
    }
  });

  it('returns null when the stored job is missing required fields', () => {
    const snapshot = toSnapshot(jobWithWork(), 1000);
    expect(fromSnapshot({ ...snapshot, job: { id: 'x' } })).toBeNull();
  });
});

describe('work in flight does not survive', () => {
  function preparingJob(): Job {
    const job = jobWithWork();
    const approved = jobReducer(job, { type: 'APPROVE_GEOMETRY', crop: null, rotation: 0 });
    return jobReducer(approved, { type: 'START_PREPARATION', transform: approved.transform! });
  }

  it('drops PREPARING back to a recoverable state', () => {
    // After a reload the worker is gone; restoring PREPARING would leave the
    // screen waiting forever on work that is not happening.
    expect(preparingJob().status).toBe('PREPARING');
    expect(fromSnapshot(toSnapshot(preparingJob(), 1000))!.status).toBe('DOCUMENT_READY');
  });

  it('keeps the confirmed rules and the original when it does so', () => {
    const restored = fromSnapshot(toSnapshot(preparingJob(), 1000))!;
    expect(restored.confirmed).not.toBeNull();
    expect(restored.source).not.toBeNull();
    expect(restored.transform).not.toBeNull();
  });

  it('does not restore a candidate that belonged to the interrupted run', () => {
    const preparing = preparingJob();
    const candidate: Candidate = {
      id: 'c1',
      blob: new Blob(['x']),
      sourceId: SOURCE.id,
      jobRevision: preparing.revision,
      metadata: { format: 'jpeg', byteLength: 1, width: 1, height: 1 },
      attempts: 1,
    };
    const stale: Job = { ...preparing, candidate };

    expect(fromSnapshot(toSnapshot(stale, 1000))!.candidate).toBeNull();
  });

  it('leaves a settled job candidate alone', () => {
    const job = jobWithWork();
    const settled: Job = {
      ...job,
      status: 'OUTPUT_REVIEW',
      candidate: {
        id: 'c1',
        blob: new Blob(['x']),
        sourceId: SOURCE.id,
        jobRevision: job.revision,
        metadata: { format: 'jpeg', byteLength: 1, width: 1, height: 1 },
        attempts: 1,
      },
    };
    expect(fromSnapshot(toSnapshot(settled, 1000))!.candidate).not.toBeNull();
  });
});

describe('when to save at all', () => {
  it('does not save an untouched job', () => {
    expect(isWorthSaving(createJob('job-1'))).toBe(false);
  });

  it('saves as soon as there is anything to lose', () => {
    expect(isWorthSaving(jobWithWork())).toBe(true);
  });
});

describe('describing what is stored', () => {
  it('names the furthest thing the user has reached', () => {
    const job = jobWithWork();
    expect(describeSnapshot(createJob('x'))).toBe('requirements');
    expect(describeSnapshot({ ...job, source: null })).toBe('confirmed requirements');
    expect(describeSnapshot(job)).toBe('document');
  });
});

describe('restoring through the reducer', () => {
  it('adopts the restored job wholesale', () => {
    const restored = fromSnapshot(toSnapshot(jobWithWork(), 1000))!;
    expect(jobReducer(createJob('fresh'), { type: 'RESTORE_JOB', job: restored })).toEqual(restored);
  });
});
