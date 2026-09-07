import { describe, expect, it } from 'vitest';
import { extractRules } from '../src/features/requirements/extractRules';
import type { FileSizeRule } from '../src/domain/types';

const options = { sourceId: 'src-1', documentKind: 'photo' as const };

function sizeRules(text: string): FileSizeRule[] {
  return extractRules(text, options).rules.filter(
    (rule): rule is FileSizeRule => rule.field === 'fileSize',
  );
}

describe('bound direction', () => {
  it('reads "under" as exclusive and "up to" as inclusive', () => {
    expect(sizeRules('Photo must be under 50 KB')[0].operator).toBe('lt');
    expect(sizeRules('Photo size up to 50 KB')[0].operator).toBe('lte');
  });

  it('reads minimum phrasing as a lower bound', () => {
    expect(sizeRules('File should be at least 10 KB')[0].operator).toBe('gte');
    expect(sizeRules('File must be more than 10 KB')[0].operator).toBe('gt');
  });

  it('marks a bare size as unresolved rather than assuming a maximum', () => {
    const [rule] = sizeRules('Photograph 50 KB');
    expect(rule.reviewState).toBe('unresolved');
    expect(extractRules('Photograph 50 KB', options).ambiguities).not.toHaveLength(0);
  });
});

describe('ranges', () => {
  it('produces one lower and one upper bound, not two independent limits', () => {
    const rules = sizeRules('Image size between 20 KB and 50 KB');
    expect(rules).toHaveLength(2);
    expect(rules.map((rule) => rule.operator).sort()).toEqual(['gte', 'lte']);
    expect(rules.find((rule) => rule.operator === 'gte')!.value).toBe(20);
    expect(rules.find((rule) => rule.operator === 'lte')!.value).toBe(50);
  });

  it('carries the unit forward when only the upper bound states one', () => {
    const rules = sizeRules('Size 20 to 50 KB');
    expect(rules.every((rule) => rule.unit === 'KB')).toBe(true);
  });
});

describe('dimensions', () => {
  it('reads a pixel pair as exact width and height', () => {
    const rules = extractRules('Photo must be 200 x 230 pixels', options).rules;
    const width = rules.find((rule) => rule.field === 'width');
    const height = rules.find((rule) => rule.field === 'height');
    expect(width).toMatchObject({ operator: 'eq', value: 200 });
    expect(height).toMatchObject({ operator: 'eq', value: 230 });
  });

  it('applies a stated minimum to the pair', () => {
    const rules = extractRules('Minimum 350 x 350 pixels', options).rules;
    expect(rules.find((rule) => rule.field === 'width')).toMatchObject({ operator: 'gte' });
  });
});

describe('evidence', () => {
  it('links every extracted rule to the exact phrase it came from', () => {
    const text = 'Upload a JPEG photograph under 50 KB, 200 x 230 pixels.';
    const { rules } = extractRules(text, options);

    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.origin).toBe('extracted');
      expect(rule.sourceSpan).toBeDefined();
      // The span must actually point at the text it claims to quote.
      expect(text.slice(rule.sourceSpan!.start, rule.sourceSpan!.end)).toBe(rule.sourceSpan!.text);
    }
  });
});

describe('unsupported instructions', () => {
  it('keeps DPI and background conditions as manual checks, not as rules', () => {
    const text = 'Photo must be 300 dpi with a white background.';
    const { rules, manualChecks } = extractRules(text, options);

    expect(rules.some((rule) => rule.field === 'fileSize')).toBe(false);
    expect(manualChecks.length).toBeGreaterThanOrEqual(2);
  });

  it('flags text covering both a photo and a signature', () => {
    const text = 'Photograph under 50 KB. Signature under 20 KB.';
    const { ambiguities } = extractRules(text, options);
    expect(ambiguities.some((item) => item.text.includes('signature'))).toBe(true);
  });

  it('asks for a target when nothing supported was found', () => {
    const { rules, ambiguities } = extractRules('Please upload your documents.', options);
    expect(rules).toHaveLength(0);
    expect(ambiguities).toHaveLength(1);
  });
});

describe('format', () => {
  it('collects every named format into one rule', () => {
    const rule = extractRules('Upload in JPG or PNG format', options).rules.find(
      (item) => item.field === 'format',
    );
    expect(rule).toMatchObject({ field: 'format' });
    expect(rule && 'allowed' in rule ? [...rule.allowed].sort() : []).toEqual(['jpeg', 'png']);
  });
});

/**
 * Regressions from the review. Each of these previously produced a requirement
 * that reversed or invented what the instructions said — the worst possible
 * failure here, because everything downstream then verifies correctly against
 * the wrong rule.
 */
