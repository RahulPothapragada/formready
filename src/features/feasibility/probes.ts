/**
 * Device feasibility probes — work package 1.
 *
 * Everything in the specification's performance and guardrail sections is
 * written as a *proposed* target: 10 MiB, 20 megapixels, a 15-second warm happy
 * path, 24 attempts, 12 seconds of search. This module is how those proposals
 * become measurements on the phone that will actually run the demo.
 *
 * Rules this file follows:
 *
 * - A probe reports what it measured, or it reports that it could not measure.
 *   There is no third option, and nothing here estimates a number it did not
 *   observe.
 * - Timings come from `performance.now()` around the real operation.
 * - Cold and warm are measured and reported separately (NFR-06, NFR-08). A
 *   cached number presented as a first-run number is a false claim.
 * - Capability detection reports the capability that was detected, not the one
 *   it implies. WebGPU means a GPU path exists; it says nothing about an NPU.
 */

import { decode, encode, render } from '../../services/imageCodec';
import { measure } from '../../services/verifier';
import { recognize } from '../../services/ocr';
import { prepareCandidate } from '../../services/preparation';
import { searchCandidates } from '../preparation/generateCandidates';
import type { ConfirmedRequirements, ImageFormat, Rule } from '../../domain/types';

export type ProbeId =
  | 'environment'
  | 'decode-ceiling'
  | 'jpeg-monotonicity'
  | 'png-quality-noop'
  | 'orientation'
  | 'ocr'
  | 'happy-path'
  | 'worker-responsiveness'
  | 'export'
  | 'accelerator';

/**
 * `unsupported` means the platform lacks the capability. `skipped` means the
 * probe could not run for a setup reason — a missing asset, say — which is a
 * different problem with a different fix.
 */
export type ProbeStatus = 'pass' | 'fail' | 'unsupported' | 'skipped' | 'running';

export interface Measurement {
  label: string;
  value: string;
}

export interface ProbeResult {
  id: ProbeId;
  label: string;
  status: ProbeStatus;
  detail: string;
  measurements: Measurement[];
}

const ms = (value: number) => `${Math.round(value)} ms`;
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;

/**
 * Times frame callbacks for the duration of `work`.
 *
 * The longest gap between frames is the longest the main thread was blocked,
 * which is the longest a Cancel tap would have gone unnoticed. Used to compare
 * running preparation inline against running it in the worker.
 */
async function whileSamplingMainThread<T>(
  work: () => Promise<T>,
): Promise<{ value: T; longestGapMs: number; frames: number; elapsedMs: number }> {
  let sampling = true;
  let longestGapMs = 0;
  let frames = 0;
  let previous = performance.now();

  const sample = () => {
    if (!sampling) return;
    const at = performance.now();
    longestGapMs = Math.max(longestGapMs, at - previous);
    previous = at;
    frames += 1;
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);

  const startedAt = performance.now();
  try {
    const value = await work();
    return { value, longestGapMs, frames, elapsedMs: performance.now() - startedAt };
  } finally {
    sampling = false;
  }
}

/**
 * A gap beyond this is long enough that a Cancel tap is visibly ignored. It is
 * a usability threshold, not a rendering one.
 */
const RESPONSIVE_GAP_MS = 200;

/**
 * Builds a synthetic source image on the device.
 *
 * The pattern is deliberately noisy: a flat or smooth image compresses to
 * almost nothing under JPEG, which would make every size measurement below
 * meaningless. A fixed seed keeps runs comparable across devices.
 */
export async function makeTestImage(
  width: number,
  height: number,
  format: ImageFormat = 'jpeg',
): Promise<Blob> {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });

  const context = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!context) throw new Error('2D canvas context unavailable.');

  const image = context.createImageData(width, height);
  let seed = 0x9e3779b9;
  for (let i = 0; i < image.data.length; i += 4) {
    // xorshift32 — cheap, deterministic, and produces detail JPEG must spend
    // bits on.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const value = (seed >>> 24) & 0xff;
    image.data[i] = value;
    image.data[i + 1] = (value * 3) & 0xff;
    image.data[i + 2] = (value * 7) & 0xff;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  return encode(canvas, format, 0.85);
}

