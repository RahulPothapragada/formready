import type { ManualCheck, ValidationReport } from '../../domain/types';

interface ValidationChecklistProps {
  report: ValidationReport;
  manualChecks: ManualCheck[];
  /** Ids of the manual requirements the user has confirmed individually. */
  acknowledged: string[];
  onAcknowledge: (id: string, checked: boolean) => void;
}

const OUTCOME_LABEL = {
  pass: 'Meets the confirmed requirement',
  fail: 'Does not meet the confirmed requirement',
  'not-applicable': 'Not used for this upload',
  unresolved: 'Could not be read — needs your review',
} as const;

const FIELD_LABEL = {
  format: 'Format',
  fileSize: 'Size',
  width: 'Width',
  height: 'Height',
} as const;

/**
 * The two lists are visually and structurally separate on purpose (FR-10).
 *
 * The first is arithmetic on measured bytes and pixels. The second is a set of
 * things a phone cannot determine — background colour, DPI, whether the photo
 * is recent. Merging them into one "all requirements passed" would claim
 * verification the app has not performed.
 */
export default function ValidationChecklist({
  report,
  manualChecks,
  acknowledged,
  onAcknowledge,
}: ValidationChecklistProps) {
  return (
    <>
      <section className="checklist exact">
        <h3>What we checked exactly</h3>
        <ul>
          {report.results.map((result) => (
            <li key={result.ruleId} className={result.outcome}>
              <span className="field">{FIELD_LABEL[result.field]}</span>
              <span className="actual">{result.actual}</span>
              <span className="expected">Required: {result.expected}</span>
              <span className="outcome">{OUTCOME_LABEL[result.outcome]}</span>
            </li>
          ))}
        </ul>
      </section>

      {manualChecks.length > 0 ? (
        <section className="checklist manual">
          <h3>What you need to check yourself</h3>
          <p className="hint">
            FormReady cannot verify these from the file. Confirm each one you have checked.
          </p>
          <ul>
            {manualChecks.map((check) => (
              <li key={check.id} className={acknowledged.includes(check.id) ? 'pass' : ''}>
                <label className="manual-ack">
                  <input
                    type="checkbox"
                    checked={acknowledged.includes(check.id)}
                    onChange={(event) => onAcknowledge(check.id, event.target.checked)}
                  />
                  <span>{check.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.warnings.length > 0 ? (
        <section className="checklist warnings">
          <h3>Estimates</h3>
          <p className="hint">These are guesses, not measurements.</p>
          <ul>
            {report.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
