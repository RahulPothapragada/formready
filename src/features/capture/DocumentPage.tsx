import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilePicker from '../../components/FilePicker';
import ImagePreview from '../../components/ImagePreview';
import CropEditor from './CropEditor';
import { useJob } from '../../app/JobContext';
import { dimensionBounds, formatBytes } from '../../domain/constraints';
import { MAX_INPUT_PIXELS, decode, readFormat } from '../../services/imageCodec';
import type { CropRect } from '../../domain/types';

/**
 * Screen 2. Establishes the source document and the geometry the user approves.
 * The original blob is stored untouched and is never re-encoded here.
 */
export default function DocumentPage() {
  const { job, dispatch } = useJob();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0);

  const requiredAspect = useMemo(() => {
    if (!job.confirmed) return null;
    const width = dimensionBounds(job.confirmed.rules, 'width');
    const height = dimensionBounds(job.confirmed.rules, 'height');
    if (width.min === null || width.min !== width.max) return null;
    if (height.min === null || height.min !== height.max) return null;
    return width.min / height.min;
  }, [job.confirmed]);

  const handleSelect = async (file: File) => {
    setError(null);
    const format = await readFormat(file);
    if (!format) {
      setError('This file is not a JPEG or PNG image. Choose a different one.');
      return;
    }

    try {
      const bitmap = await decode(file);
      // Read the dimensions before closing: `close()` releases the bitmap and
      // its width and height both become 0 afterwards. Reading them after the
      // close stored a 0x0 source, which showed as "0 × 0 pixels" on this
      // screen and gave the crop editor a zero-sized rectangle to work from.
      const { width, height } = bitmap;
      bitmap.close();

      if (width * height > MAX_INPUT_PIXELS) {
        setError('This image is too large for this phone to prepare. Choose a smaller one.');
        return;
      }

      dispatch({
        type: 'SET_SOURCE_DOCUMENT',
        source: {
          id: crypto.randomUUID(),
          blob: file,
          filename: file.name,
          decodedFormat: format,
          width,
          height,
          // decode() already applied EXIF orientation, so the stored dimensions
          // are the visual ones and this is retained only for diagnostics.
          orientation: 1,
        },
      });
    } catch {
      setError('This image could not be opened. Try another file.');
    }
  };

  const approve = (crop: CropRect | null) => {
    dispatch({ type: 'APPROVE_GEOMETRY', crop, rotation });
    navigate('/prepare');
  };

  if (!job.confirmed) {
    return (
      <section className="page">
        <h2>Confirm the requirements first</h2>
        <button type="button" onClick={() => navigate('/requirements')}>
          Back to requirements
        </button>
      </section>
    );
  }

  return (
    <section className="page document-page">
      <h2>Choose your document</h2>

      <details className="target-summary">
        <summary>Confirmed requirements</summary>
        <ul>
          {job.confirmed.rules
            .filter((rule) => rule.reviewState === 'confirmed')
            .map((rule) => (
              <li key={rule.id}>
                {rule.field === 'format'
                  ? `Format: ${rule.allowed.map((f) => f.toUpperCase()).join(' or ')}`
                  : `${rule.field}: ${rule.operator} ${rule.value} ${rule.unit}`}
              </li>
            ))}
        </ul>
      </details>

      <FilePicker label="Choose image" onSelect={handleSelect} />
      <FilePicker label="Take a photo" capture onSelect={handleSelect} />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {job.source ? (
        <>
          <ImagePreview blob={job.source.blob} alt="Your original document" />
          <dl className="metadata">
            <dt>Format</dt>
            <dd>{job.source.decodedFormat.toUpperCase()}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(job.source.blob.size)}</dd>
            <dt>Dimensions</dt>
            <dd>
              {job.source.width} &times; {job.source.height} pixels
            </dd>
          </dl>

          <div className="rotate-controls">
            <span>Rotation: {rotation}&deg;</span>
            <button
              type="button"
              onClick={() => setRotation((((rotation + 90) % 360) as 0 | 90 | 180 | 270))}
            >
              Rotate right
            </button>
          </div>

          <CropEditor source={job.source} requiredAspect={requiredAspect} onApprove={approve} />
        </>
      ) : null}
    </section>
  );
}
