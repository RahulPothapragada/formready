# FormReady

**Show the requirements. Get your document ready.**

A phone-first web app that reads the upload instructions in front of you, turns
them into explicit checks you confirm, prepares your document against them, and
then independently re-reads the produced file before letting you export it.

> **Status:** early implementation. The domain core, job state machine, rule
> extraction, and candidate search are implemented and tested. The screens are
> wired to real logic but have not been through device testing. Nothing here has
> been validated on a phone yet — see [Current state](#current-state).

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

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # typecheck + lint + tests
```

### OCR assets

Tesseract assets are served from this app's own origin so the offline path is
real. Populate `public/models/tesseract/` before relying on offline operation —
see [`public/models/tesseract/README.md`](public/models/tesseract/README.md).
Pointing these at a CDN would silently break FR-15.

## Repository layout

```
src/
  app/          job reducer, context, routes, shell
  domain/       types, zod schemas, exact constraint arithmetic
  features/
    requirements/  OCR text → evidence-linked rules → confirmation
    capture/       document picker, crop and rotation approval
    preparation/   bounded candidate search
    review/        checklist, visual review, export gate
    demo/          clearly-labelled demo upload checker
    feasibility/   device probe harness (work package 1)
  services/     ocr, imageCodec, verifier, exportFile, modelParser
  workers/      OCR and preparation workers
tests/          deterministic suites (no browser required)
docs/           demo script, evaluation plan
```

## Current state

Implemented and covered by tests:

- Exact constraint arithmetic, including operator semantics, byte conventions,
  and conflict detection
- Job state machine with revision-based invalidation and the export gate
- Pattern-based rule extraction with source spans and ambiguity reporting
- Bounded candidate search with JPEG bisection and typed failure kinds

Implemented but not yet device-tested:

- OCR worker wiring, image decode/render/encode, all four screens, export
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

- Crop editor as a touch overlay (currently numeric inputs)
- Held-out evaluation set and the results table
- PWA icons and precached OCR assets

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

Browser-dependent paths (decode, render, encode, download) need device testing
and are not covered here — that is what `/feasibility` is for.

```bash
npm run dev   # then open /feasibility on the phone, not the laptop
```

## Specification

The full requirements document — scope, acceptance criteria, screen structure,
and the 40-hour allocation — is
[`docs/specification.md`](docs/specification.md).

## Licence

MIT
