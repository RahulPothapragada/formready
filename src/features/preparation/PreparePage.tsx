import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import RecoveryPanel from '../../components/RecoveryPanel';
import { useJob } from '../../app/JobContext';
import { searchCandidates, type EncodeFn } from './generateCandidates';
import { decode, encode, render } from '../../services/imageCodec';
import { measure } from '../../services/verifier';
import { buildValidationReport } from '../../domain/constraints';

type Stage = 'idle' | 'preparing-image' | 'trying-encodings' | 'checking';

const STAGE_LABEL: Record<Exclude<Stage, 'idle'>, string> = {
  'preparing-image': 'Preparing your image',
  'trying-encodings': 'Trying permitted file settings',
  checking: 'Checking the result',
};

/**
 * Screen 3. Runs the bounded search and reports the stage it is actually in.
 *
 * There is no percentage bar: the search does not know in advance how many
 * attempts it needs, and an invented percentage would be a fabricated progress
 * signal (section 4).
 */
export default function PreparePage() {
  const { job, dispatch } = useJob();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');
  const abortRef = useRef<AbortController | null>(null);
  // Guards against a second run when React re-invokes the effect.
  const startedRevision = useRef<number | null>(null);

  useEffect(() => {
    if (!job.confirmed || !job.source || !job.transform) return;
    if (job.candidate || job.failure) return;
    if (startedRevision.current === job.revision) return;
    startedRevision.current = job.revision;

    const controller = new AbortController();
    abortRef.current = controller;
    const revision = job.revision;
    const { confirmed, source, transform } = job;

    (async () => {
      setStage('preparing-image');
      let bitmap: ImageBitmap | null = null;

      try {
        bitmap = await decode(source.blob);
        const held = bitmap;

        const encodeCandidate: EncodeFn = async (request) => {
          const canvas = render({
            bitmap: held,
            crop: transform.crop,
            rotation: transform.rotation,
            targetWidth: request.width,
            targetHeight: request.height,
          });
          const blob = await encode(canvas, request.format, request.quality);
          // Metadata always comes from re-reading the produced bytes, never
          // from the request that produced them (FR-09).
          return { blob, metadata: await measure(blob) };
        };

        setStage('trying-encodings');
        const outcome = await searchCandidates({
          sourceWidth: source.width,
          sourceHeight: source.height,
          requirements: confirmed,
          encode: encodeCandidate,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (!outcome.ok) {
          dispatch({ type: 'PREPARATION_FAILED', jobRevision: revision, failure: outcome.failure });
          return;
        }

        setStage('checking');
        const candidate = {
          id: crypto.randomUUID(),
          blob: outcome.result.blob,
          sourceId: source.id,
          jobRevision: revision,
          metadata: outcome.result.metadata,
          attempts: outcome.attempts,
        };
        const report = buildValidationReport(candidate, confirmed, Date.now());

        dispatch({ type: 'PREPARATION_SUCCEEDED', candidate, report });
        navigate('/review');
      } catch {
        if (controller.signal.aborted) return;
        dispatch({
          type: 'PREPARATION_FAILED',
          jobRevision: revision,
          failure: {
            kind: 'decode-failed',
            message: 'This image could not be prepared on this device.',
            suggestions: ['choose-clearer-image'],
          },
        });
      } finally {
        bitmap?.close();
        setStage('idle');
      }
    })();

    return () => controller.abort();
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
      <p className="progress">{stage === 'idle' ? 'Starting' : STAGE_LABEL[stage]}</p>
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
