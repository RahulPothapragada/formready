import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The boundary, enforced.
 *
 * The engine is the half of this product that has to run unchanged in a
 * browser, in Node, and inside an embedded JavaScript runtime on a phone. That
 * property is easy to state and easy to lose — one convenient `document.` or
 * one import of a platform module and the Android port stops being a port and
 * starts being a rewrite.
 *
 * So it is checked here rather than trusted. If this suite fails, the fix is to
 * move the offending code into a platform adapter, not to widen the list below.
 */

const here = dirname(fileURLToPath(import.meta.url));
const engineSrc = resolve(here, '../src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

const files = sourceFiles(engineSrc);

/** Globals that only exist on a platform, not in a bare JavaScript runtime. */
const FORBIDDEN_GLOBALS = [
  'document',
  'window',
  'navigator',
  'localStorage',
  'indexedDB',
  'performance',
  'chrome',
  'OffscreenCanvas',
  'HTMLCanvasElement',
  'ImageBitmap',
  'createImageBitmap',
  'FileReader',
  'XMLHttpRequest',
];

describe('the engine package stays portable', () => {
  it('contains source files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN_GLOBALS)('never reaches for `%s`', (global) => {
    // Word-boundary match, so `documentKind` and `MIME_BY_FORMAT` are fine.
    const pattern = new RegExp(`\\b${global}\\b\\s*[.[(]`);
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf-8')
        // Comments explain the boundary; they are allowed to name what is on
        // the other side of it.
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      return pattern.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('imports nothing outside its own package', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.')) continue;
        // zod is the one dependency, and it is platform-neutral.
        if (specifier === 'zod') continue;
        offenders.push(`${file}: ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never reaches back into a platform package by relative path', () => {
    const offenders = files.filter((file) =>
      /from\s+['"][^'"]*(services|components|workers|features|app)\//.test(readFileSync(file, 'utf-8')),
    );
    expect(offenders).toEqual([]);
  });

  it('exposes one public entry point', () => {
    const index = readFileSync(join(engineSrc, 'index.ts'), 'utf-8');
    // Everything a platform adapter needs must be reachable from here, so
    // adapters never deep-import into the engine's internals.
    for (const symbol of [
      'extractRules',
      'searchCandidates',
      'buildValidationReport',
      'jobReducer',
      'canExport',
      'visualCropToSource',
      'sniffFormat',
      'parseRuleProposal',
    ]) {
      expect(index).toMatch(new RegExp(`\\b${symbol}\\b`));
    }
  });
});
