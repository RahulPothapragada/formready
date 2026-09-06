import { useState } from 'react';
import type { CropRect, SourceDocument } from '../../domain/types';

interface CropEditorProps {
  source: SourceDocument;
  /** Set when the confirmed rules pin an exact output aspect ratio. */
  requiredAspect: number | null;
  onApprove: (crop: CropRect | null) => void;
}

/**
 * Crop approval.
 *
 * Backlog item 5 replaces the numeric inputs below with a drag-and-pinch
 * overlay. The contract this component must keep either way: when the target
 * geometry would change the aspect ratio, the user has to make a crop decision
 * rather than have the image stretched for them (FR-07).
 */
export default function CropEditor({ source, requiredAspect, onApprove }: CropEditorProps) {
  const sourceAspect = source.width / source.height;
  const distorts =
    requiredAspect !== null && Math.abs(sourceAspect - requiredAspect) / requiredAspect > 0.01;

  const [crop, setCrop] = useState<CropRect>(() => centredCrop(source, requiredAspect));

  return (
    <section className="crop-editor">
      <h3>Framing</h3>
      {distorts ? (
        <p className="warning" role="alert">
          The required size has a different shape from your image. Choose the part to keep — we
          will not stretch it.
        </p>
      ) : (
        <p className="hint">Your whole image fits the required shape. You can crop if you want to.</p>
      )}

      <div className="crop-fields">
        {(['x', 'y', 'width', 'height'] as const).map((key) => (
          <label key={key}>
            <span>{key}</span>
            <input
              type="number"
              min={0}
              value={crop[key]}
              onChange={(event) => setCrop({ ...crop, [key]: Number(event.target.value) })}
            />
          </label>
        ))}
      </div>

      <div className="actions">
        <button type="button" onClick={() => onApprove(crop)}>
          Use this crop
        </button>
        <button type="button" disabled={distorts} onClick={() => onApprove(null)}>
          Use the whole image
        </button>
      </div>
    </section>
  );
}

/** Largest centred rectangle of the required shape that fits inside the source. */
function centredCrop(source: SourceDocument, requiredAspect: number | null): CropRect {
  if (requiredAspect === null) {
    return { x: 0, y: 0, width: source.width, height: source.height };
  }
  const sourceAspect = source.width / source.height;
  const width = sourceAspect > requiredAspect ? Math.round(source.height * requiredAspect) : source.width;
  const height = sourceAspect > requiredAspect ? source.height : Math.round(source.width / requiredAspect);
  return {
    x: Math.round((source.width - width) / 2),
    y: Math.round((source.height - height) / 2),
    width,
    height,
  };
}
