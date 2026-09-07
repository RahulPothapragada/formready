/**
 * Pattern-based extraction of supported constraints from instruction text.
 *
 * Every rule carries the exact character span it came from, so the requirements
 * screen can highlight the supporting phrase (FR-03). Nothing here invents a
 * limit the text did not state, and everything is emitted as `proposed` —
 * confirmation is a separate, explicit user act.
 *
 * Parsing is **clause by clause** rather than by scanning a fixed window of
 * characters before each number. A window is wrong in ways that quietly reverse
 * meaning: "under 50 KB, 200 x 230 pixels" let the size qualifier reach across
 * a comma and turn the dimensions into maximums, and "not less than 20 KB"
 * matched the "less than" inside its own negation. Clauses bound a qualifier to
 * the value it actually governs.
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
  /** Rules scoped to a different upload are excluded from the result. */
  documentKind: DocumentKind;
  /** Injected so tests get stable ids instead of random ones. */
  makeId?: (prefix: string, index: number) => string;
}

const defaultMakeId = (prefix: string, index: number) => `${prefix}-${index}`;

/** Which upload a clause is talking about, when it says. */
type Subject = 'photo' | 'signature' | null;

interface Clause {
  text: string;
  /** Offset of this clause within the whole instruction text. */
  offset: number;
  subject: Subject;
}

/**
 * Comparison phrases, most specific first.
 *
 * Negated forms lead, and a match contained inside a longer match is discarded
 * before the nearest one is chosen — otherwise the "less than" inside "not less
 * than" wins on position and inverts the requirement.
 */
const OPERATOR_PHRASES: Array<[RegExp, ComparisonOperator]> = [
  [/\b(?:not|no)\s+(?:less\s+than|smaller\s+than|lower\s+than|below|under)\b/gi, 'gte'],
  [/\b(?:not|no)\s+(?:more\s+than|greater\s+than|larger\s+than|bigger\s+than|above|exceeding)\b/gi, 'lte'],
  [/\bnot\s+exceed(?:ing)?\b/gi, 'lte'],
  [/\b(?:at\s+least|minimum|minimum\s+of|min\.?|atleast)\b/gi, 'gte'],
  [/\b(?:more\s+than|greater\s+than|larger\s+than|above|exceeding)\b/gi, 'gt'],
  [/\b(?:less\s+than|under|below|smaller\s+than)\b/gi, 'lt'],
  [/\b(?:up\s?to|at\s+most|maximum|maximum\s+of|max\.?|within|upto|no\s+bigger\s+than)\b/gi, 'lte'],
  [/\bexactly\b/gi, 'eq'],
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

const PHYSICAL_UNIT = /^\s*(?:cm|mm|centimet|millimet|inch|inches|in\b|")/i;

/** Marks a format mention as forbidden rather than permitted. */
const PROHIBITION =
  /\b(?:not\s+(?:allowed|accepted|permitted|supported)|no[t]?\s+be\s+accepted|cannot\s+be|will\s+be\s+rejected|is\s+forbidden|avoid)\b/i;

const EXCLUSIVE = /\bonly\b/i;

/** Instruction phrases FormReady cannot check. Kept verbatim for the user. */
const MANUAL_CHECK_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d+\s*dpi\b/i, 'Resolution in DPI cannot be verified from the file alone.'],
  [/\b(?:white|plain|light|blue)\s+background\b/i, 'Background colour needs your review.'],
  [/\bwithout\s+(?:cap|hat|glasses|spectacles)\b/i, 'This condition needs your review.'],
  [/\brecent(?:ly)?\s+(?:taken|clicked)?\s*photograph?\b/i, 'Photo recency needs your review.'],
  [/\b(?:black|blue)\s+ink\b/i, 'Ink colour needs your review.'],
  [/\bsignature\s+(?:should|must)\s+be\s+(?:clear|legible)\b/i, 'Legibility needs your review.'],
  [/\b\d+(?:\.\d+)?\s*(?:cm|mm|inch(?:es)?)\b/i, 'Physical dimensions need your review.'],
];

