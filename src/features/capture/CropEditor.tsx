import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  centredCrop,
  clampCrop,
  resizeFromHandle,
  roundCrop,
  scaleAboutCentre,
  visualCropToSource,
  visualSize,
  type Handle,
  type Rotation,
} from './cropGeometry';
import type { CropRect, SourceDocument } from '../../domain/types';

interface CropEditorProps {
  source: SourceDocument;
  rotation: Rotation;
  /** Set when the confirmed rules pin an exact output aspect ratio. */
  requiredAspect: number | null;
  onApprove: (crop: CropRect | null) => void;
}

const HANDLES: Handle[] = ['nw', 'ne', 'se', 'sw'];

/**
 * Direct-manipulation crop editor.
 *
 * The user drags the frame and pinches to size it. The numeric fields remain,
 * collapsed, because they are the keyboard- and screen-reader-accessible path
 * and because typing an exact number is sometimes genuinely faster.
 *
 * The image is shown the way the finished file will look — rotation applied —
 * so the rectangle is in visual coordinates and converted to source
 * coordinates on approval. The pipeline crops before it rotates.
 *
 * The contract FR-07 fixes: when the required shape differs from the source,
 * the user has to make a crop decision. Nothing is stretched for them.
 */
export default function CropEditor({
  source,
  rotation,
  requiredAspect,
  onApprove,
}: CropEditorProps) {
  const bounds = useMemo(() => visualSize(source, rotation), [source, rotation]);
  const [crop, setCrop] = useState<CropRect>(() => centredCrop(bounds, requiredAspect));
  const [url, setUrl] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  /** Live pointers, so a second finger can start a pinch mid-drag. */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: 'move'; startCrop: CropRect; startX: number; startY: number }
    | { kind: 'resize'; handle: Handle }
    | { kind: 'pinch'; startCrop: CropRect; startSpread: number }
    | null
  >(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(source.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [source.blob]);

  const sourceAspect = bounds.width / bounds.height;
  const wouldDistort =
    requiredAspect !== null && Math.abs(sourceAspect - requiredAspect) / requiredAspect > 0.01;

  /** Converts a client point to image pixels. */
  const toImage = useCallback(
    (clientX: number, clientY: number) => {
      const stage = stageRef.current;
      if (!stage) return { x: 0, y: 0 };
      const rect = stage.getBoundingClientRect();
      const scale = bounds.width / rect.width;
      return { x: (clientX - rect.left) * scale, y: (clientY - rect.top) * scale };
    },
    [bounds.width],
  );

  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onPointerDown = (event: React.PointerEvent, handle?: Handle) => {
    try {
      // Keeps the gesture alive if the finger leaves the element. It can throw
      // when the pointer has already been released, which must not abort the
      // drag before it starts.
      (event.target as Element).setPointerCapture(event.pointerId);
    } catch {
      /* carry on without capture */
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setDragging(true);

    if (pointers.current.size === 2) {
      gesture.current = { kind: 'pinch', startCrop: crop, startSpread: spread() };
      return;
    }

    if (handle) {
      gesture.current = { kind: 'resize', handle };
      return;
    }

    const point = toImage(event.clientX, event.clientY);
    gesture.current = { kind: 'move', startCrop: crop, startX: point.x, startY: point.y };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const active = gesture.current;
    if (!active) return;

    if (active.kind === 'pinch') {
      const current = spread();
      if (active.startSpread > 0 && current > 0) {
        setCrop(scaleAboutCentre(active.startCrop, active.startSpread / current, bounds, requiredAspect));
      }
      return;
    }

    const point = toImage(event.clientX, event.clientY);

    if (active.kind === 'move') {
      setCrop(
        clampCrop(
          {
            ...active.startCrop,
            x: active.startCrop.x + (point.x - active.startX),
            y: active.startCrop.y + (point.y - active.startY),
          },
          bounds,
          requiredAspect,
        ),
      );
      return;
    }

    setCrop(resizeFromHandle(crop, active.handle, point, bounds, requiredAspect));
  };

  const endPointer = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
      setCrop((current) => roundCrop(current));
    }
  };

  /** Keyboard equivalent: arrows nudge, shift+arrows resize (NFR-02). */
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.altKey ? 1 : Math.max(2, Math.round(bounds.width / 50));
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();

    setCrop((current) => {
      if (!event.shiftKey) {
        return clampCrop(
          { ...current, x: current.x + delta[0], y: current.y + delta[1] },
          bounds,
          requiredAspect,
        );
      }
      const resized = { ...current, width: current.width + delta[0], height: current.height + delta[1] };
      return clampCrop(resized, bounds, requiredAspect);
    });
  };

  const setField = (key: keyof CropRect, value: number) => {
    // The numeric fields are an editing path like any other, so they go through
    // the same aspect-aware clamp. Letting them write a raw value was a way to
    // step outside the lock the drag handles enforce.
    if (!Number.isFinite(value) || value < 0) return;
    setCrop((current) => clampCrop({ ...current, [key]: value }, bounds, requiredAspect));
  };

  const rounded = roundCrop(crop);
  const percent = (value: number, total: number) => `${(value / total) * 100}%`;

  /**
   * A quarter turn means the image, once rotated, has to span the stage's other
   * axis. The stage already has the visual aspect ratio, so the two sizes fall
   * out of that ratio directly — no measuring required.
   */
  const imageStyle =
    rotation === 90 || rotation === 270
      ? {
          width: percent(bounds.height, bounds.width),
          height: percent(bounds.width, bounds.height),
        }
      : { width: '100%', height: '100%' };

  return (
    <section className="crop-editor">
      <h3>Framing</h3>
      {wouldDistort ? (
        <p className="warning" role="alert">
          The required size is a different shape from your image. Choose the part to keep — we will
          not stretch it.
        </p>
      ) : (
        <p className="hint">Drag the frame to move it. Pinch, or drag a corner, to resize.</p>
      )}

      <div
        className={`crop-stage ${dragging ? 'dragging' : ''}`}
        ref={stageRef}
        style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        {url ? (
          <img
            src={url}
            alt="Your document, with the area to keep highlighted"
            className="crop-image"
            style={{ ...imageStyle, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
            draggable={false}
          />
        ) : null}

        <div
          className="crop-frame"
          role="group"
          aria-label="Area to keep. Arrow keys move, shift and arrow keys resize."
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => onPointerDown(event)}
          style={{
            left: percent(crop.x, bounds.width),
            top: percent(crop.y, bounds.height),
            width: percent(crop.width, bounds.width),
            height: percent(crop.height, bounds.height),
          }}
        >
          {HANDLES.map((handle) => (
            <span
              key={handle}
              className={`crop-handle ${handle}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                onPointerDown(event, handle);
              }}
            />
          ))}
        </div>
      </div>

      <p className="crop-readout" aria-live="polite">
        Keeping {rounded.width} &times; {rounded.height} pixels
        {requiredAspect === null ? '' : ' · shape locked to the required size'}
      </p>

      <details className="crop-precise">
        <summary>Enter exact values</summary>
        <div className="crop-fields">
          {(['x', 'y', 'width', 'height'] as const).map((key) => (
            <label key={key}>
              <span>{key}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={rounded[key]}
                onChange={(event) => setField(key, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
      </details>

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => onApprove(visualCropToSource(roundCrop(crop), rotation, source))}
        >
          Use this crop
        </button>
        <button
          type="button"
          disabled={wouldDistort}
          onClick={() => onApprove(rotation === 0 ? null : visualCropToSource({ x: 0, y: 0, ...bounds }, rotation, source))}
        >
          Use the whole image
        </button>
      </div>
    </section>
  );
}
