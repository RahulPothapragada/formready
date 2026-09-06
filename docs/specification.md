# FormReady
## Product requirements and implementation specification

**Version:** 1.0 · **Date:** 7 September 2026  
**Status:** Approved concept; proposed requirements, not implemented functionality  
**Track:** Productivity · **Platform:** React mobile web app / PWA  
**Audience:** Product owner, developer, designer, tester, and hackathon reviewer  
**Delivery budget:** 40 hours including presentation and video, subject to the event's actual authorized build window

This is the build specification for FormReady. It consolidates the selected concept from the earlier research. The research report remains the source for competitors and market assumptions; this document defines what to build and how to decide whether it works.

---

## 1. Project identity

**Name:** FormReady  
**Tagline:** Show the requirements. Get your document ready.  
**One-line description:** A phone-based assistant that reads upload instructions, helps prepare a document, and checks the resulting file before export.

### Problem statement

People completing online applications are often asked to upload documents in specific formats, file-size ranges, and image dimensions. Interpreting these requirements and repeatedly editing files creates unnecessary work. A file may meet the size limit yet become unreadable, cropped incorrectly, or associated with the wrong upload field.

FormReady helps the user translate the instructions in front of them into explicit checks, prepare the selected file, and review the result before submission.

### Proposed solution

Import instructions → extract and confirm requirements → select a document → prepare a candidate → independently verify the actual file → review and export.

### Product promise

“We help you meet the requirements you confirmed, and show what was checked.”

Successful file preparation is different from application approval or acceptance by a portal with additional rules. The interface must keep that distinction clear.

### Differentiation to demonstrate

The proposed advantage is the connected workflow: reading the actual instructions, linking extracted requirements to evidence, preparing the document, and verifying the output. Resizing, compression, and scanning already exist in competing products. The prototype should demonstrate the whole workflow on unfamiliar instructions rather than claiming to invent those individual features.

## 2. Users and jobs to be done

| User | Situation | Desired outcome | MVP priority |
|---|---|---|---|
| Applicant | Completing a form on a phone | Prepare an upload without understanding editing tools | Primary |
| Family helper | Helping someone prepare a document | See the instructions, original, and result clearly | Primary workflow, same interface |
| Document-service operator | Preparing many applications | Reduce repeated setup and rework | Future commercial user |
| Application-platform operator | Supporting uploads | Reduce avoidable file errors | Future integration buyer |

**Primary user story:** “As an applicant, I want to show the app my upload instructions and document so I can obtain a correctly checked file without guessing which editing settings to use.”

## 3. Scope and priorities

**P0 = release requirement. P1 = implement only after every P0 flow passes. P2 = later product.**

| Capability | Priority | Exact scope |
|---|---|---|
| Instruction input | P0 | One JPEG/PNG screenshot or pasted English text |
| Local OCR | P0 | Extract printed instruction text on the phone; allow corrections |
| Requirement extraction | P0 | Propose supported rules with source text; user confirmation required |
| Rule editor | P0 | Format, byte-size bounds, width/height constraints, document kind |
| Document input | P0 | One JPEG/PNG file per job; image picker and available camera capture |
| Preparation | P0 | Rotation, approved crop, resizing, and JPEG/PNG encoding |
| Verification | P0 | Actual decoded format, byte count, and pixel dimensions |
| Visual review | P0 | Before/after preview with zoom and mandatory user review |
| Export | P0 | Download; retain original until the job is cleared |
| Failure recovery | P0 | Actionable errors, edit/retry, cancellation, stale-result protection |
| Offline core | P0 | Cached shell/OCR, confirmed-rule preparation and export |
| Source highlights | P0 | Highlight supporting text; image overlays are optional |
| Browser LLM | P1 | One small compatible model, only if device feasibility is established |
| Shared-file export | P1 | Web Share when supported; download remains available |
| Automated quality warnings | P1 | Tested blur/text-loss heuristics, presented as estimates |
| Project persistence | P1 | Explicit save to IndexedDB; restore after reload |
| Hindi guidance | P1 | Reviewed UI/explanations; no untested language claims |
| PDF preparation | P2 | Separate page, encryption, signature, and export specification |
| Batch packs/accounts/payments | P2 | After user and business validation |
| Native NPU/system integration | P2 | Separate iQOO/Android engineering project |