/** Parses a matched number, dropping any thousands separators. */
function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

function span(sourceId: string, text: string, start: number, end: number): SourceSpan {
  return { sourceId, start, end, text: text.slice(start, end) };
}

/**
 * Splits instructions into clauses, carrying the last named upload forward.
 *
 * Commas separate clauses only when not sitting inside a number, so "20,000
 * bytes" stays whole while "under 50 KB, 200 x 230 pixels" becomes two.
 */
export function splitClauses(text: string): Clause[] {
  const clauses: Clause[] = [];
  const boundary = /[.;\n]|,(?!\d)/g;
  let start = 0;
  let carried: Subject = null;

  const push = (from: number, to: number) => {
    const slice = text.slice(from, to);
    if (!slice.trim()) return;
    const subject = subjectOf(slice);
    if (subject) carried = subject;
    clauses.push({ text: slice, offset: from, subject: subject ?? carried });
  };

  for (const match of text.matchAll(boundary)) {
    push(start, match.index!);
    start = match.index! + 1;
  }
  push(start, text.length);

  return clauses;
}

function subjectOf(text: string): Subject {
  const photo = /\bphotograph?\b|\bphoto\b|\bpicture\b/i.test(text);
  const signature = /\bsignature\b|\bsign\b/i.test(text);
  // A clause naming both scopes to neither; the ambiguity is reported instead.
  if (photo && signature) return null;
  if (photo) return 'photo';
  if (signature) return 'signature';
  return null;
}

/** Does a rule scoped to `subject` apply to the upload being prepared? */
function appliesTo(subject: Subject, kind: DocumentKind): boolean {
  if (subject === null) return true;
  return subject === kind;
}

interface PhraseMatch {
  operator: ComparisonOperator;
  start: number;
  end: number;
}

/**
 * The comparison governing a value at `valueOffset` within a clause.
 *
 * Matches contained inside a longer match are dropped, then the nearest
 * remaining match before the value wins.
 */
export function operatorFor(clause: string, valueOffset: number): ComparisonOperator | null {
  const matches: PhraseMatch[] = [];
  for (const [pattern, operator] of OPERATOR_PHRASES) {
    for (const match of clause.matchAll(pattern)) {
      matches.push({ operator, start: match.index!, end: match.index! + match[0].length });
    }
  }

  const outermost = matches.filter(
    (candidate) =>
      !matches.some(
        (other) =>
          other !== candidate && other.start <= candidate.start && other.end >= candidate.end,
      ),
  );

  const before = outermost.filter((match) => match.end <= valueOffset);
  if (before.length === 0) return null;

  return before.reduce((best, match) => (match.start > best.start ? match : best)).operator;
}

interface ScopedRule {
  rule: Rule;
  subject: Subject;
}

