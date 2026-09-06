# Tesseract assets

These files are served from the app's own origin so that OCR keeps working
offline once the service worker has cached them (FR-15). Loading them from a CDN
would make the offline claim false while appearing to work in development.

The directory is empty in version control — the assets are binaries and are
fetched during setup.

## What goes here

| File | Source | Notes |
| --- | --- | --- |
| `worker.min.js` | `node_modules/tesseract.js/dist/` | Worker entry point |
| `tesseract-core-simd.wasm.js` | `node_modules/tesseract.js-core/` | Core, SIMD build |
| `lang/eng.traineddata.gz` | [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) | See below |

## Use tessdata_fast, not tessdata

`tessdata_fast/eng.traineddata` is roughly 4 MB. The standard `tessdata` build
is 15–23 MB. Both read printed instruction text acceptably; only one of them is
reasonable to precache on a phone, and the precache is what makes offline
operation real rather than nominal.

## Populating

```bash
mkdir -p public/models/tesseract/lang
cp node_modules/tesseract.js/dist/worker.min.js public/models/tesseract/
cp node_modules/tesseract.js-core/tesseract-core-simd.wasm.js public/models/tesseract/
curl -L -o public/models/tesseract/lang/eng.traineddata.gz \
  https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata.gz
```

Verify the paths against the installed `tesseract.js` version before relying on
them — the dist layout has changed between major releases. The paths the app
uses are set in `src/workers/ocr.worker.ts`.

## Verifying the offline path

Cached assets are not the same as a working offline app. Test it properly:

1. Load the app once with a network connection and let it settle.
2. Put the phone in aeroplane mode.
3. Reload, run OCR on a screenshot, confirm rules, prepare, and download.

Report the first-download experience and the later-operation experience
separately (NFR-06). They are different claims.
