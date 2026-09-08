import type { SourceSpan } from '@formready/engine';

interface SourceEvidenceProps {
  text: string;
  span?: SourceSpan;
}

/**
 * Shows the phrase a rule was read from (FR-03).
 *
 * Offsets are re-checked against the current text before use: the user may have
 * edited the OCR output since extraction, in which case the stored offsets no
 * longer point at the right characters. The retained `span.text` is the
 * fallback, so evidence degrades to a quotation rather than to a wrong
 * highlight.
 */
export default function SourceEvidence({ text, span }: SourceEvidenceProps) {
  if (!span) {
    return <p className="evidence manual">Entered by you — not read from the instructions.</p>;
  }

  const stillAccurate = text.slice(span.start, span.end) === span.text;
  if (!stillAccurate) {
    return (
      <p className="evidence stale">
        From: <q>{span.text}</q> <span className="hint">(text has changed since)</span>
      </p>
    );
  }

  return (
    <p className="evidence">
      {text.slice(Math.max(0, span.start - 30), span.start)}
      <mark>{span.text}</mark>
      {text.slice(span.end, span.end + 30)}
    </p>
  );
}