function extractSizeRules(
  clauses: Clause[],
  text: string,
  options: Required<ExtractionOptions>,
  ambiguities: Ambiguity[],
): ScopedRule[] {
  const scoped: ScopedRule[] = [];
  let index = 0;

  const unitPattern = 'b|bytes?|kb|kib|kilobytes?|mb|mib|megabytes?';
  // Thousands-grouped form first, so "20,000 bytes" is one number rather than
  // a failed match followed by a stray "000".
  const numberPattern = '\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?';
  const rangePattern = new RegExp(
    `(?:between\\s+)?(${numberPattern})\\s*(${unitPattern})?\\s*(?:to|–|—|-|and)\\s*(${numberPattern})\\s*(${unitPattern})`,
    'gi',
  );
  const singlePattern = new RegExp(`(${numberPattern})\\s*(${unitPattern})\\b`, 'gi');

  for (const clause of clauses) {
    const consumed: Array<[number, number]> = [];

    for (const match of clause.text.matchAll(rangePattern)) {
      const start = clause.offset + match.index!;
      const end = start + match[0].length;
      const upperUnit = SIZE_UNITS[match[4].toLowerCase()];
      const lowerUnit = match[2] ? SIZE_UNITS[match[2].toLowerCase()] : upperUnit;
      const evidence = span(options.sourceId, text, start, end);

      scoped.push({
        subject: clause.subject,
        rule: {
          id: options.makeId('size-min', index++),
          field: 'fileSize',
          operator: 'gte',
          value: toNumber(match[1]),
          unit: lowerUnit,
          origin: 'extracted',
          reviewState: 'proposed',
          sourceSpan: evidence,
        },
      });
      scoped.push({
        subject: clause.subject,
        rule: {
          id: options.makeId('size-max', index++),
          field: 'fileSize',
          operator: 'lte',
          value: toNumber(match[3]),
          unit: upperUnit,
          origin: 'extracted',
          reviewState: 'proposed',
          sourceSpan: evidence,
        },
      });
      consumed.push([match.index!, match.index! + match[0].length]);
    }

    for (const match of clause.text.matchAll(singlePattern)) {
      const localStart = match.index!;
      if (consumed.some(([from, to]) => localStart >= from && localStart < to)) continue;

      const start = clause.offset + localStart;
      const end = start + match[0].length;
      const unit = SIZE_UNITS[match[2].toLowerCase()];
      const operator = operatorFor(clause.text, localStart);
      const evidence = span(options.sourceId, text, start, end);

      if (!operator) {
        // A bare size could be a maximum, a minimum, or an example. The user
        // decides; the app does not guess.
        ambiguities.push({
          text: match[0],
          reason: 'This size has no stated limit direction. Choose maximum or minimum.',
          sourceSpan: evidence,
        });
        scoped.push({
          subject: clause.subject,
          rule: {
            id: options.makeId('size', index++),
            field: 'fileSize',
            operator: 'lte',
            value: toNumber(match[1]),
            unit,
            origin: 'extracted',
            reviewState: 'unresolved',
            sourceSpan: evidence,
            note: 'No limit direction stated in the instructions.',
          },
        });
        continue;
      }

      scoped.push({
        subject: clause.subject,
        rule: {
          id: options.makeId('size', index++),
          field: 'fileSize',
          operator,
          value: toNumber(match[1]),
          unit,
          origin: 'extracted',
          reviewState: 'proposed',
          sourceSpan: evidence,
        },
      });
    }
  }

  if (/\b(?:kib|mib)\b/i.test(text)) {
    ambiguities.push({
      text: 'KiB/MiB',
      reason: 'These instructions use binary units. Confirm 1 KB = 1024 bytes.',
    });
  }

  return scoped;
}

