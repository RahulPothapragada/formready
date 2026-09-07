import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  buildReport,
  deriveDecisions,
  runFeasibilitySuite,
  type ProbeResult,
} from './probes';

/**
 * Work package 1 — the device feasibility harness.
 *
 * Not part of the product journey. This page exists to replace the
 * specification's proposed numbers with measured ones before the build
 * continues, and to record the scope-freeze decisions those measurements force.
 *
 * Run it on the phone that will run the demo, on battery, without a debugger
 * attached. A desktop run is useful for catching mistakes in this page; it is
 * not evidence about the device.
 */
export default function FeasibilityPage() {
  const [params] = useSearchParams();
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);
  const [includeSlow, setIncludeSlow] = useState(params.get('quick') !== '1');
  const [copied, setCopied] = useState(false);
  const [finished, setFinished] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);

  const decisions = useMemo(
    () => (running || results.length === 0 ? [] : deriveDecisions(results)),
    [results, running],
  );

  const run = useCallback(
    async (slow: boolean) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setResults([]);
      setCopied(false);
      setFinished(false);
      setRunning(true);

      try {
        await runFeasibilitySuite({
          signal: controller.signal,
          includeSlow: slow,
          onResult: (result) =>
            setResults((current) => {
              const index = current.findIndex((item) => item.id === result.id);
              if (index === -1) return [...current, result];
              const next = [...current];
              next[index] = result;
              return next;
            }),
        });
      } finally {
        setRunning(false);
        setFinished(true);
      }
    },
    [],
  );

  /**
   * `?autorun=1` starts the suite on load, so the harness can be driven by a
   * headless browser as well as by hand. `?quick=1` skips the slow probes.
   * The `data-suite-state` attribute below is what an automated run waits on.
   */
  useEffect(() => {
    if (params.get('autorun') !== '1' || autoStarted.current) return;
    autoStarted.current = true;
    void run(params.get('quick') !== '1');
  }, [params, run]);

  const copyReport = async () => {
    const report = buildReport(results, new Date().toISOString());
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    setCopied(true);
  };

  return (
    <section
      className="page feasibility-page"
      data-suite-state={running ? 'running' : finished ? 'finished' : 'idle'}
    >
      <p className="demo-banner" role="note">
        Engineering harness, not part of the app. Run this on the demo phone and
        record what it measures.
      </p>

      <h2>Device feasibility</h2>
      <p>
        Replaces the proposed limits and timings in the specification with numbers measured here.
        Nothing on this page is estimated.
      </p>

      <label className="confirm-toggle">
        <input
          type="checkbox"
          checked={includeSlow}
          disabled={running}
          onChange={(event) => setIncludeSlow(event.target.checked)}
        />
        Include slow probes (decode ceiling, happy path, OCR)
      </label>

      <div className="actions">
        <button
          type="button"
          className="primary"
          onClick={() => void run(includeSlow)}
          disabled={running}
        >
          {running ? 'Measuring…' : 'Run probes'}
        </button>
        {running ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : null}
        {results.length > 0 && !running ? (
          <button type="button" onClick={copyReport}>
            {copied ? 'Copied' : 'Copy report as JSON'}
          </button>
        ) : null}
      </div>

      <ul className="checklist exact probe-list">
        {results.map((result) => (
          <li key={result.id} className={result.status}>
            <span className="field">{result.label}</span>
            <span className="outcome">{result.status}</span>
            <span className="expected">{result.detail}</span>
            {result.measurements.length > 0 ? (
              <dl className="metadata">
                {result.measurements.map((measurement) => (
                  <div key={measurement.label} className="measurement">
                    <dt>{measurement.label}</dt>
                    <dd>{measurement.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </li>
        ))}
      </ul>

      {decisions.length > 0 ? (
        <section className="decisions">
          <h3>Scope-freeze decisions</h3>
          <p className="hint">
            Blocking decisions must be resolved before work package 2 starts.
          </p>
          <ul className="checklist">
            {decisions.map((decision) => (
              <li key={decision.question} className={decision.blocking ? 'fail' : 'pass'}>
                <span className="field">{decision.question}</span>
                <span className="actual">{decision.answer}</span>
                <span className="expected">{decision.rationale}</span>
                {decision.blocking ? <span className="outcome">Blocking</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="hint">
        Paste the copied JSON into <code>docs/feasibility.md</code> along with the device model and
        whether the run was on battery.
      </p>
    </section>
  );
}