**Release languages:** English. **Release document kinds:** photograph, signature, or printed-document image. **Proposed input guardrails:** maximum 10 MiB and 20 megapixels per image, checked before expensive processing. Validate these limits on the target phone and revise downward if needed; display them in the picker.

Exclude automatic portal submission, identity verification, editing identity details, signature generation, password-protected files, live government integrations, and claims of guaranteed acceptance.

## 4. Core journey and screen structure

### Screen 1 — Requirements

**Purpose:** Establish the instructions for the selected upload field.

Elements: “Add instruction screenshot”, “Paste instructions”, document-kind selector, editable OCR text, extracted requirements, highlighted supporting text, and a persistent “Confirm requirements” action.

Each rule displays its value and whether it was extracted or entered manually. Incomplete ranges, unrecognized units, contradictory values, or uncertain association with photo/signature are shown beside the relevant field.

**Exit condition:** The user confirms a coherent rule set. Ambiguous supported rules are resolved. Instructions outside the supported checks appear in a separate manual-review list. No hidden default is presented as a portal requirement.

### Screen 2 — Document

**Purpose:** Choose the correct source and frame it appropriately.

Elements: file picker/camera action, original preview, file size and dimensions, rotate control, crop editor, and “Prepare file”. Show the confirmed target requirements in a collapsible panel.

**Exit condition:** A supported image decodes successfully and the user approves the crop/rotation. Preserve the full original. Require a crop decision if exact width/height would otherwise distort the source aspect ratio; never silently stretch a face or signature.

### Screen 3 — Prepare

**Purpose:** Produce a candidate file with understandable progress.

Display actual processing stages: preparing image, trying permitted encodings, checking the candidate. Offer Cancel. Do not display invented percentages or simulated inference timings.

**Exit conditions:** A valid candidate moves to review. No suitable candidate moves to a repair state with “Adjust crop”, “Review requirements”, or “Choose clearer image”, as applicable. Cancellation keeps the original and confirmed rules.

### Screen 4 — Review and export

**Purpose:** Make the result inspectable before it leaves the app.

Elements: original/output toggle, zoom, result metadata, requirement checklist, manual-review items, filename, “Download file”, and supported “Share file”.

Example exact checks:

- Format: JPEG — matches confirmed requirement.
- Size: 43,612 bytes — within the confirmed interval.
- Dimensions: 200 × 230 pixels — matches confirmed requirement.

Separately ask: “I checked that the document is readable and nothing important is missing.” This is a user review, not an automated finding.

**Export condition:** All applicable exact checks pass, the candidate belongs to the current job revision, and visual/manual review is complete.

After export: “Your file is ready to upload. Return to the form and select it.” Provide “Prepare another file”; clearing the job requires an explicit action.

### Screen 5 — Demo portal, outside the product journey

A clearly labeled **Demo upload checker** accepts a fixture file and checks known size/format/dimension rules. It demonstrates the before/after change. Its constraints must match the demo instructions. It must not look like or claim to be a real government portal.

## 5. Functional requirements and acceptance criteria

| ID | Requirement | Acceptance criterion |
|---|---|---|
| FR-01 | Import instruction screenshot or text | Valid input appears in a reviewable source panel; malformed input produces a recoverable error |
| FR-02 | Run OCR locally | Printed text from the supported fixture set is extracted in a worker; editable text remains available if OCR fails |
| FR-03 | Extract supported constraints | Every proposed rule includes a source span or a manual-entry label; no missing numeric limit is fabricated |
| FR-04 | Associate rules with the correct field | Photo and signature requirements in the same text remain distinct; uncertainty prompts selection |
| FR-05 | Confirm requirements | User can change values, units, inclusivity, and document kind; conflicts block confirmation |
| FR-06 | Decode and inspect source file | Actual format, visual orientation, byte count, and dimensions are read; extension alone is not trusted |
| FR-07 | Preserve original and approve geometry | Original remains untouched; crop/rotation is previewed; no silent aspect-ratio distortion |
| FR-08 | Search candidate encodings | Search obeys confirmed geometry and stays within a fixed attempt/time budget; failure is explicit |
| FR-09 | Independently verify output | Verifier reads the candidate bytes and decoded image, not the requested encoder parameters |
| FR-10 | Separate exact and estimated checks | Size/format/pixels are exact results; readability/identity/background judgments are not labeled mathematically verified |
| FR-11 | Invalidate stale results | Changing source, crop, or rules disables prior validation and export until a new candidate is checked |
| FR-12 | Require visual review | User can inspect the full output; export waits for the review acknowledgment |
| FR-13 | Export a usable file | Downloaded output opens in another viewer; extension matches decoded format; exact checks still pass after export |
| FR-14 | Recover from errors/cancellation | No original is overwritten; user can retry or edit without restarting unrelated steps |
| FR-15 | Demonstrate offline core | After assets are cached, OCR plus manually confirmed rules, preparation, verification, and download work without network access |