function extractDimensionRules(
  clauses: Clause[],
  text: string,
  options: Required<ExtractionOptions>,
  ambiguities: Ambiguity[],
): ScopedRule[] {
  const scoped: ScopedRule[] = [];
  let index = 0;

  const pairPattern = /(\d{2,5})\s*[x×*]\s*(\d{2,5})\s*(px|pixels?)?/gi;

  // "between 200 x 230 and 300 x 350 pixels" states a min/max box, not two
  // exact sizes. Without this, each pair below is read as its own `eq` rule
  // and the two conflict — a genuine requirement becomes a false "these
  // requirements contradict each other" (FR-05 exists to catch real
  // conflicts, not ones this parser invented).
  const dimensionRangePattern = new RegExp(
    '(?:between\\s+)?(\\d{2,5})\\s*[x×*]\\s*(\\d{2,5})\\s*(?:to|–|—|-|and)\\s*(\\d{2,5})\\s*[x×*]\\s*(\\d{2,5})\\s*(px|pixels?)?',
    'gi',
  );

  for (const clause of clauses) {
    const consumed: Array<[number, number]> = [];

    for (const match of clause.text.matchAll(dimensionRangePattern)) {
      const localStart = match.index!;
      const localEnd = localStart + match[0].length;
      const trailing = clause.text.slice(localEnd);
      consumed.push([localStart, localEnd]);

      if (PHYSICAL_UNIT.test(trailing)) {
        ambiguities.push({
          text: `${match[0]}${trailing.slice(0, 4).trimEnd()}`,
          reason:
            'These are physical dimensions, not pixels. FormReady cannot convert them without a DPI value — check this one yourself.',
          sourceSpan: span(options.sourceId, text, clause.offset + localStart, clause.offset + localEnd),
        });
        continue;
      }

      const evidence = span(
        options.sourceId,
        text,
        clause.offset + localStart,
        clause.offset + localEnd,
      );
      if (!match[5]) {
        ambiguities.push({
          text: match[0],
          reason: 'No unit was given for these dimensions. They are assumed to be pixels.',
          sourceSpan: evidence,
        });
      }

      const [w1, h1, w2, h2] = [match[1], match[2], match[3], match[4]].map(Number);
      for (const [axis, lo, hi] of [
        ['width', Math.min(w1, w2), Math.max(w1, w2)],
        ['height', Math.min(h1, h2), Math.max(h1, h2)],
      ] as const) {
        scoped.push({
          subject: clause.subject,
          rule: {
            id: options.makeId(`${axis}-min`, index),
            field: axis,
            operator: 'gte',
            value: lo,
            unit: 'px',
            origin: 'extracted',
            reviewState: 'proposed',
            sourceSpan: evidence,
          },
        });
        scoped.push({
          subject: clause.subject,
          rule: {
            id: options.makeId(`${axis}-max`, index),
            field: axis,
            operator: 'lte',
            value: hi,
            unit: 'px',
            origin: 'extracted',
            reviewState: 'proposed',
            sourceSpan: evidence,
          },
        });
      }
      index += 1;
    }

    for (const match of clause.text.matchAll(pairPattern)) {
      const localStart = match.index!;
      if (consumed.some(([from, to]) => localStart >= from && localStart < to)) continue;
      const localEnd = localStart + match[0].length;
      const trailing = clause.text.slice(localEnd);

      // "35 x 45 mm" is a physical size. Reading it as pixels would silently
      // produce a 35-pixel-wide photograph, so it is left for manual review.
      if (PHYSICAL_UNIT.test(trailing)) {
        ambiguities.push({
          text: `${match[0]}${trailing.slice(0, 4).trimEnd()}`,
          reason:
            'These are physical dimensions, not pixels. FormReady cannot convert them without a DPI value — check this one yourself.',
          sourceSpan: span(options.sourceId, text, clause.offset + localStart, clause.offset + localEnd),
        });
        continue;
      }

      const evidence = span(
        options.sourceId,
        text,
        clause.offset + localStart,
        clause.offset + localEnd,
      );
      const operator = operatorFor(clause.text, localStart) ?? 'eq';

      if (!match[3]) {
        ambiguities.push({
          text: match[0],
          reason: 'No unit was given for these dimensions. They are assumed to be pixels.',
          sourceSpan: evidence,
        });
      }

      for (const [axis, value] of [
        ['width', match[1]],
        ['height', match[2]],
      ] as const) {
        scoped.push({
          subject: clause.subject,
          rule: {
            id: options.makeId(axis, index),
            field: axis,
            operator,
            value: Number(value),
            unit: 'px',
            origin: 'extracted',
            reviewState: 'proposed',
            sourceSpan: evidence,
          },
        });
      }
      index += 1;
    }

    const axisPattern = /\b(width|height)\b[^.\n]{0,24}?(\d{2,5})\s*(?:px|pixels?)/gi;
    for (const match of clause.text.matchAll(axisPattern)) {
      const localStart = match.index!;
      scoped.push({
        subject: clause.subject,
        rule: {
          id: options.makeId(match[1].toLowerCase(), index++),
          field: match[1].toLowerCase() as 'width' | 'height',
          operator: operatorFor(clause.text, localStart) ?? 'eq',
          value: Number(match[2]),
          unit: 'px',
          origin: 'extracted',
          reviewState: 'proposed',
          sourceSpan: span(
            options.sourceId,
            text,
            clause.offset + localStart,
            clause.offset + localStart + match[0].length,
          ),
        },
      });
    }
  }

  return scoped;
}

