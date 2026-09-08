import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ImagePreview from '../../components/ImagePreview';
import ValidationChecklist from './ValidationChecklist';
import { useJob } from '../../app/JobContext';
import { canExport } from '@formready/engine';
import { formatBytes } from '@formready/engine';
import { buildFilename, canShare, download, share } from '../../services/exportFile';
import { asBlob } from '@formready/browser';
import { stillMatchesReport } from '@formready/browser';

/**
 * Screen 4. The last point at which the user can see what they are about to
 * upload. Export stays disabled until the exact checks pass, the candidate
 * still belongs to the current job revision, and the user has confirmed they
 * looked at the result (FR-12).
 */
export default function ReviewPage() {
  const { job, dispatch } = useJob();
  const navigate = useNavigate();
  const [showOriginal, setShowOriginal] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!job.candidate || !job.report || !job.confirmed || !job.source) {
    return (
      <section className="page">
        <h2>Nothing to review yet</h2>
        <button type="button" onClick={() => navigate('/document')}>
          Choose a document
        </button>
      </section>
    );
  }

  // Stale-result protection: a candidate from an earlier revision is never
  // presented as valid, even though it is still in memory (FR-11).
  if (job.candidate.jobRevision !== job.revision) {
    return (
      <section className="page">
        <h2>The requirements changed</h2>
        <p>Prepare the file again to see checked results.</p>
        <button type="button" onClick={() => navigate('/prepare')}>
          Prepare the file again
        </button>
      </section>
    );
  }

  const filename = buildFilename(job.candidate, job.confirmed.documentKind, String(job.revision));
  const reviewed = job.review?.visuallyReviewed ?? false;
  const acknowledged = job.review?.acknowledgedManualCheckIds ?? [];
  const ready = canExport(job);

  /**
   * Each manual requirement is acknowledged on its own.
   *
   * One tick saying the document is readable used to acknowledge every manual
   * check, including things it says nothing about — background colour,
   * photograph recency, ink colour. Confirming a requirement the user was never
   * shown is the same overclaiming the exact/manual split exists to prevent.
   */
  const updateReview = (next: { reviewed?: boolean; checkIds?: string[] }) => {
    dispatch({
      type: 'SET_USER_REVIEW',
      review: {
        candidateId: job.candidate!.id,
        jobRevision: job.revision,
        visuallyReviewed: next.reviewed ?? reviewed,
        acknowledgedManualCheckIds: next.checkIds ?? acknowledged,
        reviewedAt: Date.now(),
      },
    });
  };

  const toggleManualCheck = (id: string, checked: boolean) => {
    updateReview({
      checkIds: checked ? [...new Set([...acknowledged, id])] : acknowledged.filter((item) => item !== id),
    });
  };

  const runExport = async (method: 'download' | 'share') => {
    setExportError(null);
    try {
      // NFR-09: confirm the bytes about to leave still measure the way the
      // checklist above says they do, so what is exported is what was verified.
      if (!(await stillMatchesReport(job.candidate!))) {
        setExportError(
          'This file no longer matches the checks shown above. Prepare it again before downloading.',
        );
        return;
      }

      const outcome =
        method === 'share'
          ? await share(asBlob(job.candidate!.blob), filename)
          : await download(asBlob(job.candidate!.blob), filename);
      dispatch({ type: 'MARK_EXPORTED' });
      setExported(outcome.filename);
    } catch {
      setExportError('The file is still here. Try downloading again.');
    }
  };

  return (
    <section className="page review-page">
      <h2>Check your file before you upload it</h2>

      <div className="compare-toggle" role="group" aria-label="Compare">
        <button type="button" aria-pressed={!showOriginal} onClick={() => setShowOriginal(false)}>
          Prepared file
        </button>
        <button type="button" aria-pressed={showOriginal} onClick={() => setShowOriginal(true)}>
          Original
        </button>
      </div>

      <ImagePreview
        blob={asBlob(showOriginal ? job.source.blob : job.candidate.blob)}
        alt={showOriginal ? 'Your original document' : 'The prepared file'}
        zoomable
      />

      <dl className="metadata">
        <dt>Format</dt>
        <dd>{job.candidate.metadata.format.toUpperCase()}</dd>
        <dt>Size</dt>
        <dd>{formatBytes(job.candidate.metadata.byteLength)}</dd>
        <dt>Dimensions</dt>
        <dd>
          {job.candidate.metadata.width} &times; {job.candidate.metadata.height} pixels
        </dd>
      </dl>

      <ValidationChecklist
        report={job.report}
        manualChecks={job.confirmed.manualChecks}
        acknowledged={acknowledged}
        onAcknowledge={toggleManualCheck}
      />

      <label className="visual-review">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(event) => updateReview({ reviewed: event.target.checked })}
        />
        I checked that the document is readable and nothing important is missing.
      </label>

      <div className="actions">
        <button type="button" className="primary" disabled={!ready} onClick={() => runExport('download')}>
          Download file
        </button>
        {canShare(asBlob(job.candidate.blob), filename) ? (
          <button type="button" disabled={!ready} onClick={() => runExport('share')}>
            Share file
          </button>
        ) : null}
      </div>

      {exportError ? (
        <p className="error" role="alert">
          {exportError}
        </p>
      ) : null}

      {exported ? (
        <section className="done" role="status">
          <p>Your file is ready to upload. Return to the form and select it.</p>
          <p className="hint">Saved as {exported}</p>
          <button type="button" onClick={() => navigate('/document')}>
            Prepare another file
          </button>
        </section>
      ) : null}

      <p className="hint">
        These checks cover the requirements you confirmed. They are not a guarantee that the portal
        will accept the file.
      </p>
    </section>
  );
}
