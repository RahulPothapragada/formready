/**
 * Exact constraint arithmetic.
 *
 * Everything in this file is pure and synchronously testable. It is the only
 * place allowed to decide whether a measurement passes a requirement — the UI
 * renders its output, and the candidate search reads its bounds, but neither
 * re-implements the comparison.
 *
 * Bytes and pixels are integers, so exclusive bounds are tightened to
 * inclusive ones on the way in ("under 50 KB" becomes "at most 49,999 bytes").
 * Downstream code then only ever deals with inclusive intervals.
 */

import type {
  ByteConvention,
  Candidate,
  CandidateMetadata,
  ComparisonOperator,
  ConfirmedRequirements,
  DimensionRule,
  FileSizeRule,
  FormatRule,
  ImageFormat,
  Rule,
  RuleField,
  RuleResult,
  SizeUnit,
  ValidationReport,
} from './types';

/** An inclusive integer interval. `null` on a side means unbounded there. */
export interface Bounds {
  min: number | null;
  max: number | null;
}

export const UNBOUNDED: Bounds = { min: null, max: null };

const KB: Record<ByteConvention, number> = { decimal: 1000, binary: 1024 };

export function unitMultiplier(unit: SizeUnit, convention: ByteConvention): number {
  switch (unit) {
    case 'B':
      return 1;
    case 'KB':
      return KB[convention];
    case 'MB':
      return KB[convention] ** 2;
  }
}

/**
 * Converts a stated size to bytes. Rounds to an integer because a byte count
 * is a count — 49.5 bytes is not a threshold any file can sit on.
 */
export function toBytes(value: number, unit: SizeUnit, convention: ByteConvention): number {
  return Math.round(value * unitMultiplier(unit, convention));
}

