/**
 * Optional language-model adapter for instruction text (P1).
 *
 * Two boundaries are enforced here and must stay enforced:
 *
 *   1. Only instruction *text* is ever sent anywhere. Document bytes never
 *      leave the device (NFR-04), so this module has no access to them.
 *   2. Model output is data, not control flow. It proposes rules, which are
 *      parsed through the schema and land in the UI as `proposed` for the user
 *      to confirm. It never decides what passes validation and never supplies
 *      a processing plan.
 *
 * Gated on the work-package-1 device test. Until that test passes, the app uses
 * the pattern extractor in features/requirements/extractRules.ts, and the UI
 * must not claim a model is running.
 */

import { parseRuleProposal, type ProposalParseResult } from '../domain/schemas';
import type { DocumentKind } from '../domain/types';

export interface ParserBackend {
  /** Returns unvalidated JSON. The caller is responsible for parsing it. */
  propose(text: string, kind: DocumentKind, signal?: AbortSignal): Promise<unknown>;
}

let backend: ParserBackend | null = null;

/**
 * Registered during startup only if the feasibility check succeeded. Absence is
 * the default and is not an error.
 */
export function registerParserBackend(candidate: ParserBackend | null): void {
  backend = candidate;
}

export function isModelParserAvailable(): boolean {
  return backend !== null;
}

/**
 * Returns `null` when no backend is registered, so callers fall back to pattern
 * extraction rather than blocking on an optional feature.
 */
export async function proposeRules(
  text: string,
  kind: DocumentKind,
  signal?: AbortSignal,
): Promise<ProposalParseResult | null> {
  if (!backend) return null;
  const raw = await backend.propose(text, kind, signal);
  return parseRuleProposal(raw);
}