describe('negation and clause scope', () => {
  it('reads "not less than" as a minimum, not a maximum', () => {
    const [rule] = sizeRules('File must be not less than 20 KB.');
    expect(rule.operator).toBe('gte');
    expect(rule.value).toBe(20);
  });

  it('reads "no more than" as a maximum', () => {
    expect(sizeRules('File should be no more than 50 KB.')[0].operator).toBe('lte');
  });

  it('reads "not exceeding" as inclusive', () => {
    expect(sizeRules('Size not exceeding 50 KB.')[0].operator).toBe('lte');
  });

  it('does not let a size qualifier reach across a comma into the dimensions', () => {
    // "under" governs the file size only; the pixels are exact.
    const rules = extractRules('JPEG under 50 KB, 200 x 230 pixels.', options).rules;
    expect(rules.find((rule) => rule.field === 'fileSize')).toMatchObject({ operator: 'lt' });
    expect(rules.find((rule) => rule.field === 'width')).toMatchObject({ operator: 'eq', value: 200 });
    expect(rules.find((rule) => rule.field === 'height')).toMatchObject({ operator: 'eq', value: 230 });
  });

  it('keeps a comma inside a number from splitting the clause', () => {
    expect(sizeRules('File must be under 20,000 bytes.')[0]).toMatchObject({
      operator: 'lt',
      value: 20000,
      unit: 'B',
    });
  });
});

describe('physical dimensions', () => {
  it('never reads millimetres as pixels', () => {
    const { rules, ambiguities } = extractRules('Photograph must measure 35 x 45 mm.', options);
    expect(rules.filter((rule) => rule.field === 'width' || rule.field === 'height')).toHaveLength(0);
    expect(ambiguities.some((item) => /physical dimensions/i.test(item.reason))).toBe(true);
  });

  it('flags a bare pixel pair as an assumption rather than silently taking it', () => {
    const { rules, ambiguities } = extractRules('Photo size 200 x 230.', options);
    expect(rules.some((rule) => rule.field === 'width')).toBe(true);
    expect(ambiguities.some((item) => /assumed to be pixels/i.test(item.reason))).toBe(true);
  });
});

describe('prohibited formats', () => {
  it('does not treat a forbidden format as permitted', () => {
    const rule = extractRules('Only JPEG is accepted. PNG is not allowed.', options).rules.find(
      (item) => item.field === 'format',
    );
    expect(rule && 'allowed' in rule ? rule.allowed : []).toEqual(['jpeg']);
  });

  it('honours "only" as exclusive', () => {
    const rule = extractRules('Only PNG files are accepted.', options).rules.find(
      (item) => item.field === 'format',
    );
    expect(rule && 'allowed' in rule ? rule.allowed : []).toEqual(['png']);
  });

  it('proposes nothing when every supported format is ruled out', () => {
    const { rules, ambiguities } = extractRules('JPEG and PNG are not accepted.', options);
    expect(rules.some((rule) => rule.field === 'format')).toBe(false);
    expect(ambiguities.some((item) => /rule out every format/i.test(item.reason))).toBe(true);
  });
});

describe('document attribution', () => {
  const text = 'Photograph under 50 KB. Signature under 20 KB.';

  it('proposes only the photograph limit when preparing a photograph', () => {
    const rules = extractRules(text, { ...options, documentKind: 'photo' }).rules;
    expect(rules.filter((rule) => rule.field === 'fileSize')).toHaveLength(1);
    expect(rules.find((rule) => rule.field === 'fileSize')).toMatchObject({ value: 50 });
  });

  it('proposes only the signature limit when preparing a signature', () => {
    const rules = extractRules(text, { ...options, documentKind: 'signature' }).rules;
    expect(rules.filter((rule) => rule.field === 'fileSize')).toHaveLength(1);
    expect(rules.find((rule) => rule.field === 'fileSize')).toMatchObject({ value: 20 });
  });

  it('says what it left out rather than dropping it silently', () => {
    const { ambiguities } = extractRules(text, { ...options, documentKind: 'photo' });
    expect(ambiguities.some((item) => /signature/i.test(item.reason))).toBe(true);
  });

  it('carries the named upload forward across following clauses', () => {
    const rules = extractRules(
      'Photograph must be JPEG. Size under 50 KB. Signature under 20 KB.',
      { ...options, documentKind: 'photo' },
    ).rules;
    expect(rules.filter((rule) => rule.field === 'fileSize')).toHaveLength(1);
    expect(rules.find((rule) => rule.field === 'fileSize')).toMatchObject({ value: 50 });
  });

  it('keeps unscoped rules for every document kind', () => {
    for (const kind of ['photo', 'signature', 'printed', 'other'] as const) {
      const rules = extractRules('File must be under 50 KB.', { ...options, documentKind: kind }).rules;
      expect(rules).toHaveLength(1);
    }
  });
});
