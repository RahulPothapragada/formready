# Device feasibility — work package 1

**Status: not yet run on a phone.** Every number below is blank on purpose. The
specification's limits and timings are proposals; this document is where they
become measurements, or get revised.

Harness: `/feasibility` in the running app. Not linked from the product
journey — navigate to it directly.

## How to run it

1. Build and serve the app, then open it on the phone that will run the demo.
   A desktop run only checks that the harness itself works; it is not evidence
   about the device.
2. Unplug. Debuggers and charging both change thermal and CPU behaviour.
3. Install the Tesseract assets first
   (see [`public/models/tesseract/README.md`](../public/models/tesseract/README.md)),
   or the OCR probe reports `skipped` rather than a timing.
4. Run with slow probes enabled. Copy the JSON report and paste it below.
5. Record the device model and whether the run was cold or warm — the harness
   cannot know either.

## Harness verification (desktop, not device evidence)

The harness was driven once in headless Chrome 152 on macOS to prove it runs and
reports honestly. **These numbers say nothing about the phone** — a laptop has
more memory, a different codec build, and no thermal limit. They are recorded
only because the run found two real defects:

- The geometry ladder bottomed out at 53% linear size, so a 12 MP source could
  never reach a 50 KB target. It exhausted all 24 attempts and reported
  `no-candidate-in-budget`. Widening the ladder to 12% fixed it: the same case
  now succeeds in 13 attempts, and the winning geometry is at 25% scale — a rung
  the old ladder did not have.
- The OCR asset check trusted `response.ok`, but this is a single-page app, so
  the SPA fallback answers a missing file with `200 text/html`. A setup problem
  was being reported as an OCR failure.

Desktop results, for reference only: 24 MP decode ceiling, JPEG size monotonic
across six quality steps, PNG identical at quality 0.1 and 0.95 (753,626 bytes
both times), EXIF orientation applied on decode, warm happy path 803 ms.

### Watch for a stale service worker

The app registers a service worker with `autoUpdate` precaching. During the
verification run it served a cached bundle and two fixes appeared not to work
until the browser profile was cleared. When a change seems to have no effect,
clear site data before debugging anything else — and be aware the same thing can
happen on the demo phone.

## Run record

| | |
| --- | --- |
| Date | _not run_ |
| Device | _not run_ |
| OS / browser | _not run_ |
| On battery | _not run_ |
| Assets cached | _not run_ |

## What each probe decides

| Probe | What it measures | What it gates |
| --- | --- | --- |
| Environment | UA, viewport, cores, memory, OffscreenCanvas | Context for every other number |
| Decode ceiling | Largest image created and decoded end to end | `MAX_INPUT_PIXELS` in `services/imageCodec.ts` |
| JPEG monotonicity | Whether byte size rises with the quality argument | Whether `generateCandidates.ts` may bisect at all |
| PNG quality no-op | Whether the quality argument changes PNG size | The PNG branch and its separate failure kind |
| EXIF orientation | Whether decode applies orientation | Whether the crop editor can use decoded coordinates |
| OCR | Cold start and warm run, separately | FR-15, NFR-06, and the offline claim |
| Warm happy path | Decode → render → search → verify, 12 MP source | The NFR-08 15-second target |
| Export | Anchor download and Web Share availability | FR-13 and the P1 share feature |
| Accelerator | WebGPU adapter presence | The P1 browser-model go/no-go |

Two of these are correctness probes rather than performance ones, and they are
the ones worth watching:

- **JPEG monotonicity.** Bisection is only sound if size rises with quality. If
  a device's codec breaks that, the search is wrong, not just slow.
- **EXIF orientation.** If `imageOrientation: 'from-image'` is not honoured,
  every approved crop on a rotated photo lands on the wrong axis.

## Results

_Paste the JSON report here after the run._

```json
```

## Scope-freeze decisions

The harness derives these automatically and marks the blocking ones. Copy them
here with the answers filled in — this table is the actual output of work
package 1, and work package 2 should not start while a blocking row is open.

| Question | Answer | Blocking |
| --- | --- | --- |
| What megapixel guardrail should the picker enforce? | | |
| Can the candidate search bisect on JPEG quality? | | |
| Is the crop editor safe to build against decoded coordinates? | | |
| Is the local OCR path viable on this device? | | |
| Does the warm happy path meet the 15-second target? | | |
| Should the optional browser language model be built (P1)? | | |
| Does export work on this browser? | | |

## Rules for reading these numbers

**Cold and warm are different claims.** OCR cold start includes worker spin-up,
WASM compilation, and loading language data. Quoting the warm number as a
first-run figure is the specific false claim NFR-06 exists to prevent.

**A missed target is published, not hidden.** If the happy path takes 21
seconds, the deck says 21 seconds. The 15-second figure was always a target to
test, and replacing it with the measured value is the correct outcome — not a
failure of the build.

**WebGPU is not an NPU.** A WebGPU adapter means a GPU compute path exists in
this browser. It is not evidence of Snapdragon NPU execution, and no slide may
imply otherwise. Native NPU work is a separate engineering project (P2).

**An adapter is necessary, not sufficient.** Even with WebGPU present, the
browser-model decision stays *eligible, not approved* until a real model load
and first-token test has run. The decision rules default to no.

**Unmeasured means blocking.** A probe that did not run leaves its decision
open. Treating silence as a pass is how an untested capability reaches a
demo.

## Follow-ups this harness does not cover

- Whether a downloaded file actually opens in another app. The probe checks the
  API, not the file manager — verify by hand (FR-13).
- Memory pressure across a long session with several jobs prepared in sequence.
- Thermal behaviour on repeated runs; a demo often happens after the phone has
  already been working.
- Real OCR accuracy. The probe measures timing on a synthetic image and reports
  the character count; it says nothing about whether instructions are read
  correctly. That belongs in [`evaluation.md`](evaluation.md).
