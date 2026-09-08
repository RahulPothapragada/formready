import { useId, useRef, useState } from 'react';
import { MAX_INPUT_BYTES, MAX_INPUT_PIXELS } from '@formready/browser';

interface FilePickerProps {
  label: string;
  /** Set for the document picker to offer the rear camera where available. */
  capture?: boolean;
  onSelect: (file: File) => void;
}

const MEGABYTES = MAX_INPUT_BYTES / (1024 * 1024);

/**
 * Image input for both instruction screenshots and documents.
 *
 * The size guardrail is checked here, before any decode, so an oversized file
 * fails in milliseconds instead of after a long decode that may crash the tab
 * (section 3, NFR-05). Limits are displayed rather than only enforced.
 */
export default function FilePicker({ label, capture, onSelect }: FilePickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_INPUT_BYTES) {
      setError(`This image is larger than ${MEGABYTES} MB. Choose a smaller one.`);
      // Reset so picking the same file again re-fires the change event.
      event.target.value = '';
      return;
    }

    setError(null);
    onSelect(file);
    event.target.value = '';
  };

  return (
    <div className="file-picker">
      <label className="button" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture={capture ? 'environment' : undefined}
        onChange={handleChange}
      />
      <p className="hint">
        JPEG or PNG, up to {MEGABYTES} MB and {MAX_INPUT_PIXELS / 1_000_000} megapixels.
      </p>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
