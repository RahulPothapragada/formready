import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilePicker from '../../components/FilePicker';
import RequirementEditor from './RequirementEditor';
import { extractRules, type Ambiguity } from './extractRules';
import { useJob } from '../../app/JobContext';
import { findConflicts } from '../../domain/constraints';
import { recognize } from '../../services/ocr';
import type { DocumentKind } from '../../domain/types';

const DOCUMENT_KINDS: Array<{ value: DocumentKind; label: string }> = [
  { value: 'photo', label: 'Photograph' },
  { value: 'signature', label: 'Signature' },
  { value: 'printed', label: 'Printed document' },
  { value: 'other', label: 'Other image' },
];

/**
 * Screen 1. Turns whatever the user is looking at into a confirmed rule set.
 *
 * Nothing here is confirmed automatically. Extraction produces proposals; the
 * user ticks the ones that apply. Conflicts block the Confirm action outright.
 */
export default function RequirementsPage() {
  const { job, dispatch } = useJob();
  const navigate = useNavigate();
  const [ocrStage, setOcrStage] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const [ambiguities, setAmbiguities] = useState<Ambiguity[]>([]);

  const text = job.instructionSource?.editedText ?? '';
  const conflicts = useMemo(
    () => findConflicts(job.proposedRules, job.byteConvention),
    [job.proposedRules, job.byteConvention],
  );
  const confirmedCount = job.proposedRules.filter((r) => r.reviewState === 'confirmed').length;

  const runExtraction = (nextText: string, sourceId: string) => {
    const result = extractRules(nextText, {
      sourceId,
      documentKind: job.documentKind,
      makeId: (prefix, index) => `${prefix}-${index}-${sourceId.slice(0, 8)}`,
    });
    dispatch({ type: 'SET_PROPOSALS', rules: result.rules, manualChecks: result.manualChecks });
    setAmbiguities(result.ambiguities);
  };

  const handleScreenshot = async (file: File) => {
    const sourceId = crypto.randomUUID();
    setOcrError(null);
    dispatch({
      type: 'ADD_INSTRUCTIONS',
      source: { id: sourceId, type: 'screenshot', originalText: '', editedText: '', imageBlob: file },
    });

    try {
      const outcome = await recognize(file, {
        jobId: sourceId,
        onProgress: (progress) => setOcrStage(progress.stage),
      });
      dispatch({
        type: 'ADD_INSTRUCTIONS',
        source: {
          id: sourceId,
          type: 'screenshot',
          originalText: outcome.text,
          editedText: outcome.text,
          imageBlob: file,
        },
      });
      runExtraction(outcome.text, sourceId);
    } catch {
      // OCR failure is recoverable: the text area below stays available.
      setOcrError('Paste the instructions or enter the file requirements.');
    } finally {
      setOcrStage(null);
    }
  };

  const handlePaste = (value: string) => {
    const sourceId = job.instructionSource?.id ?? crypto.randomUUID();
    if (!job.instructionSource) {
      dispatch({
        type: 'ADD_INSTRUCTIONS',
        source: { id: sourceId, type: 'pasted-text', originalText: value, editedText: value },
      });
    } else {
      dispatch({ type: 'EDIT_INSTRUCTION_TEXT', text: value });
    }
    runExtraction(value, sourceId);
  };

  return (
    <section className="page requirements-page">
      <h2>What does the form ask for?</h2>

      <FilePicker label="Add instruction screenshot" onSelect={handleScreenshot} />
      {ocrStage ? <p className="progress">Reading the screenshot: {ocrStage}</p> : null}
      {ocrError ? (
        <p className="error" role="alert">
          {ocrError}
        </p>
      ) : null}

      <label className="field">
        <span>Instructions</span>
        <textarea
          rows={6}
          value={text}
          placeholder="Paste the upload instructions here"
          onChange={(event) => handlePaste(event.target.value)}
        />
      </label>

      <label className="field">
        <span>This file is a</span>
        <select
          value={job.documentKind}
          onChange={(event) =>
            dispatch({ type: 'SET_DOCUMENT_KIND', kind: event.target.value as DocumentKind })
          }
        >
          {DOCUMENT_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="field">
        <legend>When these instructions say KB, that means</legend>
        {/* Confirmed once per job so the user is not asked repeatedly. */}
        <label>
          <input
            type="radio"
            checked={job.byteConvention === 'decimal'}
            onChange={() => dispatch({ type: 'SET_BYTE_CONVENTION', convention: 'decimal' })}
          />
          1,000 bytes
        </label>
        <label>
          <input
            type="radio"
            checked={job.byteConvention === 'binary'}
            onChange={() => dispatch({ type: 'SET_BYTE_CONVENTION', convention: 'binary' })}
          />
          1,024 bytes
        </label>
      </fieldset>

      <h3>Requirements found</h3>
      {job.proposedRules.length === 0 ? (
        <p className="hint">
          No supported requirement found yet. Add the instructions above, or set a target yourself.
        </p>
      ) : (
        <ul className="requirement-list">
          {job.proposedRules.map((rule) => (
            <RequirementEditor
              key={rule.id}
              rule={rule}
              sourceText={text}
              onChange={(next) => dispatch({ type: 'UPDATE_RULE', rule: next })}
              onRemove={(ruleId) => dispatch({ type: 'REMOVE_RULE', ruleId })}
            />
          ))}
        </ul>
      )}

      {ambiguities.length > 0 ? (
        <section className="ambiguities">
          <h3>Needs your decision</h3>
          <ul>
            {ambiguities.map((item, index) => (
              <li key={index}>
                <q>{item.text}</q> — {item.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {job.proposedManualChecks.length > 0 ? (
        <section className="manual-checks">
          <h3>You will need to check these yourself</h3>
          <ul>
            {job.proposedManualChecks.map((check) => (
              <li key={check.id}>{check.text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="error" role="alert">
          {conflicts.map((conflict) => (
            <p key={conflict.field}>{conflict.message}</p>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="primary"
        disabled={conflicts.length > 0 || confirmedCount === 0}
        onClick={() => {
          dispatch({ type: 'CONFIRM_REQUIREMENTS', confirmedAt: Date.now() });
          navigate('/document');
        }}
      >
        Confirm requirements
      </button>
      {confirmedCount === 0 ? (
        <p className="hint">Tick at least one requirement to continue.</p>
      ) : null}
    </section>
  );
}