## 6. Requirement semantics

### Supported exact constraints

- Allowed formats: JPEG and/or PNG.
- File size: lower bound, upper bound, or both; each bound preserves `<`, `≤`, `>`, or `≥` meaning.
- Pixel dimensions: exact/minimum/maximum width and height, where explicitly given and coherent.
- Document-kind association: photo, signature, printed image, or user-selected other image.

Physical dimensions, DPI, photo recency, background suitability, identity, visible ears, stamps, handwriting authenticity, and legal eligibility remain manual-review requirements in v1. Do not silently convert them into a generic “all requirements passed”.

### Units and missing information

Preserve the source spelling of KB/MB. Store the confirmed byte convention explicitly. Where ambiguous, show the assumed convention in the editor and require confirmation; do not make the user repeatedly resolve it once confirmed for the job. Exact comparisons operate on integer bytes.

Distinguish **not specified**, **unresolved**, and **confirmed**. An absent width constraint is not a zero-pixel target. An unreadable width constraint is unresolved. For example, “Under 50 KB” is an exclusive upper bound, while “Up to 50 KB” is inclusive.

If no actionable exact constraint was supplied, ask the user to add or confirm a preparation target. A manual target must be labeled as the user's selection rather than extracted evidence.

## 7. Processing algorithm

1. Validate the rule set and capture an immutable snapshot of job ID and revision.
2. Decode the source, normalize orientation, and retain the original bytes.
3. Apply only the user's approved crop/rotation to a derived image.
4. Calculate geometry permitted by the confirmed rules. Never introduce an unapproved crop or arbitrary upscaling to imply restored detail.
5. Generate a bounded set of candidate encodings. Proposed initial cap: 24 attempts or 12 seconds of candidate work, whichever occurs first. These are engineering starting points to measure on the phone, not achieved timings.
6. For JPEG, vary codec quality and permitted dimensions. For PNG, do not assume the Canvas quality parameter controls file size; use permitted geometry changes or report no suitable candidate.
7. Decode candidates and check actual format, bytes, and dimensions. Treat minimum sizes as real constraints too; adding unrelated bytes is not a quality-preserving solution.
8. Among compliant candidates, prefer greater retained resolution and then higher encoding quality within the same codec. This is a heuristic, not a universal perceptual-quality score.
9. Return the candidate and report only if the job revision still matches. Discard late results from cancelled or outdated jobs.
10. Require final visual review before export.

A failure means “No suitable output found within this search”, not proof that no mathematically possible file exists. Reuse the current job so the user can adjust a rule or capture.

## 8. Application architecture

```text
Instruction image/text
        │
        ▼
OCR worker → rule extraction → schema validation → user confirmation
                                                       │
Document picker/camera → orientation/crop approval ─────┤
                                                       ▼
                                              candidate preparation
                                                       │
                                                       ▼
                                              independent verifier
                                                       │
                                                       ▼
                                               visual review/export
```

**Proposed stack:** React, TypeScript, Vite, Tesseract.js, schema validation, browser image APIs, and Web Workers. Use app state in memory for P0. Add IndexedDB only for explicit project saving after the core is stable.

**Required AI path:** local OCR plus source-linked extraction of supported rule patterns. **Optional AI enhancement:** one text model interpreting varied phrasing. Model output proposes data; it never defines what passes validation or executes transformations directly.

A browser model is P1 and must pass the first two-hour device test. If it cannot run reliably, use the local OCR/rule path. Backend interpretation is a separately disclosed option for instruction text only; document preparation stays local. The product must accurately describe its actual capabilities.

