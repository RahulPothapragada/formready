import { describe, expect, it } from 'vitest';
import {
  allowedFormats,
  applyOperator,
  dimensionBounds,
  findConflicts,
  isImpossible,
  satisfies,
  sizeBounds,
  toBytes,
  UNBOUNDED,
} from '../src/domain/constraints';
import type { Rule } from '../src/domain/types';

function sizeRule(partial: Partial<Rule> & Pick<Rule, 'id'>): Rule {
  return {
    field: 'fileSize',
    operator: 'lte',
    value: 50,
    unit: 'KB',
    origin: 'extracted',
    reviewState: 'confirmed',
    ...partial,
  } as Rule;
}

describe('unit conversion', () => {
  it('keeps the decimal and binary conventions distinct', () => {
    expect(toBytes(50, 'KB', 'decimal')).toBe(50_000);
    expect(toBytes(50, 'KB', 'binary')).toBe(51_200);
    expect(toBytes(2, 'MB', 'binary')).toBe(2_097_152);
  });
});

describe('operator semantics', () => {
  it('tightens exclusive bounds by one byte, since bytes are integers', () => {
    // "under 50 KB" admits 49,999 bytes but not 50,000.
    expect(applyOperator(UNBOUNDED, 'lt', 50_000)).toEqual({ min: null, max: 49_999 });
    expect(applyOperator(UNBOUNDED, 'lte', 50_000)).toEqual({ min: null, max: 50_000 });
    expect(applyOperator(UNBOUNDED, 'gt', 20_000)).toEqual({ min: 20_001, max: null });
    expect(applyOperator(UNBOUNDED, 'gte', 20_000)).toEqual({ min: 20_000, max: null });
  });

  it('treats eq as a closed single-value interval', () => {
    expect(applyOperator(UNBOUNDED, 'eq', 200)).toEqual({ min: 200, max: 200 });
  });

  it('keeps the tighter bound when several apply', () => {
    const bounds = applyOperator(applyOperator(UNBOUNDED, 'lte', 50_000), 'lte', 30_000);
    expect(bounds.max).toBe(30_000);
  });
});

describe('boundary behaviour', () => {
  const bounds = { min: 20_000, max: 49_999 };

  it.each([
    [19_999, false],
    [20_000, true],
    [49_999, true],
    [50_000, false],
  ])('%d bytes → %s', (actual, expected) => {
    expect(satisfies(actual, bounds)).toBe(expected);
  });
});

describe('absent versus unresolved constraints', () => {
  it('reports no bound when no rule mentions the field', () => {
    // An absent width constraint is not a zero-pixel target.
    expect(dimensionBounds([], 'width')).toEqual(UNBOUNDED);
  });

  it('ignores rules the user has not confirmed', () => {
    const proposed = sizeRule({ id: 'a', reviewState: 'proposed' });
    expect(sizeBounds([proposed], 'decimal')).toEqual(UNBOUNDED);
  });

  it('ignores rules whose value could not be read', () => {
    const unresolved = sizeRule({ id: 'b', reviewState: 'unresolved' });
    expect(sizeBounds([unresolved], 'decimal')).toEqual(UNBOUNDED);
  });
});

describe('format intersection', () => {
  it('distinguishes "no format rule" from "no format allowed"', () => {
    expect(allowedFormats([])).toBeNull();

    const contradictory: Rule[] = [
      { id: 'f1', field: 'format', allowed: ['jpeg'], origin: 'extracted', reviewState: 'confirmed' },
      { id: 'f2', field: 'format', allowed: ['png'], origin: 'manual', reviewState: 'confirmed' },
    ];
    expect(allowedFormats(contradictory)).toEqual([]);
  });
});

describe('conflict detection', () => {
  it('flags a size window that no file can occupy', () => {
    const rules = [
      sizeRule({ id: 'min', operator: 'gte', value: 100 }),
      sizeRule({ id: 'max', operator: 'lte', value: 50 }),
    ];
    expect(isImpossible(sizeBounds(rules, 'decimal'))).toBe(true);
    expect(findConflicts(rules, 'decimal')).toHaveLength(1);
  });

  it('passes a coherent range', () => {
    const rules = [
      sizeRule({ id: 'min', operator: 'gte', value: 20 }),
      sizeRule({ id: 'max', operator: 'lte', value: 50 }),
    ];
    expect(findConflicts(rules, 'decimal')).toHaveLength(0);
  });

  it('changes the outcome when the byte convention changes', () => {
    // 50 KiB is above 51,000 bytes; 50 KB is not.
    const rules = [
      sizeRule({ id: 'min', operator: 'gte', value: 51_000, unit: 'B' }),
      sizeRule({ id: 'max', operator: 'lte', value: 50, unit: 'KB' }),
    ];
    expect(findConflicts(rules, 'decimal')).toHaveLength(1);
    expect(findConflicts(rules, 'binary')).toHaveLength(0);
  });
});
