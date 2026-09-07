import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const entries = [
  { in: resolve(here, 'src/content.ts'), out: resolve(here, 'dist/content.js') },
  { in: resolve(here, 'src/popup.ts'), out: resolve(here, 'dist/popup.js') },
];

for (const entry of entries) {
  await build({
    entryPoints: [entry.in],
    outfile: entry.out,
    bundle: true,
    format: 'iife',
    target: 'chrome110',
    // Content scripts are injected as classic scripts, not modules, so
    // everything has to land in one self-contained IIFE with no imports.
    sourcemap: 'inline',
    logLevel: 'info',
  });
}
