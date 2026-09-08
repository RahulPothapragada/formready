import { describe, expect, it } from 'vitest';
import { matchesVerifiedCandidate } from '@formready/browser';
import type { Candidate } from '@formready/engine';

/**
 * Post-export integrity lives with the web adapter, not the engine: comparing
 * produced bytes needs a real Blob, which is precisely the kind of platform
 * dependency the engine package refuses to carry.
 */
function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'c1',
    blob: new Blob([new Uint8Array([1, 2, 3, 4])]),
    sourceId: 's1',
    jobRevision: 2,
    metadata: { format: 'jpeg', byteLength: 4, width: 200, height: 230 },
    attempts: 3,
    ...overrides,
  };
}

describe('post-export integrity', () => {
  it('accepts bytes identical to the verified candidate', async () => {
    const subject = candidate();
    const exported = new Blob([new Uint8Array([1, 2, 3, 4])]);
    expect(await matchesVerifiedCandidate(exported, subject)).toBe(true);
  });

  it('rejects a different length', async () => {
    const exported = new Blob([new Uint8Array([1, 2, 3])]);
    expect(await matchesVerifiedCandidate(exported, candidate())).toBe(false);
  });

  it('rejects same-length bytes that differ', async () => {
    // The length check alone would pass this, which is why the bytes are
    // compared as well.
    const exported = new Blob([new Uint8Array([1, 2, 3, 9])]);
    expect(await matchesVerifiedCandidate(exported, candidate())).toBe(false);
  });
});
