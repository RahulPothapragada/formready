/**
 * Output file naming.
 *
 * Pure, and deliberately not part of the export path: a file is named after its
 * *decoded* format, so a JPEG can never leave with a `.png` extension (FR-13).
 * Every platform that exports a file needs the same rule.
 */

import { EXTENSION_BY_FORMAT } from './media/format';
import type { Candidate, DocumentKind } from './types';

const KIND_LABEL: Record<DocumentKind, string> = {
  photo: 'photo',
  signature: 'signature',
  printed: 'document',
  other: 'file',
};

export function buildFilename(
  candidate: Candidate,
  kind: DocumentKind,
  stamp: string,
): string {
  return `formready-${KIND_LABEL[kind]}-${stamp}.${EXTENSION_BY_FORMAT[candidate.metadata.format]}`;
}
