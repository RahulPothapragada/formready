import { describe, expect, it } from 'vitest';
import { parseRuleProposal } from '../src/domain/schemas';
import { buildFilename } from '../src/services/exportFile';
import { matchesVerifiedCandidate } from '../src/services/verifier';
import type { Candidate } from '../src/domain/types';

/**
 * The boundaries where data enters and leaves the app.
 *
 * Both were written early and left untested, which is the wrong way round:
 * `parseRuleProposal` is the gate for anything a language model proposes, and
 * the export helpers decide what actually reaches the user's file system.
 */

describe('rule proposal parsing', () => {
  const validRule = {
    id: 'r1',
    field: 'fileSize',
    operator: 'lte',
    value: 50,
    unit: 'KB',
    origin: 'extracted',
    reviewState: 'proposed',
  };

  it('accepts a well-formed proposal', () => {
    const { proposal, rejected } = parseRuleProposal({
      rules: [validRule],
      manualChecks: [],
      ambiguities: [],
    });
    expect(proposal.rules).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('drops one malformed rule without discarding the good ones', () => {
    // Losing the whole batch because of a single bad entry would throw away
    // work the user could have confirmed.
    const { proposal, rejected } = parseRuleProposal({
      rules: [validRule, { id: 'r2', field: 'fileSize', operator: 'nonsense', value: 1, unit: 'KB' }],
      manualChecks: [],
      ambiguities: [],
    });
    expect(proposal.rules).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });

  it('refuses a zero or negative size, rather than treating it as a limit', () => {
    for (const value of [0, -5]) {
      const { proposal } = parseRuleProposal({ rules: [{ ...validRule, value }] });
      expect(proposal.rules).toHaveLength(0);
    }
  });

  it('refuses a non-integer pixel dimension', () => {
    const { proposal } = parseRuleProposal({
      rules: [{ ...validRule, field: 'width', value: 200.5, unit: 'px' }],
    });
    expect(proposal.rules).toHaveLength(0);
  });

  it('refuses a format rule that allows nothing', () => {
    const { proposal } = parseRuleProposal({
      rules: [{ id: 'f', field: 'format', allowed: [], origin: 'extracted', reviewState: 'proposed' }],
    });
    expect(proposal.rules).toHaveLength(0);
  });

  it('refuses an unknown field entirely', () => {
    // A model inventing a "dpi" rule must not become a rule the app enforces.
    const { proposal } = parseRuleProposal({
      rules: [{ ...validRule, field: 'dpi' }],
    });
    expect(proposal.rules).toHaveLength(0);
  });

  it('rejects a source span that covers no characters', () => {
    const { proposal } = parseRuleProposal({
      rules: [{ ...validRule, sourceSpan: { sourceId: 's', start: 5, end: 5, text: '' } }],
    });
    expect(proposal.rules).toHaveLength(0);
  });

  it('survives a response that is not a proposal at all', () => {
    for (const input of [null, 'sorry, I cannot help', 42, []]) {
      const { proposal } = parseRuleProposal(input);
      expect(proposal.rules).toHaveLength(0);
      expect(proposal.manualChecks).toHaveLength(0);
    }
  });

  it('ignores anything resembling an instruction rather than data', () => {
    // Model output is data. A "steps" or "code" field is not a processing plan
    // and must not survive into application state.
    const { proposal } = parseRuleProposal({
      rules: [validRule],
      steps: ['delete the original'],
      code: 'fetch("https://example.com")',
    });
    expect(proposal).not.toHaveProperty('steps');
    expect(proposal).not.toHaveProperty('code');
    expect(Object.keys(proposal).sort()).toEqual(['ambiguities', 'manualChecks', 'rules']);
  });
});

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

describe('export filename', () => {
  it('names the file after the decoded format, not the source', () => {
    // A JPEG must never leave with a .png extension (FR-13).
    expect(buildFilename(candidate(), 'photo', '3')).toBe('formready-photo-3.jpg');
    const png = candidate({ metadata: { format: 'png', byteLength: 4, width: 1, height: 1 } });
    expect(buildFilename(png, 'signature', '1')).toBe('formready-signature-1.png');
  });

  it('names each document kind recognisably', () => {
    expect(buildFilename(candidate(), 'printed', '0')).toContain('document');
    expect(buildFilename(candidate(), 'other', '0')).toContain('file');
  });
});

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