Model/provider names and package versions are pinned after the feasibility check. WebGPU is GPU processing, not proof of Snapdragon NPU execution.

### Proposed repository layout

This is a planned structure; these application files have not been created.

```text
formready/
├── public/
│   ├── icons/
│   └── models/                   # locally served/cached OCR assets
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   └── jobReducer.ts
│   ├── features/
│   │   ├── requirements/
│   │   │   ├── RequirementsPage.tsx
│   │   │   ├── RequirementEditor.tsx
│   │   │   ├── SourceEvidence.tsx
│   │   │   └── extractRules.ts
│   │   ├── capture/
│   │   │   ├── DocumentPage.tsx
│   │   │   └── CropEditor.tsx
│   │   ├── preparation/
│   │   │   ├── PreparePage.tsx
│   │   │   └── generateCandidates.ts
│   │   ├── review/
│   │   │   ├── ReviewPage.tsx
│   │   │   └── ValidationChecklist.tsx
│   │   └── demo/
│   │       └── DemoPortalPage.tsx
│   ├── services/
│   │   ├── ocr.ts
│   │   ├── imageCodec.ts
│   │   ├── verifier.ts
│   │   ├── exportFile.ts
│   │   └── modelParser.ts         # optional adapter
│   ├── workers/
│   │   ├── ocr.worker.ts
│   │   └── preparation.worker.ts
│   ├── domain/
│   │   ├── types.ts
│   │   ├── schemas.ts
│   │   └── constraints.ts
│   ├── components/
│   │   ├── StepProgress.tsx
│   │   ├── FilePicker.tsx
│   │   ├── ImagePreview.tsx
│   │   └── RecoveryPanel.tsx
│   └── styles/
├── tests/
│   ├── ruleExtraction.test.ts
│   ├── verifier.test.ts
│   ├── jobRevision.test.ts
│   └── fixtures/                 # synthetic images and labeled instructions
├── docs/
│   ├── demo-script.md
│   └── evaluation.md
└── README.md
```

## 9. Data contracts

| Entity | Required fields | Important behavior |
|---|---|---|
| Job | id, revision, status, document kind | Revision increases when source, crop, or confirmed rules change |
| InstructionSource | id, type, original text, edited text | Preserve original text; corrections remain distinguishable |
| Rule | id, field, operator, value, unit, source span, origin, review state | Origin is extracted or manual; unknown values are not defaults |
| ConfirmedRequirements | rules, byte convention, manual checks, confirmation timestamp | Immutable snapshot for each preparation run |
| SourceDocument | id, Blob, filename, decoded format, width, height, orientation | Original is immutable and local |
| TransformPlan | crop rectangle, rotation, target geometry, codec settings | Bound to source ID and job revision |
| Candidate | id, Blob, source ID, job revision, actual metadata | Cannot reuse checks from another candidate |
| ValidationReport | candidate ID, job revision, per-rule results, warnings | Exact outcomes: pass, fail, not-applicable, unresolved |
| UserReview | candidate ID, job revision, completed manual checks | Invalidated when the candidate or requirements change |

OCR confidence, if provided, belongs to OCR metadata. It must not be reused as a probability of portal acceptance or file correctness.

### Service contracts

| Service | Input | Output |
|---|---|---|
| OCR | Supported instruction image + cancellation signal | Text, available word/block locations, operational error |
| Extract rules | Reviewed text + selected field/document kind | Proposed rules, source spans, ambiguity list |
| Prepare | Source + approved transform + confirmed rules + job revision | Candidate or recoverable failure |
| Verify | Candidate bytes + immutable confirmed rules | Per-rule checks based on decoded output |
| Export | Current verified candidate + current user review | Browser download/share result |

No production backend is required for P0. If an optional parser endpoint is added, accept instruction text and document-kind context, return only validated proposals/ambiguities, and keep secrets server-side. Never accept model-generated code as a processing plan.

## 10. Job state and invalidation

```text
EMPTY → INSTRUCTIONS_ADDED → RULES_REVIEW → RULES_CONFIRMED
                                              │
                                              ▼
                              DOCUMENT_READY → PREPARING
                                              │
                          ┌───────────────────┴───────────────────┐
                          ▼                                       ▼
                      NEEDS_FIX                          OUTPUT_REVIEW
                          │                                       │
                     edit/retry                           user confirms
                                                                  │
                                                                  ▼
                                                            EXPORT_READY
                                                                  │
                                                                  ▼
                                                               EXPORTED
```