function environmentProbe(): ProbeResult {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const measurements: Measurement[] = [
    { label: 'User agent', value: navigator.userAgent },
    { label: 'Viewport', value: `${window.innerWidth} × ${window.innerHeight} CSS px` },
    { label: 'Device pixel ratio', value: String(window.devicePixelRatio) },
    { label: 'Logical cores', value: String(navigator.hardwareConcurrency ?? 'not reported') },
    {
      label: 'Device memory',
      // Chrome-only, coarsely bucketed, and absent on iOS. Reported as-is.
      value: nav.deviceMemory ? `${nav.deviceMemory} GB (approx, browser-reported)` : 'not reported',
    },
    { label: 'OffscreenCanvas', value: typeof OffscreenCanvas !== 'undefined' ? 'yes' : 'no' },
    { label: 'Service worker', value: 'serviceWorker' in navigator ? 'yes' : 'no' },
    { label: 'Online now', value: navigator.onLine ? 'yes' : 'no' },
  ];

  return {
    id: 'environment',
    label: 'Environment',
    status: 'pass',
    detail: 'Reported by the browser. Record this alongside every timing below.',
    measurements,
  };
}

/**
 * Finds the largest image this device can actually create and decode.
 *
 * Both halves matter and they fail for different reasons: building the source
 * needs an ImageData buffer of 4 bytes per pixel (80 MB at 20 MP), while
 * decoding needs the browser's own bitmap allocation. Whichever gives out
 * first is the real ceiling, and the specification's 20 MP guardrail should be
 * revised down to it.
 */
async function decodeCeilingProbe(signal?: AbortSignal): Promise<ProbeResult> {
  const steps = [1, 2, 4, 8, 12, 16, 20, 24];
  const measurements: Measurement[] = [];
  let lastGood = 0;
  let stoppedBy = '';

  for (const megapixels of steps) {
    if (signal?.aborted) break;

    // 4:3, the common phone camera ratio.
    const width = Math.round(Math.sqrt((megapixels * 1_000_000 * 4) / 3));
    const height = Math.round((width * 3) / 4);

    try {
      const madeAt = performance.now();
      const blob = await makeTestImage(width, height);
      const encodeMs = performance.now() - madeAt;

      const decodedAt = performance.now();
      const bitmap = await decode(blob);
      const decodeMs = performance.now() - decodedAt;
      bitmap.close();

      measurements.push({
        label: `${megapixels} MP (${width}×${height})`,
        value: `encode ${ms(encodeMs)}, decode ${ms(decodeMs)}, ${mib(blob.size)}`,
      });
      lastGood = megapixels;
    } catch (error) {
      stoppedBy = error instanceof Error ? error.message : 'unknown error';
      measurements.push({ label: `${megapixels} MP (${width}×${height})`, value: `failed — ${stoppedBy}` });
      break;
    }
  }

  return {
    id: 'decode-ceiling',
    label: 'Decode ceiling',
    status: lastGood > 0 ? 'pass' : 'fail',
    detail: lastGood
      ? `Largest image handled end to end: ${lastGood} MP.${stoppedBy ? ` Failed above that: ${stoppedBy}` : ' No failure observed within the tested range.'}`
      : 'This device could not handle the smallest tested image.',
    measurements: [{ label: 'Ceiling', value: `${lastGood} MP` }, ...measurements],
  };
}

/**
 * Checks that JPEG byte size rises with the quality parameter on this device's
 * codec.
 *
 * The candidate search bisects on quality, which is only sound if the
 * relationship is monotonic. If a device's encoder violates that, the search
 * needs a linear sweep instead — so this is a correctness probe, not a
 * performance one.
 */
