/**
 * Pattern-based extraction of supported constraints from instruction text.
 *
 * Every rule this produces carries the exact character span it came from, so
 * the requirements screen can highlight the supporting phrase (FR-03). A number
 * that cannot be tied back to a span is not emitted — the user is asked for it
 * instead. Nothing here invents a limit that the text did not state.
 *
 * Output is always `proposed`. Confirmation is a separate, explicit user act.
 */

import type {
  ComparisonOperator,
  DocumentKind,
  ImageFormat,
  ManualCheck,
  Rule,
  SizeUnit,
  SourceSpan,
} from '../../domain/types';

export interface Ambiguity {
  text: string;
  reason: string;
  sourceSpan?: SourceSpan;
}

export interface ExtractionResult {
  rules: Rule[];
  manualChecks: ManualCheck[];
  ambiguities: Ambiguity[];
}

export interface ExtractionOptions {
  sourceId: string;
  documentKind: DocumentKind;
  /** Injected so tests get stable ids instead of random ones. */
  makeId?: (prefix: string, index: number) => string;
}

const defaultMakeId = (prefix: string, index: number) => `${prefix}-${index}`;

/**
 * Phrases that set an upper bound, mapped to the operator they actually mean.
 * "under" and "less than" exclude the stated value; "up to" and "maximum"
 * include it. Collapsing these would silently change which files pass.
 */
const UPPER_BOUND_PHRASES: Array<[RegExp, ComparisonOperator]> = [
  [/\b(?:less\s+than|under|below|smaller\s+than)\b/i, 'lt'],
  [/\b(?:up\s+to|at\s+most|maximum|max\.?|not\s+exceeding|no\s+more\s+than|within|upto)\b/i, 'lte'],
];

const LOWER_BOUND_PHRASES: Array<[RegExp, ComparisonOperator]> = [
  [/\b(?:more\s+than|greater\s+than|above|larger\s+than|exceeding)\b/i, 'gt'],
  [/\b(?:at\s+least|minimum|min\.?|no\s+less\s+than|not\s+less\s+than)\b/i, 'gte'],
];

const SIZE_UNITS: Record<string, SizeUnit> = {
  b: 'B',
  byte: 'B',
  bytes: 'B',
  kb: 'KB',
  kib: 'KB',
  kilobyte: 'KB',
  kilobytes: 'KB',
  mb: 'MB',
  mib: 'MB',
  megabyte: 'MB',
  megabytes: 'MB',
};

/** Instruction phrases FormReady cannot check. Kept verbatim for the user. */
const MANUAL_CHECK_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d+\s*dpi\b/i, 'Resolution in DPI cannot be verified from the file alone.'],
  [/\b(?:white|plain|light)\s+background\b/i, 'Background colour needs your review.'],
  [/\bwithout\s+(?:cap|hat|glasses|spectacles)\b/i, 'This condition needs your review.'],
  [/\brecent(?:ly)?\s+(?:taken|clicked)?\s*photograph?\b/i, 'Photo recency needs your review.'],
  [/\b(?:black|blue)\s+ink\b/i, 'Ink colour needs your review.'],
  [/\bsignature\s+(?:should|must)\s+be\s+(?:clear|legible)\b/i, 'Legibility needs your review.'],
  [/\b\d+(?:\.\d+)?\s*(?:cm|mm|inch(?:es)?|in)\b/i, 'Physical dimensions need your review.'],
];

function span(sourceId: string, text: string, start: number, end: number): SourceSpan {
  return { sourceId, start, end, text: text.slice(start, end) };
}

/**
 * Chooses the operator for a numeric match by looking at the words immediately
 * before it. The window is deliberately short — a qualifier six words away is
 * more likely to belong to a different sentence than to this number.
 */
function operatorBefore(text: string, matchStart: number): ComparisonOperator | null {
  const window = text.slice(Math.max(0, matchStart - 40), matchStart);
  for (const [pattern, operator] of [...UPPER_BOUND_PHRASES, ...LOWER_BOUND_PHRASES]) {
    if (pattern.test(window)) return operator;
  }
  return null;
}

