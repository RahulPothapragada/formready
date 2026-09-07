import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RecoveryPanel from '../../components/RecoveryPanel';
import { useJob } from '../../app/JobContext';
import { prepareCandidate, type PrepareProgress } from '../../services/preparation';
import { buildValidationReport } from '../../domain/constraints';

/**
 * Screen 3. Drives the preparation worker and reports the stage it is actually
 * in.
 *
 * There is no percentage bar. The search does not know in advance how many
 * attempts it needs, so a percentage would be invented — the attempt count is
 * a real number and is shown instead.
 */
const STAGE_LABEL = {
  decoding: 'Opening your image',
  searching: 'Trying permitted file settings',
  verifying: 'Checking the result',
} as const;

export default function PreparePage() {
  const { job, dispatch } = useJob();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<PrepareProgress | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * The revision currently being prepared, so a re-render does not start a
   * second run for the same one.
   *
   * It is cleared by the cleanup below rather than being left set. In
   * development React mounts effects twice — mount, clean up, mount again — and
   * a guard that survived the first cleanup would leave the second mount
   * refusing to start anything, with the first run already aborted. The screen
   * then waits forever on preparation that is not happening.
   */
  const inFlightRevision = useRef<number | null>(null);

  useEffect(() => {
    if (!job.confirmed || !job.source || !job.transform) return;
    if (job.candidate || job.failure) return;
    if (inFlightRevision.current === job.revision) return;
    inFlightRevision.current = job.revision;

    const controller = new AbortController();
    abortRef.current = controller;
    const revision = job.revision;
    const { confirmed, source, transform } = job;

    (async () => {
      const outcome = await prepareCandidate({
        jobRevision: revision,
        source: source.blob,
        crop: transform.crop,
        rotation: transform.rotation,
        requirements: confirmed,
        signal: controller.signal,
        onProgress: setProgress,
      });

      // The reducer also checks the revision, but returning early here avoids
      // dispatching for a run the user has already moved past.
      if (controller.signal.aborted) return;

      if (!outcome.ok) {
        if (outcome.failure.kind === 'cancelled') return;
        dispatch({ type: 'PREPARATION_FAILED', jobRevision: revision, failure: outcome.failure });
        return;
      }

      const candidate = {
        id: crypto.randomUUID(),
        blob: outcome.blob,
        sourceId: source.id,
        jobRevision: revision,
        metadata: outcome.metadata,
        attempts: outcome.attempts,
      };

      dispatch({
        type: 'PREPARATION_SUCCEEDED',
        candidate,
        report: buildValidationReport(candidate, confirmed, Date.now()),
      });
      navigate('/review');
    })();

    return () => {
      controller.abort();
      // Release the guard so a remount can start again. Without this, the
      // second of React's development double-mounts finds the revision already
      // claimed and never runs.
      if (inFlightRevision.current === revision) inFlightRevision.current = null;
    };
  }, [job, dispatch, navigate]);

  if (job.failure) return <RecoveryPanel failure={job.failure} />;

  if (!job.confirmed || !job.source || !job.transform) {
    return (
      <section className="page">
        <h2>Nothing to prepare yet</h2>
        <button type="button" onClick={() => navigate('/document')}>
          Choose a document
        </button>
      </section>
    );
  }

  return (
    <section className="page prepare-page" aria-live="polite">
      <h2>Getting your file ready</h2>
      <p className="progress">{progress ? STAGE_LABEL[progress.stage] : 'Starting'}</p>
      {progress && progress.attempts > 0 ? (
        <p className="hint">
          {progress.attempts} {progress.attempts === 1 ? 'setting' : 'settings'} tried so far
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => {
          abortRef.current?.abort();
          dispatch({ type: 'CANCEL_PREPARATION' });
          navigate('/document');
        }}
      >
        Cancel
      </button>
    </section>
  );
}
