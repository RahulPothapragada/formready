/**
 * Core data contracts for FormReady.
 *
 * Mirrors section 9 of the product specification. Two rules govern everything
 * here:
 *   1. An absent constraint is not a zero-valued constraint.
 *   2. Anything the app cannot check exactly stays a manual check, and is never
 *      folded into a generic "all requirements passed".
 */

export type DocumentKind = 'photo' | 'signature' | 'printed' | 'other';

/** Formats the P0 preparation pipeline can decode and encode. */
export type ImageFormat = 'jpeg' | 'png';

export type RuleField = 'format' | 'fileSize' | 'width' | 'height';

/**
 * Comparison meaning is preserved from the source text: "under 50 KB" is `lt`,
 * "up to 50 KB" is `lte`. Collapsing the two changes which files pass.
 */
export type ComparisonOperator = 'lt' | 'lte' | 'gt' | 'gte' | 'eq';

/** KB as 1000 bytes (decimal) or 1024 bytes (binary). Confirmed once per job. */
export type ByteConvention = 'decimal' | 'binary';

export type SizeUnit = 'B' | 'KB' | 'MB';

/** Whether a rule came from the instructions or was typed by the user. */
export type RuleOrigin = 'extracted' | 'manual';

/**
 * `unresolved` means the constraint was seen but could not be read confidently.
 * It is distinct from a constraint that was never specified at all, which
 * simply has no rule.
 */
export type RuleReviewState = 'proposed' | 'confirmed' | 'unresolved' | 'rejected';

/** Character range in an InstructionSource, used to show supporting evidence. */
export interface SourceSpan {
  sourceId: string;
  /** Inclusive start offset into the reviewed text. */
  start: number;
  /** Exclusive end offset into the reviewed text. */
  end: number;
  /** The matched substring, retained so evidence survives later text edits. */
  text: string;
}

interface RuleBase {
  id: string;
  origin: RuleOrigin;
  reviewState: RuleReviewState;
  /** Required when origin is 'extracted'; absent for manual entry. */
  sourceSpan?: SourceSpan;
  /** Operator-visible explanation, e.g. why a value is unresolved. */
  note?: string;
}

export interface FormatRule extends RuleBase {
  field: 'format';
  allowed: ImageFormat[];
}

export interface FileSizeRule extends RuleBase {
  field: 'fileSize';
  operator: ComparisonOperator;
  value: number;
  unit: SizeUnit;
}

export interface DimensionRule extends RuleBase {
  field: 'width' | 'height';
  operator: ComparisonOperator;
  value: number;
  unit: 'px';
}

export type Rule = FormatRule | FileSizeRule | DimensionRule;

/**
 * An instruction the app cannot verify (DPI, background colour, photo recency).
 * Surfaced to the user verbatim rather than silently dropped.
 */
export interface ManualCheck {
  id: string;
  text: string;
  sourceSpan?: SourceSpan;
  acknowledged: boolean;
}

export interface InstructionSource {
  id: string;
  type: 'screenshot' | 'pasted-text';
  /** OCR output or the original paste. Never mutated. */
  originalText: string;
  /** User corrections. Diverges from originalText once edited. */
  editedText: string;
  /** Present for screenshots, for optional bounding-box overlays. */
  imageBlob?: Blob;
}

/**
 * Immutable snapshot taken at confirmation time. A preparation run is always
 * validated against the snapshot it started with, never against live state.
 */
export interface ConfirmedRequirements {
  rules: Rule[];
  byteConvention: ByteConvention;
  manualChecks: ManualCheck[];
  documentKind: DocumentKind;
  confirmedAt: number;
}

export interface SourceDocument {
  id: string;
  /** Original bytes exactly as picked. Never re-encoded. */
  blob: Blob;
  filename: string;
  /** Format from decoding the bytes, not from the file extension. */
  decodedFormat: ImageFormat;
  /** Dimensions after EXIF orientation is applied. */
  width: number;
  height: number;
  /** Raw EXIF orientation value, retained for diagnostics. */
  orientation: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The only geometry the pipeline is permitted to apply. Bound to a specific
 * source and job revision so a stale plan can never be executed.
 */
export interface TransformPlan {
  sourceId: string;
  jobRevision: number;
  crop: CropRect | null;
  /** Clockwise degrees, user-approved. */
  rotation: 0 | 90 | 180 | 270;
  targetWidth: number;
  targetHeight: number;
  format: ImageFormat;
  /** JPEG only. PNG ignores the canvas quality argument entirely. */
  quality?: number;
}

/** Measured properties of produced bytes. Populated only by the verifier. */
export interface CandidateMetadata {
  format: ImageFormat;
  byteLength: number;
  width: number;
  height: number;
}

export interface Candidate {
  id: string;
  blob: Blob;
  sourceId: string;
  jobRevision: number;
  metadata: CandidateMetadata;
  /** How many encode attempts the search spent reaching this candidate. */
  attempts: number;
}

export type CheckOutcome = 'pass' | 'fail' | 'not-applicable' | 'unresolved';

export interface RuleResult {
  ruleId: string;
  field: RuleField;
  outcome: CheckOutcome;
  /** Human-readable requirement, e.g. "at most 49,999 bytes". */
  expected: string;
  /** Human-readable measurement, e.g. "43,612 bytes". */
  actual: string;
}

export interface ValidationReport {
  candidateId: string;
  jobRevision: number;
  results: RuleResult[];
  /** Estimates and heuristics. Never presented as exact checks. */
  warnings: string[];
  checkedAt: number;
}

/**
 * The user's own confirmation that the output is readable. Deliberately
 * separate from ValidationReport: this is a human finding, not a measurement.
 */
export interface UserReview {
  candidateId: string;
  jobRevision: number;
  visuallyReviewed: boolean;
  acknowledgedManualCheckIds: string[];
  reviewedAt: number;
}

/** Job lifecycle from section 10 of the specification. */
export type JobStatus =
  | 'EMPTY'
  | 'INSTRUCTIONS_ADDED'
  | 'RULES_REVIEW'
  | 'RULES_CONFIRMED'
  | 'DOCUMENT_READY'
  | 'PREPARING'
  | 'NEEDS_FIX'
  | 'OUTPUT_REVIEW'
  | 'EXPORT_READY'
  | 'EXPORTED';

export interface Job {
  id: string;
  /**
   * Increments whenever the source document, crop, or confirmed rules change.
   * Any candidate, report, or review carrying an older revision is stale and
   * cannot be exported.
   */
  revision: number;
  status: JobStatus;
  documentKind: DocumentKind;
  instructionSource: InstructionSource | null;
  proposedRules: Rule[];
  proposedManualChecks: ManualCheck[];
  byteConvention: ByteConvention;
  confirmed: ConfirmedRequirements | null;
  source: SourceDocument | null;
  transform: TransformPlan | null;
  candidate: Candidate | null;
  report: ValidationReport | null;
  review: UserReview | null;
  /** Set when preparation fails, drives the NEEDS_FIX recovery panel. */
  failure: PreparationFailure | null;
}

export type PreparationFailureKind =
  | 'no-candidate-in-budget'
  | 'min-size-unreachable'
  | 'png-size-not-controllable'
  | 'geometry-conflict'
  | 'decode-failed'
  | 'cancelled';

export interface PreparationFailure {
  kind: PreparationFailureKind;
  /** Shown verbatim to the user; see section 12 of the specification. */
  message: string;
  /** Recovery actions the UI should offer, in order. */
  suggestions: Array<'adjust-crop' | 'review-requirements' | 'choose-clearer-image'>;
}
