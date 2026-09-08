# Test fixtures

Synthetic only. No real applicant photographs, signatures, or identity documents
belong in this repository, and none should be used during development.

## Instruction text

Labelled instruction strings live inline in `tests/ruleExtraction.test.ts` rather
than as files, so the expected extraction sits next to the input.

Held-out instruction/document pairs for the pilot are deliberately *not* stored
here — they are kept out of the repository so the extractor cannot be tuned
against them. See [`docs/evaluation.md`](../../docs/evaluation.md).

## Image fixtures to generate

Needed for the browser-dependent suites, which do not run in Node:

| Fixture | Purpose |
| --- | --- |
| `rotated-exif.jpg` | EXIF orientation 6; confirms decode applies rotation before crop |
| `already-small.jpg` | Under any plausible size floor; drives `min-size-unreachable` |
| `oversized.jpg` | Above the 10 MiB / 20 MP guardrails; must fail before decode |
| `faint-signature.png` | Low-contrast strokes; exercises quality retention |
| `noisy-instructions.png` | Screenshot with compression artefacts; OCR stress case |
| `corrupt.jpg` | Valid JPEG header, truncated body; must fail cleanly |
| `renamed.pdf.jpg` | A PDF with a `.jpg` extension; must be rejected by magic bytes |

Generate these with a script rather than committing binaries where possible, so
the repository stays small and the fixtures stay reproducible.

## Rule for adding a fixture

Every fixture exists to pin a specific behaviour. Name the behaviour in the
table above when adding one — a fixture with no stated purpose becomes
untouchable within a week.