async function jpegMonotonicityProbe(): Promise<ProbeResult> {
  const qualities = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
  const source = await makeTestImage(1200, 900);
  const bitmap = await decode(source);

  try {
    const sizes: number[] = [];
    const measurements: Measurement[] = [];
    let totalMs = 0;

    for (const quality of qualities) {
      const startedAt = performance.now();
      const canvas = render({
        bitmap,
        crop: null,
        rotation: 0,
        targetWidth: 1200,
        targetHeight: 900,
      });
      const blob = await encode(canvas, 'jpeg', quality);
      totalMs += performance.now() - startedAt;

      sizes.push(blob.size);
      measurements.push({ label: `quality ${quality}`, value: `${blob.size.toLocaleString('en-US')} bytes` });
    }

    const monotonic = sizes.every((size, index) => index === 0 || size >= sizes[index - 1]);
    measurements.push({
      label: 'Mean encode time',
      value: ms(totalMs / qualities.length),
    });

    return {
      id: 'jpeg-monotonicity',
      label: 'JPEG quality is monotonic',
      status: monotonic ? 'pass' : 'fail',
      detail: monotonic
        ? 'File size rises with quality, so bisecting the quality parameter is sound on this device.'
        : 'File size did not rise consistently with quality. The candidate search must sweep linearly on this device instead of bisecting.',
      measurements,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Confirms on-device that the canvas quality argument does nothing for PNG.
 *
 * Section 7.6 asserts this. Demonstrating it turns an assertion in a document
 * into evidence, and it is the whole justification for PNG having a separate
 * failure kind.
 */
async function pngQualityProbe(): Promise<ProbeResult> {
  const source = await makeTestImage(800, 600, 'png');
  const bitmap = await decode(source);

  try {
    const geometry = { bitmap, crop: null, rotation: 0 as const, targetWidth: 800, targetHeight: 600 };
    const low = await encode(render({ ...geometry }), 'png', 0.1);
    const high = await encode(render({ ...geometry }), 'png', 0.95);
    const identical = low.size === high.size;

    return {
      id: 'png-quality-noop',
      label: 'PNG ignores the quality argument',
      status: 'pass',
      detail: identical
        ? 'Confirmed: quality 0.1 and 0.95 produced the same number of bytes. Geometry is the only PNG size lever, as the specification assumes.'
        : 'Unexpected: PNG size changed with the quality argument on this device. Re-check the PNG branch of the candidate search before relying on it.',
      measurements: [
        { label: 'PNG at quality 0.1', value: `${low.size.toLocaleString('en-US')} bytes` },
        { label: 'PNG at quality 0.95', value: `${high.size.toLocaleString('en-US')} bytes` },
        { label: 'Identical', value: identical ? 'yes' : 'no' },
      ],
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Splices a minimal EXIF APP1 segment carrying an Orientation tag into a JPEG.
 *
 * Written by hand rather than pulled from a fixture so the test image is
 * generated on the device under test, and so this stays verifiable in Node:
 * it is pure byte manipulation with no canvas involved.
 *
 * Layout: APP1 marker, length, "Exif\0\0", then a big-endian TIFF block holding
 * exactly one IFD entry — tag 0x0112 (Orientation), type 3 (SHORT), count 1.
 */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error('Not a JPEG: missing start-of-image marker.');
  }

  // Insert after any leading JFIF APP0 segment, which is where an encoder that
  // wrote EXIF itself would have put it.
  let insertAt = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) {
    insertAt = 4 + ((jpeg[4] << 8) | jpeg[5]);
  }

  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, 0x4d4d); // "MM" — big-endian byte order
  view.setUint16(2, 0x002a); // TIFF magic
  view.setUint32(4, 0x00000008); // offset to IFD0
  view.setUint16(8, 1); // one directory entry
  view.setUint16(10, 0x0112); // Orientation
  view.setUint16(12, 3); // SHORT
  view.setUint32(14, 1); // count
  view.setUint16(18, orientation); // value, left-aligned in the 4-byte field
  view.setUint32(22, 0); // no next IFD

  const header = new TextEncoder().encode('Exif\0\0');
  const payloadLength = header.length + tiff.length + 2; // + the length field
  const segment = new Uint8Array(2 + payloadLength);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = (payloadLength >> 8) & 0xff;
  segment[3] = payloadLength & 0xff;
  segment.set(header, 4);
  segment.set(tiff, 4 + header.length);

  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, insertAt), 0);
  out.set(segment, insertAt);
  out.set(jpeg.subarray(insertAt), insertAt + segment.length);
  return out;
}

