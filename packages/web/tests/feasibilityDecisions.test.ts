import { describe, expect, it } from 'vitest';
import { deriveDecisions, type ProbeResult } from '../src/features/feasibility/probes';

/**
 * The decision rules are the actual deliverable of work package 1 — the probes
 * only supply the inputs. Testing them here means the scope-freeze logic is
 * pinned before anyone runs it on a phone under time pressure.
 */

function probe(partial: Partial<ProbeResult> & Pick<ProbeResult, 'id'>): ProbeResult {
  return {
    label: partial.id,
    status: 'pass',
    detail: '',
    measurements: [],
    ...partial,
  };
}

const HEALTHY: ProbeResult[] = [
  // 28 MP, not 24: the 75% back-off means a 24 MP ceiling still forces the
  // guardrail below 20 MP, which is the rule working correctly.
  probe({ id: 'decode-ceiling', measurements: [{ label: 'Ceiling', value: '28 MP' }] }),
  probe({ id: 'jpeg-monotonicity' }),
  probe({ id: 'orientation' }),
  probe({
    id: 'ocr',
    measurements: [
      { label: 'Cold run', value: '4200 ms' },
      { label: 'Warm run', value: '900 ms' },
    ],
  }),
  probe({ id: 'happy-path', measurements: [{ label: 'Total elapsed', value: '6200 ms' }] }),
  probe({
    id: 'accelerator',
    measurements: [{ label: 'WebGPU adapter obtained', value: 'yes' }],
  }),
  probe({
    id: 'export',
    measurements: [{ label: 'Web Share with files', value: 'supported' }],
  }),
];

function answerFor(results: ProbeResult[], fragment: string): string {
  const decision = deriveDecisions(results).find((item) => item.question.includes(fragment));
  if (!decision) throw new Error(`No decision matched "${fragment}"`);
  return decision.answer;
}

function blockingFor(results: ProbeResult[], fragment: string): boolean {
  const decision = deriveDecisions(results).find((item) => item.question.includes(fragment));
  if (!decision) throw new Error(`No decision matched "${fragment}"`);
  return decision.blocking;
}

describe('a healthy device', () => {
  it('produces a decision for every question, with none blocking', () => {
    const decisions = deriveDecisions(HEALTHY);
    expect(decisions).toHaveLength(7);
    expect(decisions.filter((decision) => decision.blocking)).toHaveLength(0);
  });

  it('reports both OCR timings rather than collapsing them to one', () => {
    const answer = answerFor(HEALTHY, 'local OCR path');
    expect(answer).toContain('4200 ms');
    expect(answer).toContain('900 ms');
  });
});

describe('input guardrail', () => {
  it('backs off from the measured ceiling rather than adopting it', () => {
    // A live session also holds the OCR worker and preview bitmaps, so the
    // shipped limit must sit below what an idle probe managed.
    const results = [
      probe({ id: 'decode-ceiling', measurements: [{ label: 'Ceiling', value: '16 MP' }] }),
    ];
    expect(answerFor(results, 'megapixel guardrail')).toContain('12 MP');
    expect(blockingFor(results, 'megapixel guardrail')).toBe(true);
  });

  it('keeps 20 MP only when the headroom genuinely supports it', () => {
    const results = [
      probe({ id: 'decode-ceiling', measurements: [{ label: 'Ceiling', value: '28 MP' }] }),
    ];
    expect(answerFor(results, 'megapixel guardrail')).toBe('Keep 20 MP.');
    expect(blockingFor(results, 'megapixel guardrail')).toBe(false);
  });

  it('treats an unmeasured ceiling as unknown and blocking, not as a pass', () => {
    expect(blockingFor([], 'megapixel guardrail')).toBe(true);
    expect(answerFor([], 'megapixel guardrail')).toContain('Unknown');
  });

  it('does not accept a failed probe that still carries a ceiling value', () => {
    const results = [
      probe({
        id: 'decode-ceiling',
        status: 'fail',
        measurements: [{ label: 'Ceiling', value: '16 MP' }],
      }),
    ];
    expect(answerFor(results, 'megapixel guardrail')).toContain('Unknown');
  });
});

describe('search strategy', () => {
  it('withdraws the bisection when quality is not monotonic', () => {
    const results = [probe({ id: 'jpeg-monotonicity', status: 'fail' })];
    expect(answerFor(results, 'bisect on JPEG quality')).toContain('linear sweep');
    expect(blockingFor(results, 'bisect on JPEG quality')).toBe(true);
  });

  it('blocks when the probe never ran, since bisection would be unverified', () => {
    expect(blockingFor([], 'bisect on JPEG quality')).toBe(true);
  });
});

describe('crop safety', () => {
  it('blocks the crop editor when orientation is not applied on decode', () => {
    const results = [probe({ id: 'orientation', status: 'fail' })];
    expect(answerFor(results, 'crop editor')).toContain('normalise orientation');
    expect(blockingFor(results, 'crop editor')).toBe(true);
  });
});

describe('OCR viability', () => {
  it('separates "assets missing" from "OCR does not work here"', () => {
    const missing = [probe({ id: 'ocr', status: 'skipped' })];
    const broken = [probe({ id: 'ocr', status: 'fail' })];

    expect(answerFor(missing, 'local OCR path')).toContain('not installed');
    expect(answerFor(broken, 'local OCR path')).toContain('pasted-text path');
    expect(blockingFor(missing, 'local OCR path')).toBe(true);
  });
});

describe('performance target', () => {
  it('publishes the measured number when the target is missed', () => {
    const results = [
      probe({
        id: 'happy-path',
        status: 'fail',
        measurements: [{ label: 'Total elapsed', value: '21400 ms' }],
      }),
    ];
    const answer = answerFor(results, '15-second target');
    expect(answer).toContain('21400');
    expect(answer).toContain('Publish this number, not the target');
  });

  it('never blocks the build on a timing result', () => {
    // A slow happy path changes what gets claimed, not whether work continues.
    expect(blockingFor(HEALTHY, '15-second target')).toBe(false);
  });
});

describe('optional browser model', () => {
  it('rules it out with no WebGPU adapter', () => {
    const results = [
      probe({
        id: 'accelerator',
        status: 'unsupported',
        measurements: [{ label: 'WebGPU adapter obtained', value: 'no' }],
      }),
    ];
    expect(answerFor(results, 'browser language model')).toContain('No.');
  });

  it('treats an adapter as necessary but not sufficient', () => {
    const answer = answerFor(HEALTHY, 'browser language model');
    expect(answer).toContain('not approved');
    expect(answer).not.toMatch(/\byes\b/i);
  });

  it('does not describe a GPU path as an NPU path', () => {
    const decision = deriveDecisions(HEALTHY).find((item) =>
      item.question.includes('browser language model'),
    )!;
    expect(decision.rationale).toContain('not an NPU path');
    expect(`${decision.answer} ${decision.rationale}`).not.toMatch(/snapdragon|neural engine/i);
  });

  it('defaults to no when the probe never ran', () => {
    expect(answerFor([], 'browser language model')).toContain('No.');
  });
});

describe('conservative defaults', () => {
  it('blocks on every unmeasured capability rather than assuming it works', () => {
    const decisions = deriveDecisions([]);
    const blocking = decisions.filter((decision) => decision.blocking).map((d) => d.question);

    expect(blocking).toHaveLength(5);
    expect(blocking.some((question) => question.includes('guardrail'))).toBe(true);
    expect(blocking.some((question) => question.includes('export'))).toBe(true);
  });
});