export function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} bytes`;
}

/**
 * Folds one operator/value pair into an existing inclusive interval.
 * Exclusive operators shift by one unit, which is exact for integer domains.
 */
export function applyOperator(
  bounds: Bounds,
  operator: ComparisonOperator,
  value: number,
): Bounds {
  const next: Bounds = { ...bounds };
  switch (operator) {
    case 'lt':
      next.max = tightenMax(next.max, value - 1);
      break;
    case 'lte':
      next.max = tightenMax(next.max, value);
      break;
    case 'gt':
      next.min = tightenMin(next.min, value + 1);
      break;
    case 'gte':
      next.min = tightenMin(next.min, value);
      break;
    case 'eq':
      next.min = tightenMin(next.min, value);
      next.max = tightenMax(next.max, value);
      break;
  }
  return next;
}

function tightenMin(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.max(current, candidate);
}

function tightenMax(current: number | null, candidate: number): number {
  return current === null ? candidate : Math.min(current, candidate);
}

export function satisfies(actual: number, bounds: Bounds): boolean {
  if (bounds.min !== null && actual < bounds.min) return false;
  if (bounds.max !== null && actual > bounds.max) return false;
  return true;
}

/** An interval with min > max can never be satisfied by any file. */
export function isImpossible(bounds: Bounds): boolean {
  return bounds.min !== null && bounds.max !== null && bounds.min > bounds.max;
}

/**
 * Largest output dimension the app will accept as a requirement.
 *
 * A rule asking for 500,000 pixels is not a requirement anyone can meet; it is
 * an allocation that fails. Bounding it here keeps an impossible number out of
 * the encoder rather than letting it become an out-of-memory crash.
 */
export const MAX_OUTPUT_DIMENSION = 20000;

/**
 * Is a rule usable as an executable requirement?
 *
 * Empty numeric fields read back as `Number('') === 0`, and the `min` attribute
 * on an input does not stop a value reaching state in a button-driven form. So
 * validity is decided here, where every path — extraction, manual entry, and
 * editing — has to pass through it.
 */
export function isUsableRule(rule: Rule): boolean {
  if (rule.field === 'format') return rule.allowed.length > 0;
  if (!Number.isFinite(rule.value) || rule.value <= 0) return false;
  if (rule.field === 'width' || rule.field === 'height') {
    return Number.isInteger(rule.value) && rule.value <= MAX_OUTPUT_DIMENSION;
  }
  return true;
}

/** Why a rule cannot be used, for the editor to show against the field. */
export function ruleProblem(rule: Rule): string | null {
  if (isUsableRule(rule)) return null;
  if (rule.field === 'format') return 'Choose at least one format.';
  if (!Number.isFinite(rule.value) || rule.value <= 0) {
    return 'Enter a number greater than zero.';
  }
  if (!Number.isInteger(rule.value)) return 'Pixels must be a whole number.';
  return `Enter ${MAX_OUTPUT_DIMENSION.toLocaleString('en-US')} pixels or fewer.`;
}

/** Only rules the user actually confirmed take part in exact checking. */
function confirmedOnly(rules: Rule[]): Rule[] {
  return rules.filter((rule) => rule.reviewState === 'confirmed');
}

export function sizeBounds(rules: Rule[], convention: ByteConvention): Bounds {
  return confirmedOnly(rules)
    .filter((rule): rule is FileSizeRule => rule.field === 'fileSize')
    .reduce<Bounds>(
      (bounds, rule) =>
        applyOperator(bounds, rule.operator, toBytes(rule.value, rule.unit, convention)),
      { ...UNBOUNDED },
    );
}

export function dimensionBounds(rules: Rule[], axis: 'width' | 'height'): Bounds {
  return confirmedOnly(rules)
    .filter((rule): rule is DimensionRule => rule.field === axis)
    .reduce<Bounds>(
      (bounds, rule) => applyOperator(bounds, rule.operator, rule.value),
      { ...UNBOUNDED },
    );
}

/**
 * Intersection of every confirmed format rule. An empty array means the rules
 * contradict each other; absence of any format rule means "no constraint",
 * which is represented by `null`, not by an empty array.
 */
export function allowedFormats(rules: Rule[]): ImageFormat[] | null {
  const formatRules = confirmedOnly(rules).filter(
    (rule): rule is FormatRule => rule.field === 'format',
  );
  if (formatRules.length === 0) return null;
  return formatRules.reduce<ImageFormat[]>(
    (acc, rule) => acc.filter((format) => rule.allowed.includes(format)),
    [...formatRules[0].allowed],
  );
}

export interface Conflict {
  field: 'format' | 'fileSize' | 'width' | 'height';
  message: string;
}

const FIELD_LABEL: Record<RuleField, string> = {
  format: 'File format',
  fileSize: 'File size',
  width: 'Width',
  height: 'Height',
};

/**
 * Contradictions that must block confirmation (FR-05). These are structural
 * impossibilities in the rule set itself, found before any file is touched.
 */
export function findConflicts(rules: Rule[], convention: ByteConvention): Conflict[] {
  const conflicts: Conflict[] = [];

  // An unusable value blocks confirmation before any interval arithmetic: a
  // zero-pixel width is not a narrow requirement, it is a broken one.
  for (const rule of confirmedOnly(rules)) {
    const problem = ruleProblem(rule);
    if (problem) {
      conflicts.push({
        field: rule.field,
        message: `${FIELD_LABEL[rule.field]}: ${problem}`,
      });
    }
  }

  const size = sizeBounds(rules, convention);
  if (isImpossible(size)) {
    conflicts.push({
      field: 'fileSize',
      message: `These instructions ask for at least ${formatBytes(size.min!)} and at most ${formatBytes(size.max!)}. No file can be both.`,
    });
  }

  for (const axis of ['width', 'height'] as const) {
    const bounds = dimensionBounds(rules, axis);
    if (isImpossible(bounds)) {
      conflicts.push({
        field: axis,
        message: `These instructions ask for a ${axis} of at least ${bounds.min} px and at most ${bounds.max} px. Choose the one for this upload.`,
      });
    }
  }

  const formats = allowedFormats(rules);
  if (formats !== null && formats.length === 0) {
    conflicts.push({
      field: 'format',
      message: 'These instructions name different file formats. Choose the one for this upload.',
    });
  }

  return conflicts;
}

function describeBounds(bounds: Bounds, render: (value: number) => string): string {
  if (bounds.min !== null && bounds.max !== null) {
    return bounds.min === bounds.max
      ? `exactly ${render(bounds.min)}`
      : `between ${render(bounds.min)} and ${render(bounds.max)}`;
  }
  if (bounds.max !== null) return `at most ${render(bounds.max)}`;
  if (bounds.min !== null) return `at least ${render(bounds.min)}`;
  return 'no limit specified';
}

function evaluateRule(
  rule: Rule,
  metadata: CandidateMetadata,
  convention: ByteConvention,
): RuleResult {
  // An unresolved rule stays unresolved. It is never treated as a pass just
  // because the file happens to be plausible.
  if (rule.reviewState === 'unresolved') {
    return {
      ruleId: rule.id,
      field: rule.field,
      outcome: 'unresolved',
      expected: 'could not be read from the instructions',
      actual: 'not checked',
    };
  }

  if (rule.reviewState !== 'confirmed') {
    return {
      ruleId: rule.id,
      field: rule.field,
      outcome: 'not-applicable',
      expected: 'not confirmed for this upload',
      actual: 'not checked',
    };
  }

  if (rule.field === 'format') {
    const names = rule.allowed.map((format) => format.toUpperCase()).join(' or ');
    return {
      ruleId: rule.id,
      field: 'format',
      outcome: rule.allowed.includes(metadata.format) ? 'pass' : 'fail',
      expected: names,
      actual: metadata.format.toUpperCase(),
    };
  }

  if (rule.field === 'fileSize') {
    const bounds = applyOperator(
      { ...UNBOUNDED },
      rule.operator,
      toBytes(rule.value, rule.unit, convention),
    );
    return {
      ruleId: rule.id,
      field: 'fileSize',
      outcome: satisfies(metadata.byteLength, bounds) ? 'pass' : 'fail',
      expected: describeBounds(bounds, formatBytes),
      actual: formatBytes(metadata.byteLength),
    };
  }

  const measured = rule.field === 'width' ? metadata.width : metadata.height;
  const bounds = applyOperator({ ...UNBOUNDED }, rule.operator, rule.value);
  return {
    ruleId: rule.id,
    field: rule.field,
    outcome: satisfies(measured, bounds) ? 'pass' : 'fail',
    expected: describeBounds(bounds, (value) => `${value} px`),
    actual: `${measured} px`,
  };
}

/**
 * Builds the per-rule report from *measured* candidate metadata.
 *
 * The metadata must come from decoding the produced bytes (see
 * services/verifier.ts). Passing in the encoder's requested parameters would
 * make this report a restatement of intent rather than a check (FR-09).
 */
export function buildValidationReport(
  candidate: Candidate,
  requirements: ConfirmedRequirements,
  checkedAt: number,
): ValidationReport {
  return {
    candidateId: candidate.id,
    jobRevision: candidate.jobRevision,
    results: requirements.rules.map((rule) =>
      evaluateRule(rule, candidate.metadata, requirements.byteConvention),
    ),
    warnings: [],
    checkedAt,
  };
}

/**
 * Export gate. Deliberately conservative: an `unresolved` result blocks export
 * just as a `fail` does, because an unread constraint is not a met constraint.
 */
export function allExactChecksPass(report: ValidationReport): boolean {
  return report.results.every(
    (result) => result.outcome === 'pass' || result.outcome === 'not-applicable',
  );
}