/**
 * Checks that decoding applies EXIF orientation.
 *
 * The crop editor's rectangles are expressed in visual coordinates, so if
 * `imageOrientation: 'from-image'` is not honoured, every approved crop on a
 * rotated phone photo lands on the wrong axis. Orientation 6 means "rotate 90°
 * clockwise", so a 4×2 source must decode as 2×4.
 */
async function orientationProbe(): Promise<ProbeResult> {
  const plain = await makeTestImage(4, 2);
  const oriented = withExifOrientation(new Uint8Array(await plain.arrayBuffer()), 6);
  const blob = new Blob([oriented as BlobPart], { type: 'image/jpeg' });

  try {
    const bitmap = await decode(blob);
    const applied = bitmap.width === 2 && bitmap.height === 4;
    const dimensions = `${bitmap.width} × ${bitmap.height}`;
    bitmap.close();

    return {
      id: 'orientation',
      label: 'EXIF orientation applied on decode',
      status: applied ? 'pass' : 'fail',
      detail: applied
        ? 'Orientation is applied before the bitmap is handed over, so crop rectangles are in visual coordinates.'
        : 'Orientation was NOT applied. Crop rectangles would land on the wrong axis for rotated photos — fix before shipping the crop editor.',
      measurements: [
        { label: 'Source', value: '4 × 2 pixels, EXIF orientation 6' },
        { label: 'Decoded as', value: dimensions },
        { label: 'Expected', value: '2 × 4' },
      ],
    };
  } catch (error) {
    return {
      id: 'orientation',
      label: 'EXIF orientation applied on decode',
      status: 'fail',
      detail: `The test image could not be decoded: ${error instanceof Error ? error.message : 'unknown error'}`,
      measurements: [],
    };
  }
}

/**
 * Are the locally-served Tesseract assets actually installed?
 *
 * A plain `response.ok` check is not enough: this is a single-page app, so a
 * missing path is answered by the SPA fallback with `200 text/html`. That would
 * report the assets as present and turn a setup problem into a spurious OCR
 * failure, so the content type is what actually gets checked.
 */