Changing instructions or rules returns to RULES_REVIEW and invalidates the candidate. Changing the document or crop retains confirmed rules but invalidates processing, checks, and review. A cancelled run returns to a recoverable input state. Export completion must not clear the job automatically.

## 11. Nonfunctional requirements

| ID | Requirement | Release verification |
|---|---|---|
| NFR-01 | Phone usability | All four screens usable at 360 CSS-pixel width with no horizontal scrolling |
| NFR-02 | Accessible controls | Labeled controls, visible focus, approximately 44-pixel touch targets, readable text, errors explained beyond color |
| NFR-03 | Responsiveness | Heavy OCR/preparation off the main UI path; progress and Cancel remain operable |
| NFR-04 | Local document handling | No document bytes in network requests, analytics, or crash logs during the local workflow |
| NFR-05 | Resource limits | Enforce input limits; release workers, image bitmaps, and object URLs after use |
| NFR-06 | Offline accuracy of claims | Test the declared offline path after all assets are cached; distinguish first download from later operation |
| NFR-07 | Transparent errors | Unsupported format, OCR failure, no candidate, and export failure have distinct recovery messages |
| NFR-08 | Measured performance | Report cold setup and warm processing separately on the actual device; initial target: a ≤15-second warm happy path on bounded fixtures |
| NFR-09 | Output integrity | Re-imported export has the same bytes/metadata as the verified candidate |

Performance values are proposed targets, not achieved benchmarks. P0 retains files only for the active session. State plainly that closing/reloading can lose unsaved work. P1 persistence should use an explicit save action and include Delete; do not promise recovery after browser storage is cleared.

## 12. Error handling and product language

| Situation | Message/action |
|---|---|
| Conflicting requirements | “These instructions contain different limits. Choose the one for this upload.” |
| Unsupported instruction | “This condition needs your review.” Show the original phrase |
| No candidate fits | “We couldn't find a suitable file with these settings.” Offer crop/rule/source changes |
| Poor source | “Some details are difficult to read. Try a clearer photo.” |
| Camera unavailable | “Choose an image from your phone.” Keep the picker available |
| OCR failed | “Paste the instructions or enter the file requirements.” |
| Stale candidate | “The requirements changed. Prepare the file again.” |
| Exact checks passed | “Meets the confirmed file checks.” |
| Export failed | “The file is still here. Try downloading again.” |

Avoid unsupported assertions such as “AI certified”, “government approved”, “100% accurate”, or “works with all forms”.

## 13. Test plan and definition of done

### Deterministic tests

Test byte boundaries at min/max ±1, inclusive/exclusive operators, missing constraints, decoded format versus extension, exact/min/max dimensions, contradictory rules, and stale-result invalidation. Verify that rule changes after processing disable export. Test PNG/JPEG behavior separately.

### Image/browser tests

Use synthetic fixtures for rotated metadata, cropped edges, faint signatures, noisy printed text, already-small images, oversized sources, corrupt files, unavailable camera, cancelled jobs, and failed downloads. Add cached offline, memory pressure, and app-reload checks on the actual phone.

### Pilot evaluation

Use 20 held-out instruction/document pairs, including five ambiguous or unsupported cases. Publish each outcome. Compare a subset with a strong existing preparation tool and manual entry. Measure completion time, correction steps, exact validity, false-ready errors, and unresolved cases. Quality claims require visual assessment; the earlier metadata simulations are not image-model evaluation.

### Release acceptance

- Every P0 requirement has a demonstrated passing acceptance case.
- At least three unseen fully specified cases complete on the phone.
- Conflicting instructions and unreadable-source examples have sensible recovery paths.
- No tested invalid exact-check result enables verified export.
- User can inspect and export a file that opens outside the app.
- Original remains unchanged; job revisions prevent stale export.
- Offline claims match the actual cached test.
- Runtime/library attribution and known limitations are documented.
- Demo, slides, video, and submission package are complete.

## 14. Implementation backlog and 40-hour allocation