function extractSizeRules(
  text: string,
  options: Required<ExtractionOptions>,
  ambiguities: Ambiguity[],
): Rule[] {
  const rules: Rule[] = [];
  let index = 0;

  // Ranges first ("between 20 KB and 50 KB", "20 KB to 50 KB"), so their two
  // numbers are not also picked up as two independent single bounds.
  const rangePattern =
    /(?:between\s+)?(\d+(?:\.\d+)?)\s*(b|bytes?|kb|kib|kilobytes?|mb|mib|megabytes?)?\s*(?:to|–|—|-|and)\s*(\d+(?:\.\d+)?)\s*(b|bytes?|kb|kib|kilobytes?|mb|mib|megabytes?)/gi;
  const consumed: Array<[number, number]> = [];

  for (const match of text.matchAll(rangePattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    const upperUnit = SIZE_UNITS[match[4].toLowerCase()];
    const lowerUnit = match[2] ? SIZE_UNITS[match[2].toLowerCase()] : upperUnit;
    const evidence = span(options.sourceId, text, start, end);

    rules.push({
      id: options.makeId('size-min', index++),
      field: 'fileSize',
      operator: 'gte',
      value: Number(match[1]),
      unit: lowerUnit,
      origin: 'extracted',
      reviewState: 'proposed',
      sourceSpan: evidence,
    });
    rules.push({
      id: options.makeId('size-max', index++),
      field: 'fileSize',
      operator: 'lte',
      value: Number(match[3]),
      unit: upperUnit,
      origin: 'extracted',
      reviewState: 'proposed',
      sourceSpan: evidence,
    });
    consumed.push([start, end]);
  }

  const singlePattern = /(\d+(?:\.\d+)?)\s*(b|bytes?|kb|kib|kilobytes?|mb|mib|megabytes?)\b/gi;
  for (const match of text.matchAll(singlePattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (consumed.some(([from, to]) => start >= from && end <= to)) continue;

    const unit = SIZE_UNITS[match[2].toLowerCase()];
    const operator = operatorBefore(text, start);
    const evidence = span(options.sourceId, text, start, end);

    if (!operator) {
      // A bare size with no qualifier could be a maximum, a minimum, or an
      // example. The user decides; the app does not guess.
      ambiguities.push({
        text: match[0],
        reason: 'This size has no stated limit direction. Choose maximum or minimum.',
        sourceSpan: evidence,
      });
      rules.push({
        id: options.makeId('size', index++),
        field: 'fileSize',
        operator: 'lte',
        value: Number(match[1]),
        unit,
        origin: 'extracted',
        reviewState: 'unresolved',
        sourceSpan: evidence,
        note: 'No limit direction stated in the instructions.',
      });
      continue;
    }

    rules.push({
      id: options.makeId('size', index++),
      field: 'fileSize',
      operator,
      value: Number(match[1]),
      unit,
      origin: 'extracted',
      reviewState: 'proposed',
      sourceSpan: evidence,
    });
  }

  // KiB/MiB spellings state the binary convention outright; KB/MB do not.
  if (/\b(?:kib|mib)\b/i.test(text)) {
    ambiguities.push({
      text: 'KiB/MiB',
      reason: 'These instructions use binary units. Confirm 1 KB = 1024 bytes.',
    });
  }

  return rules;
}

function extractDimensionRules(
  text: string,
  options: Required<ExtractionOptions>,
): Rule[] {
  const rules: Rule[] = [];
  let index = 0;

  // "200 x 230 pixels" and "200*230 px".
  const pairPattern = /(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*(?:px|pixels?)?/gi;
  for (const match of text.matchAll(pairPattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    const evidence = span(options.sourceId, text, start, end);
    const operator = operatorBefore(text, start) ?? 'eq';

    rules.push({
      id: options.makeId('width', index),
      field: 'width',
      operator,
      value: Number(match[1]),
      unit: 'px',
      origin: 'extracted',
      reviewState: 'proposed',
      sourceSpan: evidence,
    });
    rules.push({
      id: options.makeId('height', index),
      field: 'height',
      operator,
      value: Number(match[2]),
      unit: 'px',
      origin: 'extracted',
      reviewState: 'proposed',
      sourceSpan: evidence,
    });
    index += 1;
  }

  // "width 200 px", "height should be 230 pixels".
  const axisPattern = /\b(width|height)\b[^.\n]{0,24}?(\d{2,5})\s*(?:px|pixels?)/gi;
  for (const match of text.matchAll(axisPattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    rules.push({
      id: options.makeId(match[1].toLowerCase(), index++),
      field: match[1].toLowerCase() as 'width' | 'height',
      operator: operatorBefore(text, start) ?? 'eq',
      value: Number(match[2]),
      unit: 'px',
      origin: 'extracted',
      reviewState: 'proposed',
      sourceSpan: span(options.sourceId, text, start, end),
    });
  }

  return rules;
}

function extractFormatRule(
  text: string,
  options: Required<ExtractionOptions>,
): Rule | null {
  const formats = new Set<ImageFormat>();
  let first: SourceSpan | null = null;

  for (const match of text.matchAll(/\b(jpe?g|png)\b/gi)) {
    const start = match.index!;
    const end = start + match[0].length;
    formats.add(match[1].toLowerCase().startsWith('jp') ? 'jpeg' : 'png');
    first ??= span(options.sourceId, text, start, end);
  }

  if (formats.size === 0 || !first) return null;
  return {
    id: options.makeId('format', 0),
    field: 'format',
    allowed: [...formats],
    origin: 'extracted',
    reviewState: 'proposed',
    sourceSpan: first,
  };
}

function extractManualChecks(
  text: string,
  options: Required<ExtractionOptions>,
): ManualCheck[] {
  const checks: ManualCheck[] = [];
  MANUAL_CHECK_PATTERNS.forEach(([pattern, reason], patternIndex) => {
    const match = pattern.exec(text);
    if (!match?.index && match?.index !== 0) return;
    checks.push({
      id: options.makeId('manual', patternIndex),
      text: `${match[0]} — ${reason}`,
      sourceSpan: span(options.sourceId, text, match.index, match.index + match[0].length),
      acknowledged: false,
    });
  });
  return checks;
}

export function extractRules(text: string, options: ExtractionOptions): ExtractionResult {
  const resolved: Required<ExtractionOptions> = {
    makeId: defaultMakeId,
    ...options,
  };
  const ambiguities: Ambiguity[] = [];

  const rules: Rule[] = [
    ...extractSizeRules(text, resolved, ambiguities),
    ...extractDimensionRules(text, resolved),
  ];
  const format = extractFormatRule(text, resolved);
  if (format) rules.push(format);

  const manualChecks = extractManualChecks(text, resolved);

  if (rules.length === 0) {
    ambiguities.push({
      text: text.slice(0, 120),
      reason:
        'No supported file requirement was found. Add a size, format, or dimension target yourself.',
    });
  }

  // A photo and a signature limit in the same block must not be merged (FR-04).
  if (/\bphotograph?\b/i.test(text) && /\bsignature\b/i.test(text)) {
    ambiguities.push({
      text: 'photograph and signature',
      reason:
        'These instructions cover more than one upload. Confirm which one this file is for.',
    });
  }

  return { rules, manualChecks, ambiguities };
}
