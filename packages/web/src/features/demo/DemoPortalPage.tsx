import { useState } from 'react';
import { formatBytes } from '@formready/engine';
import { measure } from '@formready/browser';

/**
 * Screen 5 — a demonstration harness, deliberately outside the product journey.
 *
 * This exists so a live demo can show a file being rejected and then accepted.
 * It must never be styled or described as a real government portal, and its
 * fixed rules below must match whatever instructions the demo uses.
 */
const DEMO_RULES = {
  formats: ['jpeg'] as const,
  minBytes: 20_000,
  maxBytes: 50_000,
  width: 200,
  height: 230,
};

interface CheckLine {
  label: string;
  ok: boolean;
  detail: string;
}

export default function DemoPortalPage() {
  const [lines, setLines] = useState<CheckLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async (file: File) => {
    setError(null);
    try {
      const metadata = await measure(file);
      setLines([
        {
          label: 'Format',
          ok: (DEMO_RULES.formats as readonly string[]).includes(metadata.format),
          detail: `${metadata.format.toUpperCase()} (needs JPEG)`,
        },
        {
          label: 'Size',
          ok:
            metadata.byteLength >= DEMO_RULES.minBytes &&
            metadata.byteLength <= DEMO_RULES.maxBytes,
          detail: `${formatBytes(metadata.byteLength)} (needs ${formatBytes(DEMO_RULES.minBytes)}–${formatBytes(DEMO_RULES.maxBytes)})`,
        },
        {
          label: 'Dimensions',
          ok: metadata.width === DEMO_RULES.width && metadata.height === DEMO_RULES.height,
          detail: `${metadata.width} × ${metadata.height} (needs ${DEMO_RULES.width} × ${DEMO_RULES.height})`,
        },
      ]);
    } catch {
      setError('That file could not be read as a JPEG or PNG.');
    }
  };

  return (
    <section className="page demo-page">
      <p className="demo-banner" role="note">
        Demonstration only. This is not a government portal and is not connected to any
        application system.
      </p>

      <h2>Demo upload checker</h2>
      <p>
        Applies one fixed set of rules so you can see the difference between a file before and
        after preparation.
      </p>

      <input
        type="file"
        accept="image/jpeg,image/png"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void check(file);
        }}
      />

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {lines ? (
        <ul className="checklist exact">
          {lines.map((line) => (
            <li key={line.label} className={line.ok ? 'pass' : 'fail'}>
              <span className="field">{line.label}</span>
              <span className="actual">{line.detail}</span>
              <span className="outcome">{line.ok ? 'Accepted' : 'Rejected'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
