/**
 * FormReady engine — the portable core.
 *
 * Everything exported here runs unchanged in a browser, in Node, and inside an
 * embedded JavaScript runtime on a phone. That is enforced, not merely
 * intended: `tests/enginePurity.test.ts` fails the build if anything in this
 * package reaches for the DOM, a canvas, a Blob, or a platform API.
 *
 * The engine decides *what* a compliant file looks like and *whether* a given
 * file complies. It never decides how pixels are encoded — that is the seam
 * each platform fills, by passing an encoder into `searchCandidates`.
 */

// What a requirement is, and what a job made of requirements looks like.
export type * from './types';

// Reading requirements out of instruction text.
export { extractRules, operatorFor, splitClauses } from './rules/extract';
export type { Ambiguity, ExtractionOptions, ExtractionResult } from './rules/extract';

// Deciding whether a measurement satisfies a requirement.
export {
  MAX_OUTPUT_DIMENSION,
  UNBOUNDED,
  allExactChecksPass,
  allowedFormats,
  applyOperator,
  buildValidationReport,
  dimensionBounds,
  findConflicts,
  formatBytes,
  isImpossible,
  isUsableRule,
  ruleProblem,
  satisfies,
  sizeBounds,
  toBytes,
  unitMultiplier,
} from './constraints';
export type { Bounds, Conflict } from './constraints';

// Validating untrusted rule proposals before they reach application state.
export { parseRuleProposal, ruleProposalSchema } from './schemas';
export type { ProposalParseResult, RuleProposal } from './schemas';

// Job lifecycle and the revision rule that invalidates stale results.
export { canExport, createJob, jobReducer } from './job/reducer';
export type { JobAction } from './job/reducer';
export {
  SNAPSHOT_VERSION,
  describeSnapshot,
  fromSnapshot,
  isWorthSaving,
  toSnapshot,
} from './job/snapshot';
export type { JobSnapshot } from './job/snapshot';

// Crop geometry, including the rotated-view to source-coordinate conversion.
export {
  MIN_CROP,
  centredCrop,
  clampCrop,
  resizeFromHandle,
  roundCrop,
  scaleAboutCentre,
  visualCropToSource,
  visualSize,
  withAspect,
} from './geometry/crop';
export type { Handle, Rotation, Size } from './geometry/crop';
export { fitWithinAspect, orientedSize } from './geometry/fit';

// The bounded search for an encoding that satisfies the confirmed rules.
export { DEFAULT_BUDGET, geometryLadder, searchCandidates } from './search/candidates';
export type {
  EncodeFn,
  EncodeRequest,
  EncodeResult,
  SearchBudget,
  SearchContext,
  SearchOutcome,
} from './search/candidates';

// Format identification and the input guardrails.
export { withExifOrientation } from './media/exif';
export {
  EXTENSION_BY_FORMAT,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  MIME_BY_FORMAT,
  sniffFormat,
} from './media/format';

// Output naming.
export { buildFilename } from './naming';
