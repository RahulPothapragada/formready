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
