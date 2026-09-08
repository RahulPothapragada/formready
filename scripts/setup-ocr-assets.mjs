#!/usr/bin/env node
/**
 * Installs the Tesseract assets FormReady serves from its own origin.
 *
 * These are not committed: they are large binaries with their own licences, and
 * they change with the tesseract.js version. The core files are copied out of
 * node_modules so they always match the installed package; only the language
 * data is downloaded.
 *
 * Serving them from our origin is what makes the offline claim in FR-15 real.
 * Pointing the worker at a CDN would appear to work in development and quietly
 * fail the moment the phone loses signal.
 *
 * Usage: npm run setup:ocr
 */

import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages', 'web', 'public', 'models', 'tesseract');

/**
 * tessdata_fast, not tessdata. Roughly 4 MB against 15–23 MB, and both read
 * printed instruction text acceptably — only one of them is reasonable to hold
 * on a phone.
 */
const LANG_URL =
  'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata';

/**
 * The LSTM-only builds. tesseract.js picks one at runtime by probing for SIMD
 * support, so all three ship: relaxed SIMD for recent Chrome and Safari, plain
 * SIMD for most phones, and the baseline as a fallback. Only the chosen one is
 * ever downloaded by a given device.
 */
const CORE_FILES = [
  'tesseract-core-relaxedsimd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-lstm.wasm.js',
];

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function copyInto(from, to) {
  await copyFile(from, to);
  return (await stat(to)).size;
}

async function main() {
  await mkdir(join(target, 'lang'), { recursive: true });

  const workerSource = join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js');
  const coreDir = join(root, 'node_modules', 'tesseract.js-core');

  let total = 0;
  const installed = [];

  total += await copyInto(workerSource, join(target, 'worker.min.js')).then((size) => {
    installed.push(['worker.min.js', size]);
    return size;
  });

  for (const name of CORE_FILES) {
    const size = await copyInto(join(coreDir, name), join(target, name));
    installed.push([name, size]);
    total += size;
  }

  const langTarget = join(target, 'lang', 'eng.traineddata');
  process.stdout.write(`Downloading ${LANG_URL}\n`);
  const response = await fetch(LANG_URL);
  if (!response.ok) {
    throw new Error(`Language data download failed: ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(langTarget));
  const langSize = (await stat(langTarget)).size;
  installed.push(['lang/eng.traineddata', langSize]);
  total += langSize;

  for (const [name, size] of installed) {
    process.stdout.write(`  ${name.padEnd(44)} ${megabytes(size).padStart(9)}\n`);
  }

  process.stdout.write(`\nInstalled into packages/web/public/models/tesseract (${megabytes(total)} total).\n`);
  process.stdout.write(
    'A device downloads one core build, not all three — see docs/feasibility.md\n' +
      'for what a first run actually costs versus later offline operation.\n',
  );

  // Guard against a silent mismatch: the worker names these paths explicitly,
  // and a tesseract.js upgrade that renames a file would otherwise only surface
  // as "OCR failed" on the phone.
  const present = new Set(await readdir(target));
  const missing = ['worker.min.js', ...CORE_FILES].filter((name) => !present.has(name));
  if (missing.length > 0) {
    throw new Error(`Expected files are missing after install: ${missing.join(', ')}`);
  }
}

main().catch((error) => {
  process.stderr.write(`\nSetup failed: ${error.message}\n`);
  process.exitCode = 1;
});
