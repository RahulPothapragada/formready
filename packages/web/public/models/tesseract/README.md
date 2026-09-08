# Tesseract assets

Install with:

```bash
npm run setup:ocr
```

That copies the worker and core builds out of `node_modules` — so they always
match the installed tesseract.js version — and downloads the English language
data. The files themselves are not committed: they are large binaries with
their own licences that change with every tesseract.js upgrade.

## Why they are served from our own origin

Loading them from a CDN would work perfectly in development and fail the moment
the phone loses signal. Same-origin URLs are what let the service worker cache
them, and that cache is the whole basis of the offline claim in FR-15.

The worker uses **absolute** URLs (`${self.location.origin}/models/...`), not
root-relative ones. tesseract.js loads its own worker through a `blob:` URL, and
`importScripts` inside a blob worker has an opaque base, so `/models/...` fails
to resolve. This cost an afternoon once; it is not a stylistic choice.

## What gets installed

| File | Size | Source |
| --- | --- | --- |
| `worker.min.js` | 0.1 MB | `node_modules/tesseract.js/dist/` |
| `tesseract-core-relaxedsimd-lstm.wasm.js` | 3.7 MB | `node_modules/tesseract.js-core/` |
| `tesseract-core-simd-lstm.wasm.js` | 3.7 MB | `node_modules/tesseract.js-core/` |
| `tesseract-core-lstm.wasm.js` | 3.7 MB | `node_modules/tesseract.js-core/` |
| `lang/eng.traineddata` | 3.9 MB | [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) |

All three core builds ship because tesseract.js picks one at runtime by probing
for SIMD support. **A given device downloads exactly one of them**, so the real
first-run cost is about 7.7 MB, not 15 MB.

`tessdata_fast` rather than `tessdata`: 3.9 MB against 15–23 MB. Both read
printed instruction text acceptably; only one is reasonable to hold on a phone.

## Caching

These are deliberately *not* precached. Spending ~8 MB on a first visit that may
never use OCR is the wrong trade on mobile data. The service worker caches them
CacheFirst on first use, which is what FR-15 actually describes — "after assets
are cached".

That makes the first download and later offline operation two different claims,
and NFR-06 requires them to be reported as two different numbers.

## Verifying the offline path

Cached assets are not the same as a working offline app. Test it:

```bash
npm run build
npm run verify:offline
```

That loads the app once online, cuts the network at the browser level, reloads,
and re-runs the probes. Repeat it by hand on the phone with aeroplane mode
before claiming offline support anywhere.