| Order | Hours | Work package | Completion evidence |
|---|---|---|---|
| 1 | 0–2 | Device feasibility and scope freeze | Phone input/OCR/export proven; optional model decision made |
| 2 | 2–6 | App shell, state, input, review skeleton | One job can traverse all views |
| 3 | 6–10 | OCR, source-linked rules, editor | Instructions become confirmed typed constraints |
| 4 | 10–16 | Geometry, candidate encodings, verifier | Real exported image passes byte/format/dimension tests |
| 5 | 16–20 | Preview, manual review, download, invalidation | User edits cannot export stale results |
| 6 | 20–24 | Errors, offline assets, resource handling | Supported failures recover cleanly |
| 7 | 24–28 | Held-out examples, phone testing | Small results table with successes and failures |
| 8 | 28–30 | Office Kit workflow and demonstration | Actual phone-to-laptop handoff |
| 9 | 30–33 | Presentation | Seven-slide deck with verified results |
| 10 | 33–35 | Video | Approximately three-minute demonstrative recording |
| 11 | 35–38 | Breaks, contingency, fixes | Reliable packaged build |
| 12 | 38–40 | Submission and rehearsal | All required links/assets verified |

**Cut order:** optional LLM → automatic quality estimates → share integration → persistence → extra language. P0 OCR, rule confirmation, preparation, verification, review, and download remain intact.

If only the on-site City Battle's shorter pure-build window is available, use the reduced allocation in the existing build/research plan. Do not assume the personal 40-hour budget overrides event rules.

## 15. Presentation structure

| Slide | Heading | Required material |
|---|---|---|
| 1 | Why does the form reject my file? | Human problem and one familiar error |
| 2 | The work hidden inside an upload | Current preparation steps and a dated official example |
| 3 | Meet FormReady | Four-step workflow |
| 4 | From instructions to a checked file | Live phone demonstration and one difficult case |
| 5 | What the phone actually runs | OCR/local processing, optional model location, Office Kit |
| 6 | Evidence and opportunity | Pilot results, closest competitor, repeat buyer hypothesis |
| 7 | What comes next | Research question and proposed iQOO integration |

**Research question:** Does grounded requirement extraction with independent verification reduce invalid exports and preparation effort relative to manual tools, preset resizers, and model-only assistants?

**Business hypothesis:** Basic applicant workflow can be bundled/free; repeat operators or platforms may pay for batch preparation or integration after measured savings. Revenue and adoption are not established.

## 16. Handoff prompt for implementation

> Build FormReady using this specification. Use React, TypeScript, and Vite. Implement P0 features first: local OCR of instruction screenshots, pasted text, evidence-linked editable requirements, one JPEG/PNG document, approved crop/rotation, constrained image preparation, independent output verification, final visual review, and download. Preserve the original and invalidate output on job changes. Keep PDFs, accounts, batch mode, and native system integration out of v1. Run the actual phone feasibility checks before adding a browser language model. Use synthetic fixtures, record real test outcomes, and label any demo portal clearly. Finish the supported workflow and document limitations before adding optional features.

## 17. References and related deliverables

- [Existing research report](/Users/rahulpothapragada/Documents/Codex/2026-09-07/fintech-and-commerce-fintech-and-commerce/outputs/iqoo-opportunity-research.md): competitor and business context.
- [Build/research plan](/Users/rahulpothapragada/Documents/Codex/2026-09-07/fintech-and-commerce-fintech-and-commerce/outputs/formready-build-and-research-plan.md): detailed experiment and reduced event schedule.
- [Scenario lab](/Users/rahulpothapragada/Documents/Codex/2026-09-07/fintech-and-commerce-fintech-and-commerce/outputs/scenario-lab.md): failure cases and limits of previous simulations.
- [Source library](/Users/rahulpothapragada/Documents/Codex/2026-09-07/fintech-and-commerce-fintech-and-commerce/outputs/source-library.md): papers, whitepapers, and primary evidence.
- [Tesseract.js](https://github.com/naptha/tesseract.js): browser OCR.
- [WebLLM setup](https://webllm.mlc.ai/docs/user/get_started.html): optional browser-model feasibility.
- [iQOO official guide](https://iqoo.reskilll.com/guide): event requirements, to recheck against the participant dashboard.
