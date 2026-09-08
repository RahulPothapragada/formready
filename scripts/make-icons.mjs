#!/usr/bin/env node
/**
 * Generates the PWA icons referenced by the web manifest.
 *
 * Written as a generator rather than committed binaries so the mark can be
 * changed in one place, and with a hand-rolled PNG encoder so this costs no
 * dependency. Without these the manifest 404s and the app cannot be installed
 * to a home screen — which is how it is meant to be demonstrated.
 *
 * Usage: npm run setup:icons
 */

import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages', 'web', 'public', 'icons');

const ACCENT = [29, 78, 216]; // matches --accent in src/index.css
const WHITE = [255, 255, 255];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encodes RGB pixel rows as a PNG. */
function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  // Compression, filter, interlace: the only values PNG defines.
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const stride = size * 3;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A white check mark on the accent colour: the app's whole promise is that the
 * file was checked. Drawn from two thick segments with a distance function, so
 * it stays clean at 192 px and still legible at 48.
 */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 3);
  const stroke = size * 0.09;

  // Endpoints of the check, in fractions of the canvas.
  const segments = [
    [0.28, 0.52, 0.44, 0.68],
    [0.44, 0.68, 0.74, 0.34],
  ].map(([x1, y1, x2, y2]) => [x1 * size, y1 * size, x2 * size, y2 * size]);

  const distanceToSegment = (px, py, [x1, y1, x2, y2]) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nearest = Math.min(...segments.map((segment) => distanceToSegment(x + 0.5, y + 0.5, segment)));
      // One-pixel smoothing band, so edges are not jagged at small sizes.
      const coverage = Math.max(0, Math.min(1, stroke / 2 - nearest + 0.5));
      const offset = (y * size + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels[offset + channel] = Math.round(
          ACCENT[channel] * (1 - coverage) + WHITE[channel] * coverage,
        );
      }
    }
  }

  return pixels;
}

await mkdir(target, { recursive: true });
for (const size of [192, 512]) {
  const png = encodePng(size, draw(size));
  await writeFile(join(target, `icon-${size}.png`), png);
  process.stdout.write(`  icon-${size}.png  ${(png.length / 1024).toFixed(1)} KB\n`);
}
process.stdout.write('\nIcons written to packages/web/public/icons.\n');
