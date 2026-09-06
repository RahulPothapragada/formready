# Evaluation plan

**Research question.** Does grounded requirement extraction with independent
verification reduce invalid exports and preparation effort, relative to manual
tools, preset resizers, and model-only assistants?

No results are recorded here yet. This file defines what will be measured and
how, so the numbers cannot be chosen after the fact.

## Rules for this document

1. Every outcome gets published, including the failures. A pilot that only
   reports its successes measures nothing.
2. Timings come from the actual phone, and cold setup is reported separately
   from warm processing. A cached-run number presented as a first-run number is
   a false claim.
3. Metadata arithmetic is not image-quality evaluation. Any statement about
   readability needs a human looking at the output.

## Held-out set

20 instruction/document pairs, none of them used while building the extractor.

| Band | Count | What it contains |
| --- | --- | --- |
| Fully specified | 10 | Format, size bound, and dimensions all stated plainly |
| Partially specified | 5 | One constraint missing or stated in an unusual unit |
| Ambiguous or unsupported | 5 | Contradictions, DPI-only rules, photo+signature in one block |

The last band is the interesting one. The target behaviour there is *not* a
prepared file — it is a clear ambiguity prompt or a manual-check entry. Scoring
those as failures would reward the app for guessing.

## Measures

| Measure | Definition | How it is captured |
| --- | --- | --- |
| Completion time | Instruction input to verified download | Phone stopwatch, warm run |
| Correction steps | Rule edits the user had to make | Counted from the session |
| Exact validity | Output satisfies every confirmed exact rule | Re-verified from downloaded bytes |
| False-ready rate | Export allowed on a file that violates a confirmed rule | Must be zero |
| Unresolved rate | Cases surfaced for user decision rather than answered | Reported, not minimised |

False-ready is the one that matters. Any non-zero value is a release blocker,
because the product's entire claim is that what it says it checked, it checked.

Unresolved cases are deliberately *not* a metric to drive down. Pushing that
number toward zero would mean guessing at constraints the instructions did not
state.

## Comparison arms

Same 20 pairs, same operator, order randomised:

1. **FormReady**
2. **A strong existing preparation tool** — a well-regarded resizer or
   compressor, named in the results table
3. **Manual entry** — a general image editor with the numbers typed by hand

The comparison is honest only if arm 2 is a tool people actually use. Picking a
weak baseline to win against is not evidence.

## Device conditions

Record for every run: device model, OS version, browser and version, thermal
state, whether the run was cold or warm, and whether it was online or offline.

Initial target from the specification: a warm happy path at or under 15 seconds
on bounded fixtures. This is a target to test, not an achieved benchmark, and it
will be replaced by measured numbers before any of it is presented.

## Results

_To be completed after the pilot. Table format:_

| # | Band | Arm | Time | Corrections | Exact valid | Notes |
| --- | --- | --- | --- | --- | --- | --- |

## Known limitations to state alongside any result

- Small sample; single operator; single device family.
- Instruction set is drawn from a limited pool of portals and is not a random
  sample of forms in the wild.
- The extractor was built against a different set of instructions, but the
  authors of the extractor also ran the pilot.
- Image quality is assessed visually, not by any perceptual metric.
