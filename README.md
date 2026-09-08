# FormReady

**Show the requirements. Get your document ready.**

A phone-first web app that reads the upload instructions in front of you, turns
them into explicit checks you confirm, prepares your document against them, and
then independently re-reads the produced file before letting you export it.

> **Status:** working prototype for the iQOO submission round — not the final
> hackathon build. The complete journey runs end to end: instructions in,
> checked file downloaded, verified automatically in a real browser against both
> the production build and the dev server. Nothing has been validated on a phone
> yet — see [Current state](#current-state).

---

## Why this exists

Online applications ask for uploads in specific formats, size ranges, and pixel
dimensions. Meeting those limits by hand means guessing at editor settings and
re-exporting until something sticks. A file can land inside the size limit and
still be unreadable, cropped wrong, or attached to the wrong field.

Resizing and compression are not new. The thing worth building is the chain:
read the actual instructions → link each extracted requirement to the text it
came from → prepare the file → verify the result independently → let the user
look at it before it leaves the app.

## What it claims, and what it does not

FormReady checks **the requirements you confirmed**, and shows what it checked.

| Checked exactly, from the produced bytes | Left to you |
| --- | --- |
| Decoded format (JPEG / PNG) | DPI and physical dimensions |
| Byte count against confirmed bounds | Background colour, lighting |
| Pixel width and height | Whether the photo is recent |
| | Whether the document is readable |

Successful preparation is not the same as portal acceptance. The interface keeps
that line visible, and the app never says "all requirements passed" when part of
the instruction set was never checkable.

## Design decisions worth knowing

**The verifier reads bytes, not intentions.** `services/verifier.ts` accepts a
`Blob` and nothing else. It never receives the encoder settings that produced
the file, because a report built from requested settings restates intent rather
than checking a result.

**One counter kills the whole stale-result class.** Any change to the source
document, the approved crop, or the confirmed rules bumps `job.revision` and
drops the candidate, its report, and the user's review. Every candidate carries
the revision it was made for, so a worker that finishes after an edit is
discarded rather than shown.

**Exclusive bounds are tightened on the way in.** "Under 50 KB" becomes "at most
49,999 bytes" once, at parse time, because bytes are integers. Downstream code
only ever deals with inclusive intervals.

**Absent, unresolved, and confirmed are three different things.** A missing
width constraint is not a zero-pixel target. A width that OCR could not read is
`unresolved`, blocks export, and says so.

**JPEG quality is bisected, not swept.** Byte size is monotonic enough in the
quality parameter that ~7 attempts land a byte target, which leaves budget to
try several geometries inside the same 12-second ceiling.

**PNG has no quality lever.** The canvas APIs ignore the quality argument for
PNG, so geometry is the only control and some size windows are genuinely
unreachable. That gets its own failure kind and its own message rather than a
generic "couldn't find a suitable file".

**Nothing is confirmed automatically.** Extraction produces proposals with
source spans. The user ticks what applies. Contradictory rules block
confirmation outright.

**Saving is automatic, deleting is one tap.** The specification puts persistence
behind an explicit Save button. That is exactly useless in the case that
matters — an accidental reload is when nobody pressed Save — so the job is
mirrored to IndexedDB as you go. What the specification was protecting is kept:
the app says plainly that the document is on this device, offers a visible
Delete, and never claims recovery it cannot provide. When saving fails, it says
so rather than staying quiet.

## Getting started

```bash
npm install
npm run setup      # fetch OCR assets, generate PWA icons
npm run dev        # http://localhost:5173
npm run check      # typecheck + lint + tests
```

### OCR assets

`npm run setup:ocr` copies the Tesseract core out of `node_modules` and
downloads `tessdata_fast` English data into `public/models/tesseract/` (~15 MB
on disk; a given device downloads one 3.7 MB core build, not all three). They
are not committed — they are large binaries with their own licences that change
with the tesseract.js version.

Serving them from our own origin is what makes the offline path real. A CDN
would work in development and fail the moment the phone loses signal.

They are **not** precached: spending ~8 MB on a first visit that may never use
OCR is the wrong trade on mobile data. They are cached on first use instead,
which is exactly what FR-15 describes — "after assets are cached".

## Repository layout

A workspace, split by *what each part is allowed to depend on* rather than by
feature. The boundary is the point: the engine has to run unchanged on a phone,
so it is a package that cannot import a platform, not a folder that merely
happens not to.

```
packages/
  engine/      Portable core — zero platform imports, enforced by test
    src/
      types.ts            what a requirement and a job are
      constraints.ts      exact arithmetic over bytes and pixels
      schemas.ts          validation boundary for untrusted proposals
      naming.ts           output filenames from the decoded format
      rules/extract.ts    instruction text -> typed constraints
      geometry/crop.ts    crop maths, incl. rotated-view conversion
      geometry/fit.ts     output geometry the search plans against
      search/candidates.ts bounded search for a compliant encoding
      job/reducer.ts      lifecycle and revision-based invalidation
      job/snapshot.ts     what may survive a reload
      media/format.ts     magic-byte format sniffing, input guardrails
      media/exif.ts       EXIF orientation, written not read
      index.ts            the only entry point adapters may use

  browser/     Browser platform adapter — fills the engine's imaging seam
    src/imaging.ts        decode, render, encode via canvas
    src/verifier.ts       re-reads produced bytes to build the report

  web/         The PWA: screens, workers, storage, feasibility harness
  extension/   The browser extension: reads a page, hands over a file
```

**The seam.** `searchCandidates` takes its encoder as a parameter. The engine
decides *what size and format* to produce; a platform decides *how*. That single
injection point is why an Android adapter replaces `packages/browser` and
nothing else.

**The boundary is enforced, not documented.**
`packages/engine/tests/enginePurity.test.ts` fails the build if anything in the
engine reaches for `document`, `window`, `canvas`, `Blob`, `performance`, or any
other platform global, or imports anything outside its own package. If it fails,
the fix is to move code into an adapter — not to widen the list.

## Current state

Implemented and covered by tests:

- **The portability boundary itself** — the engine package is checked against
  platform globals and cross-package imports on every run
- Exact constraint arithmetic, including operator semantics, byte conventions,
  and conflict detection
- Job state machine with revision-based invalidation and the export gate
- Pattern-based rule extraction with source spans and ambiguity reporting
- Bounded candidate search with JPEG bisection and typed failure kinds

Verified in a real browser (headless Chrome), but not yet on a phone:

- **The complete journey**, driven by `npm run verify:journey`: type
  instructions, extract and confirm rules, upload a document, approve framing,
  prepare, review, download. Twelve asserted steps including that Download stays
  disabled until the visual review is acknowledged, and that the file actually
  reaches disk.
- The same journey against the dev server (`verify:journey:dev`), where React
  double-invokes effects — a mode the production build does not exercise.
- **Work survives a reload.** The job — including the original document and the
  prepared candidate — is mirrored to IndexedDB as you go and restored on load.
  The journey proves it: it reloads the page mid-flow, checks the confirmed
  rules and the document are still there, carries on to a download, then deletes
  the saved work and checks it is really gone.
- **Direct-manipulation cropping.** Drag to move, pinch or drag a corner to
  resize, with the shape locked when the rules pin exact dimensions. The
  rotation conversion — the editor shows the rotated view, the pipeline crops
  the unrotated source — is a pure module with its own tests, because a wrong
  conversion keeps the wrong part of the picture and looks like it working.
- OCR end to end, including offline. All five key tokens read from rendered
  instruction text; cold 190-600 ms, warm 74 ms.
- The offline claim: assets cached on first use, network cut, OCR and
  preparation still work.

Implemented but not yet exercised by a human:

- Every screen has been driven by the automated journey, but nobody has used the
  app by hand on a touch device.
- **Preparation worker.** Decode, render, search, and verification all run off
  the main thread, so progress and Cancel stay responsive (NFR-03). Verified in
  a browser: the same 12 MP preparation blocks the main thread for 90 ms inline
  versus 18 ms through the worker. Geometry is planned against the *rotated*
  source shape, since a quarter turn swaps the aspect ratio.

Built, but needs a phone to produce output:

- **Feasibility harness** at `/feasibility` (work package 1). Measures the
  decode ceiling, JPEG quality monotonicity, the PNG quality no-op, EXIF
  orientation handling, OCR cold versus warm, the warm happy path, export
  routes, and WebGPU availability — then derives the scope-freeze decisions
  those measurements force. Fill in [`docs/feasibility.md`](docs/feasibility.md)
  from its JSON report before starting work package 2.

Not started:

- Held-out evaluation set and the results table

Deliberately excluded from v1: PDFs, accounts, batch mode, payments, native NPU
integration, automatic portal submission, and any claim of guaranteed
acceptance.

## Testing

```bash
npm test
```

The suites run in Node with no browser. The candidate search is tested against a
synthetic encoder that models JPEG size as a function of pixels and quality, and
PNG as a function of pixels alone — which is what makes PNG size limits hard.

Browser-dependent paths — decode, render, encode, OCR, the service worker —
cannot run in Node. They are covered by driving a real browser instead:

```bash
npm run build
npm run verify:journey       # the whole user journey, instructions to download
npm run verify:journey:dev   # the same, with React Strict Mode active
npm run verify:browser       # the device probe suite
npm run verify:offline       # loads online, cuts the network, re-runs
```

`verify:journey` is the one that matters most: every screen and service was
verified separately long before the seam between them was, and that seam is
where the bugs were.

`verify:offline` is the honest test of FR-15: it loads the app once so the
service worker caches its assets, cuts the network at the browser level, then
reloads and re-runs. OCR, preparation, and export all still pass.

Both are desktop smoke tests. Neither is evidence about the phone — for that,
open `/feasibility` on the device:

```bash
npm run dev   # then open /feasibility on the phone, not the laptop
```

## Specification

The full requirements document — scope, acceptance criteria, screen structure,
and the 40-hour allocation — is
[`docs/specification.md`](docs/specification.md).

## Licence

MIT
