import { describe, expect, it } from 'vitest';
import { allExactChecksPass, buildValidationReport } from '../src/domain/constraints';
import { fitWithinAspect, sniffFormat } from '../src/services/imageCodec';
import type { Candidate, CandidateMetadata, ConfirmedRequirements, Rule } from '../src/domain/types';

const JPEG_HEADER = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('format detection', () => {
  it('identifies formats from magic bytes', () => {
    expect(sniffFormat(JPEG_HEADER)).toBe('jpeg');
    expect(sniffFormat(PNG_HEADER)).toBe('png');
  });

  it('rejects anything that is not a supported image', () => {
    expect(sniffFormat(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull(); // PDF
    expect(sniffFormat(new Uint8Array([0xff]))).toBeNull(); // truncated
  });

  it('does not trust the extension — a renamed PDF is still not a JPEG', () => {
    // The filename says photo.jpg; the bytes say otherwise, and bytes win.
    const renamedPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(sniffFormat(renamedPdf)).toBeNull();
  });
});

describe('aspect-preserving fit', () => {
  it('scales down to the tighter of the two limits', () => {
    expect(fitWithinAspect(1000, 500, 200, null)).toEqual({ width: 200, height: 100 });
    expect(fitWithinAspect(1000, 500, null, 100)).toEqual({ width: 200, height: 100 });
  });

  it('never upscales, because enlarging cannot restore detail', () => {
    expect(fitWithinAspect(100, 50, 1000, 1000)).toEqual({ width: 100, height: 50 });
  });
});

function requirements(rules: Rule[]): ConfirmedRequirements {
  return {
    rules,
    byteConvention: 'decimal',
    manualChecks: [],
    documentKind: 'photo',
    confirmedAt: 0,
  };
}

function candidate(metadata: CandidateMetadata): Candidate {
  return {
    id: 'cand-1',
    blob: new Blob([]),
    sourceId: 'src-1',
    jobRevision: 3,
    metadata,
    attempts: 1,
  };
}

const RULES: Rule[] = [
  { id: 'fmt', field: 'format', allowed: ['jpeg'], origin: 'extracted', reviewState: 'confirmed' },
  {
    id: 'max',
    field: 'fileSize',
    operator: 'lt',
    value: 50,
    unit: 'KB',
    origin: 'extracted',
    reviewState: 'confirmed',
  },
  {
    id: 'w',
    field: 'width',
    operator: 'eq',
    value: 200,
    unit: 'px',
    origin: 'extracted',
    reviewState: 'confirmed',
  },
];

describe('validation report', () => {
  it('passes a file inside every confirmed bound', () => {
    const report = buildValidationReport(
      candidate({ format: 'jpeg', byteLength: 43_612, width: 200, height: 230 }),
      requirements(RULES),
      0,
    );

    expect(report.results.map((result) => result.outcome)).toEqual(['pass', 'pass', 'pass']);
    expect(allExactChecksPass(report)).toBe(true);
    expect(report.results[1].actual).toBe('43,612 bytes');
    expect(report.results[1].expected).toBe('at most 49,999 bytes');
  });

  it('fails a file exactly on an exclusive boundary', () => {
    const report = buildValidationReport(
      candidate({ format: 'jpeg', byteLength: 50_000, width: 200, height: 230 }),
      requirements(RULES),
      0,
    );
    expect(report.results[1].outcome).toBe('fail');
    expect(allExactChecksPass(report)).toBe(false);
  });

  it('fails on the decoded format even when every other check passes', () => {
    const report = buildValidationReport(
      candidate({ format: 'png', byteLength: 20_000, width: 200, height: 230 }),
      requirements(RULES),
      0,
    );
    expect(report.results[0].outcome).toBe('fail');
    expect(allExactChecksPass(report)).toBe(false);
  });

  it('blocks export on an unresolved rule rather than assuming it passed', () => {
    const unresolved: Rule[] = [
      {
        id: 'unknown',
        field: 'fileSize',
        operator: 'lte',
        value: 50,
        unit: 'KB',
        origin: 'extracted',
        reviewState: 'unresolved',
      },
    ];
    const report = buildValidationReport(
      candidate({ format: 'jpeg', byteLength: 1_000, width: 200, height: 230 }),
      requirements(unresolved),
      0,
    );

    expect(report.results[0].outcome).toBe('unresolved');
    expect(allExactChecksPass(report)).toBe(false);
  });

  it('carries the candidate revision so a stale report cannot be mistaken for a fresh one', () => {
    const report = buildValidationReport(
      candidate({ format: 'jpeg', byteLength: 1_000, width: 200, height: 230 }),
      requirements(RULES),
      0,
    );
    expect(report.jobRevision).toBe(3);
    expect(report.candidateId).toBe('cand-1');
  });
});