async function ocrAssetsPresent(): Promise<boolean> {
  try {
    const response = await fetch('/models/tesseract/worker.min.js', { method: 'HEAD' });
    if (!response.ok) return false;
    return !(response.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/**
 * Measures OCR cold start and warm recognition separately.
 *
 * Cold includes worker spin-up, WASM compilation, and loading the language
 * data. Warm is a second pass with all of that already in place. Quoting the
 * warm number as if it were the first-run experience is exactly the false claim
 * NFR-06 exists to prevent.
 */
async function ocrProbe(signal?: AbortSignal): Promise<ProbeResult> {
  if (!(await ocrAssetsPresent())) {
    return {
      id: 'ocr',
      label: 'OCR cold start and warm run',
      status: 'skipped',
      detail:
        'Tesseract assets are not installed, so OCR could not be measured. See public/models/tesseract/README.md, then run this probe again.',
      measurements: [],
    };
  }

  const image = await makeTestImage(900, 400, 'png');

  try {
    const coldAt = performance.now();
    const cold = await recognize(image, { jobId: `probe-cold-${performance.now()}`, signal });
    const coldMs = performance.now() - coldAt;

    const warmAt = performance.now();
    await recognize(image, { jobId: `probe-warm-${performance.now()}`, signal });
    const warmMs = performance.now() - warmAt;

    return {
      id: 'ocr',
      label: 'OCR cold start and warm run',
      status: 'pass',
      detail:
        'Cold includes worker start, WASM compilation, and language data. Report these two numbers separately — never quote the warm one as a first-run figure.',
      measurements: [
        { label: 'Cold run', value: ms(coldMs) },
        { label: 'Warm run', value: ms(warmMs) },
        { label: 'Characters returned', value: String(cold.text.trim().length) },
        { label: 'Word boxes returned', value: String(cold.words.length) },
      ],
    };
  } catch (error) {
    return {
      id: 'ocr',
      label: 'OCR cold start and warm run',
      status: 'fail',
      detail: `OCR failed on this device: ${error instanceof Error ? error.message : 'unknown error'}`,
      measurements: [],
    };
  }
}

const HAPPY_PATH_RULES: Rule[] = [
  { id: 'fmt', field: 'format', allowed: ['jpeg'], origin: 'manual', reviewState: 'confirmed' },
  {
    id: 'max',
    field: 'fileSize',
    operator: 'lte',
    value: 50,
    unit: 'KB',
    origin: 'manual',
    reviewState: 'confirmed',
  },
  {
    id: 'min',
    field: 'fileSize',
    operator: 'gte',
    value: 20,
    unit: 'KB',
    origin: 'manual',
    reviewState: 'confirmed',
  },
];

/**
 * Times the whole preparation pipeline on a realistic phone photo: decode,
 * render, bounded search, and independent verification.
 *
 * This is the number NFR-08's 15-second warm target refers to. It excludes OCR,
 * which is measured on its own above.
 */
async function happyPathProbe(signal?: AbortSignal): Promise<ProbeResult> {
  const requirements: ConfirmedRequirements = {
    rules: HAPPY_PATH_RULES,
    byteConvention: 'decimal',
    manualChecks: [],
    documentKind: 'photo',
    confirmedAt: 0,
  };

  const source = await makeTestImage(3000, 4000); // 12 MP, typical phone camera
  const bitmap = await decode(source);

  try {
    const {
      value: outcome,
      longestGapMs,
      elapsedMs: elapsed,
    } = await whileSamplingMainThread(() =>
      searchCandidates({
        sourceWidth: bitmap.width,
        sourceHeight: bitmap.height,
        requirements,
        signal,
        encode: async (request) => {
          const canvas = render({
            bitmap,
            crop: null,
            rotation: 0,
            targetWidth: request.width,
            targetHeight: request.height,
          });
          const blob = await encode(canvas, request.format, request.quality);
          return { blob, metadata: await measure(blob) };
        },
      }),
    );

    const withinTarget = elapsed <= 15_000;

    return {
      id: 'happy-path',
      label: 'Warm happy path (12 MP source)',
      status: outcome.ok ? (withinTarget ? 'pass' : 'fail') : 'fail',
      detail: outcome.ok
        ? withinTarget
          ? 'Inside the 15-second proposed target. This is a measured warm run and excludes OCR.'
          : 'Exceeded the 15-second proposed target. Either lower the attempt budget or revise the target to this measured value — do not present the target as achieved.'
        : `No candidate found: ${outcome.failure.kind}. Investigate before treating this as a timing result.`,
      measurements: [
        { label: 'Total elapsed', value: ms(elapsed) },
        { label: 'Encode attempts used', value: String(outcome.attempts) },
        { label: 'Proposed target', value: '15,000 ms' },
        // Baseline for the worker probe below: this is what the same work
        // costs the main thread when it is not moved off it.
        { label: 'Longest main-thread gap (inline)', value: ms(longestGapMs) },
        ...(outcome.ok
          ? [
              { label: 'Output size', value: `${outcome.result.metadata.byteLength.toLocaleString('en-US')} bytes` },
              {
                label: 'Output dimensions',
                value: `${outcome.result.metadata.width} × ${outcome.result.metadata.height}`,
              },
            ]
          : []),
      ],
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Runs preparation through the worker while sampling the main thread.
 *
 * This is the probe for NFR-03, and it measures the claim directly rather than
 * asserting it: frame callbacks are timed throughout the run, so the longest
 * gap is the longest the UI was unresponsive. If the work were still on the
 * main thread, a 12 MP render would show up here as gaps of hundreds of
 * milliseconds — which is exactly how long Cancel would ignore a tap.
 */
async function workerResponsivenessProbe(signal?: AbortSignal): Promise<ProbeResult> {
  const requirements: ConfirmedRequirements = {
    rules: HAPPY_PATH_RULES,
    byteConvention: 'decimal',
    manualChecks: [],
    documentKind: 'photo',
    confirmedAt: 0,
  };

  const source = await makeTestImage(3000, 4000);

  const {
    value: outcome,
    longestGapMs,
    frames,
    elapsedMs: elapsed,
  } = await whileSamplingMainThread(() =>
    prepareCandidate({
      jobRevision: 0,
      source,
      crop: null,
      rotation: 0,
      requirements,
      signal,
    }),
  );

  const responsive = longestGapMs < RESPONSIVE_GAP_MS;

  return {
    id: 'worker-responsiveness',
    label: 'Main thread stays responsive during preparation',
    status: outcome.ok && responsive ? 'pass' : 'fail',
    detail: !outcome.ok
      ? `Preparation did not produce a candidate (${outcome.failure.kind}). Investigate before reading the responsiveness number.`
      : responsive
        ? 'The main thread was never blocked long enough for Cancel to feel unresponsive.'
        : 'The main thread stalled long enough that Cancel would be ignored. Check that the preparation worker is actually being used.',
    measurements: [
      { label: 'Longest main-thread gap', value: ms(longestGapMs) },
      { label: 'Frames observed', value: String(frames) },
      { label: 'Total elapsed', value: ms(elapsed) },
      ...(outcome.ok
        ? [
            { label: 'Encode attempts used', value: String(outcome.attempts) },
            {
              label: 'Output',
              value: `${outcome.metadata.byteLength.toLocaleString('en-US')} bytes, ${outcome.metadata.width} × ${outcome.metadata.height}`,
            },
          ]
        : []),
    ],
  };
}

/** Which export routes exist on this browser. Download must always work. */
async function exportProbe(): Promise<ProbeResult> {
  const blob = await makeTestImage(200, 230);
  const file = new File([blob], 'formready-probe.jpg', { type: 'image/jpeg' });

  const anchorSupported = typeof document.createElement('a').download === 'string';
  let shareSupported = false;
  try {
    shareSupported = Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    shareSupported = false;
  }

  return {
    id: 'export',
    label: 'Export routes',
    status: anchorSupported ? 'pass' : 'fail',
    detail: anchorSupported
      ? 'Download is available. Confirm by hand that the saved file opens in another app — this probe checks the API, not the file manager.'
      : 'This browser does not support anchor downloads. Export needs a different route here.',
    measurements: [
      { label: 'Anchor download', value: anchorSupported ? 'supported' : 'not supported' },
      { label: 'Web Share with files', value: shareSupported ? 'supported' : 'not supported' },
      { label: 'Probe file size', value: `${blob.size.toLocaleString('en-US')} bytes` },
    ],
  };
}

/**
 * Accelerator detection for the optional browser-model decision.
 *
 * Reports only what was detected. WebGPU indicates a GPU compute path exists in
 * this browser; it is not evidence that a Snapdragon NPU is being used, and the
 * presentation must not say otherwise.
 */
async function acceleratorProbe(): Promise<ProbeResult> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  const measurements: Measurement[] = [
    { label: 'WebGPU API present', value: gpu ? 'yes' : 'no' },
    { label: 'WebAssembly', value: typeof WebAssembly !== 'undefined' ? 'yes' : 'no' },
    {
      label: 'SharedArrayBuffer',
      value: typeof SharedArrayBuffer !== 'undefined' ? 'yes (cross-origin isolated)' : 'no',
    },
  ];

  let adapter: unknown = null;
  if (gpu) {
    try {
      adapter = await gpu.requestAdapter();
    } catch {
      adapter = null;
    }
  }
  measurements.push({ label: 'WebGPU adapter obtained', value: adapter ? 'yes' : 'no' });

  return {
    id: 'accelerator',
    label: 'Accelerator availability',
    status: adapter ? 'pass' : 'unsupported',
    detail: adapter
      ? 'A WebGPU adapter is available. This means a GPU compute path exists — it is not evidence of NPU execution, and must not be described as such.'
      : 'No WebGPU adapter. The optional browser language model is not viable here; use the local OCR and pattern-extraction path.',
    measurements,
  };
}

export interface SuiteOptions {
  onResult: (result: ProbeResult) => void;
  signal?: AbortSignal;
  /** OCR and the happy path are slow; allow running the quick probes alone. */
  includeSlow?: boolean;
}

export async function runFeasibilitySuite(options: SuiteOptions): Promise<ProbeResult[]> {
  const { onResult, signal, includeSlow = true } = options;
  const results: ProbeResult[] = [];

  const probes: Array<[ProbeId, string, () => Promise<ProbeResult> | ProbeResult, boolean]> = [
    ['environment', 'Environment', () => environmentProbe(), false],
    ['orientation', 'EXIF orientation applied on decode', () => orientationProbe(), false],
    ['png-quality-noop', 'PNG ignores the quality argument', () => pngQualityProbe(), false],
    ['jpeg-monotonicity', 'JPEG quality is monotonic', () => jpegMonotonicityProbe(), false],
    ['export', 'Export routes', () => exportProbe(), false],
    ['accelerator', 'Accelerator availability', () => acceleratorProbe(), false],
    ['decode-ceiling', 'Decode ceiling', () => decodeCeilingProbe(signal), true],
    ['happy-path', 'Warm happy path (12 MP source)', () => happyPathProbe(signal), true],
    [
      'worker-responsiveness',
      'Main thread stays responsive during preparation',
      () => workerResponsivenessProbe(signal),
      true,
    ],
    ['ocr', 'OCR cold start and warm run', () => ocrProbe(signal), true],
  ];

  for (const [id, label, run, slow] of probes) {
    if (signal?.aborted) break;
    if (slow && !includeSlow) continue;

    onResult({ id, label, status: 'running', detail: 'Measuring…', measurements: [] });
    try {
      const result = await run();
      results.push(result);
      onResult(result);
    } catch (error) {
      const failed: ProbeResult = {
        id,
        label,
        status: 'fail',
        detail: error instanceof Error ? error.message : 'Unknown error.',
        measurements: [],
      };
      results.push(failed);
      onResult(failed);
    }
  }

  return results;
}

// --- Scope-freeze decisions ------------------------------------------------

export interface Decision {
  question: string;
  answer: string;
  rationale: string;
  /** True when the decision must be resolved before the build continues. */
  blocking: boolean;
}

function find(results: ProbeResult[], id: ProbeId): ProbeResult | undefined {
  return results.find((result) => result.id === id);
}

function measurementValue(result: ProbeResult | undefined, label: string): string | undefined {
  return result?.measurements.find((item) => item.label === label)?.value;
}

/**
 * Turns probe results into the scope-freeze decisions work package 1 is meant
 * to produce. Pure, so the decision rules are unit-testable without a device.
 *
 * The defaults are conservative: an unmeasured capability is treated as absent,
 * because shipping a claim that was never tested is the failure mode this
 * whole document set is written against.
 */
export function deriveDecisions(results: ProbeResult[]): Decision[] {
  const decisions: Decision[] = [];

  // 1. Input guardrail.
  const ceiling = find(results, 'decode-ceiling');
  const ceilingMp = Number((measurementValue(ceiling, 'Ceiling') ?? '0').replace(/[^\d.]/g, ''));
  if (!ceiling || ceiling.status !== 'pass' || ceilingMp === 0) {
    decisions.push({
      question: 'What megapixel guardrail should the picker enforce?',
      answer: 'Unknown — keep the proposed 20 MP limit and re-run this probe.',
      rationale: 'The decode ceiling was not measured, so the limit rests on an untested assumption.',
      blocking: true,
    });
  } else {
    // Back off one step from the observed ceiling: the probe runs on an idle
    // device, and a real session is holding an OCR worker and several bitmaps.
    const recommended = Math.max(1, Math.floor(ceilingMp * 0.75));
    decisions.push({
      question: 'What megapixel guardrail should the picker enforce?',
      answer:
        recommended >= 20
          ? 'Keep 20 MP.'
          : `Lower MAX_INPUT_PIXELS to about ${recommended} MP (75% of the ${ceilingMp} MP measured ceiling).`,
      rationale: `Measured ceiling on this device was ${ceilingMp} MP with nothing else running. A live session also holds the OCR worker and preview bitmaps, so the shipped limit should sit below it.`,
      blocking: recommended < 20,
    });
  }

  // 2. Search strategy.
  const monotonic = find(results, 'jpeg-monotonicity');
  decisions.push({
    question: 'Can the candidate search bisect on JPEG quality?',
    answer:
      monotonic?.status === 'pass'
        ? 'Yes — keep the bisection.'
        : 'No — replace the bisection with a linear sweep and re-budget the attempts.',
    rationale:
      monotonic?.status === 'pass'
        ? 'Byte size rose with quality across the tested range on this codec.'
        : 'Bisection is only correct when size rises with quality. This device did not show that, or the probe did not run.',
    blocking: monotonic?.status !== 'pass',
  });

  // 3. Crop correctness.
  const orientation = find(results, 'orientation');
  decisions.push({
    question: 'Is the crop editor safe to build against decoded coordinates?',
    answer:
      orientation?.status === 'pass'
        ? 'Yes — decode applies EXIF orientation.'
        : 'No — normalise orientation manually before the crop editor ships.',
    rationale:
      orientation?.status === 'pass'
        ? 'A known orientation-6 image decoded to its visual dimensions.'
        : 'Without applied orientation, an approved crop rectangle lands on the wrong axis for rotated phone photos.',
    blocking: orientation?.status !== 'pass',
  });

  // 4. Offline OCR.
  const ocr = find(results, 'ocr');
  decisions.push({
    question: 'Is the local OCR path viable on this device?',
    answer:
      ocr?.status === 'pass'
        ? `Yes. Cold ${measurementValue(ocr, 'Cold run')}, warm ${measurementValue(ocr, 'Warm run')} — quote both, separately.`
        : ocr?.status === 'skipped'
          ? 'Unknown — Tesseract assets are not installed yet.'
          : 'No — OCR failed here. The pasted-text path becomes the primary route.',
    rationale:
      'FR-15 and NFR-06 require the offline claim to rest on a cached-asset test, with first download and later operation reported separately.',
    blocking: ocr?.status !== 'pass',
  });

  // 5. Performance target.
  const happy = find(results, 'happy-path');
  const elapsed = Number((measurementValue(happy, 'Total elapsed') ?? '').replace(/[^\d]/g, ''));
  decisions.push({
    question: 'Does the warm happy path meet the 15-second target?',
    answer:
      happy?.status === 'pass'
        ? `Yes — ${elapsed} ms measured.`
        : elapsed
          ? `No — ${elapsed} ms measured. Publish this number, not the target.`
          : 'Unknown — not measured.',
    rationale:
      'The 15-second figure in NFR-08 is a proposed target. Whatever this probe measures replaces it in the deck and the README.',
    blocking: false,
  });

  // 6. Optional browser model. Conservative by default.
  const accelerator = find(results, 'accelerator');
  const adapter = measurementValue(accelerator, 'WebGPU adapter obtained') === 'yes';
  decisions.push({
    question: 'Should the optional browser language model be built (P1)?',
    answer: adapter
      ? 'Eligible, but not approved. Run a real model load and first-token test before committing any hours.'
      : 'No. Ship the local OCR and pattern-extraction path.',
    rationale: adapter
      ? 'A WebGPU adapter exists, which is a necessary condition and not a sufficient one. It is a GPU path, not an NPU path, and the presentation must not claim otherwise.'
      : 'No WebGPU adapter was available, so the browser model is out of scope for this build.',
    blocking: false,
  });

  // 7. Export.
  const exportProbeResult = find(results, 'export');
  decisions.push({
    question: 'Does export work on this browser?',
    answer:
      exportProbeResult?.status === 'pass'
        ? `Download works. Web Share: ${measurementValue(exportProbeResult, 'Web Share with files')}.`
        : 'No — export needs a different route on this browser.',
    rationale:
      'This probe tests the API only. Confirm by hand that a downloaded file opens in another viewer (FR-13).',
    blocking: exportProbeResult?.status !== 'pass',
  });

  return decisions;
}

/** Machine-readable record for pasting into docs/feasibility.md. */
export function buildReport(results: ProbeResult[], capturedAt: string) {
  return {
    capturedAt,
    userAgent: navigator.userAgent,
    results,
    decisions: deriveDecisions(results),
  };
}
