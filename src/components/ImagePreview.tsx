import { useEffect, useState } from 'react';

interface ImagePreviewProps {
  blob: Blob | null;
  alt: string;
  /** Lets the review screen show the output at full size for inspection. */
  zoomable?: boolean;
}

/**
 * Renders a Blob and revokes its object URL on unmount. Leaking these keeps the
 * decoded image alive for the life of the page, which matters on a phone
 * holding several multi-megapixel bitmaps (NFR-05).
 */
export default function ImagePreview({ blob, alt, zoomable = false }: ImagePreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  if (!url) return <div className="image-preview empty">No image yet</div>;

  return (
    <figure className={`image-preview ${zoomed ? 'zoomed' : ''}`}>
      <img
        src={url}
        alt={alt}
        onClick={zoomable ? () => setZoomed((value) => !value) : undefined}
      />
      {zoomable ? (
        <figcaption>
          <button type="button" onClick={() => setZoomed((value) => !value)}>
            {zoomed ? 'Fit to screen' : 'Zoom in'}
          </button>
        </figcaption>
      ) : null}
    </figure>
  );
}