/**
 * Collects the formats the instructions permit.
 *
 * A mention is not permission: "PNG is not allowed" names PNG in order to
 * forbid it, and "only JPEG" excludes everything unnamed. Both are read before
 * anything is proposed.
 */
function extractFormatRule(
  clauses: Clause[],
  text: string,
  options: Required<ExtractionOptions>,
  ambiguities: Ambiguity[],
): ScopedRule | null {
  const permitted = new Set<ImageFormat>();
  const forbidden = new Set<ImageFormat>();
  let exclusive: ImageFormat[] | null = null;
  let evidence: SourceSpan | null = null;
  let subject: Subject = null;

  for (const clause of clauses) {
    const mentions: Array<{ format: ImageFormat; start: number; end: number }> = [];
    for (const match of clause.text.matchAll(/\b(jpe?g|png)\b/gi)) {
      mentions.push({
        format: match[1].toLowerCase().startsWith('jp') ? 'jpeg' : 'png',
        start: match.index!,
        end: match.index! + match[0].length,
      });
    }
    if (mentions.length === 0) continue;

    evidence ??= span(
      options.sourceId,
      text,
      clause.offset + mentions[0].start,
      clause.offset + mentions[0].end,
    );
    subject ??= clause.subject;

    const prohibits = PROHIBITION.test(clause.text);
    for (const mention of mentions) {
      (prohibits ? forbidden : permitted).add(mention.format);
    }

    if (!prohibits && EXCLUSIVE.test(clause.text)) {
      exclusive = mentions.map((mention) => mention.format);
    }
  }

  if (!evidence) return null;

  let allowed = exclusive ?? [...permitted];
  allowed = allowed.filter((format) => !forbidden.has(format));

  if (allowed.length === 0) {
    ambiguities.push({
      text: [...forbidden].map((format) => format.toUpperCase()).join(', '),
      reason:
        'These instructions rule out every format FormReady can produce. Choose the format for this upload yourself.',
      sourceSpan: evidence,
    });
    return null;
  }

  return {
    subject,
    rule: {
      id: options.makeId('format', 0),
      field: 'format',
      allowed,
      origin: 'extracted',
      reviewState: 'proposed',
      sourceSpan: evidence,
    },
  };
}

function extractManualChecks(
  text: string,
  options: Required<ExtractionOptions>,
): ManualCheck[] {
  const checks: ManualCheck[] = [];
  MANUAL_CHECK_PATTERNS.forEach(([pattern, reason], patternIndex) => {
    const match = pattern.exec(text);
    if (match?.index === undefined) return;
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
  const resolved: Required<ExtractionOptions> = { makeId: defaultMakeId, ...options };
  const ambiguities: Ambiguity[] = [];
  const clauses = splitClauses(text);

  const scoped: ScopedRule[] = [
    ...extractSizeRules(clauses, text, resolved, ambiguities),
    ...extractDimensionRules(clauses, text, resolved, ambiguities),
  ];
  const format = extractFormatRule(clauses, text, resolved, ambiguities);
  if (format) scoped.push(format);

  // Rules belonging to a different upload are dropped rather than merged. The
  // signature limit in a photograph's instructions is not the photograph's.
  const applicable = scoped.filter((entry) => appliesTo(entry.subject, resolved.documentKind));
  const excluded = scoped.filter((entry) => !appliesTo(entry.subject, resolved.documentKind));

  if (excluded.length > 0) {
    const others = [...new Set(excluded.map((entry) => entry.subject))].filter(Boolean);
    ambiguities.push({
      text: others.join(' and '),
      reason: `These instructions also cover a ${others.join(' and ')}. Those requirements were left out — change "This file is a" above if you meant one of them.`,
    });
  }

  const rules = applicable.map((entry) => entry.rule);
  const manualChecks = extractManualChecks(text, resolved);

  if (rules.length === 0 && text.trim().length > 0) {
    ambiguities.push({
      text: text.slice(0, 120),
      reason:
        'No supported file requirement was found for this upload. Add a size, format, or dimension target yourself.',
    });
  }

  return { rules, manualChecks, ambiguities };
}
