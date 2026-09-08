# FormReady Autopilot (prototype)

A browser extension that turns any web form into a one-click, on-device
autofill target: it scans the whole form, classifies every field, fills
text/select fields from an encrypted personal-info vault, and prepares +
attaches photos/signatures from a document vault — reusing FormReady's exact
requirement-extraction and image-preparation pipeline (`src/domain`,
`src/features/requirements`, `src/features/preparation`,
`@formready/browser` — same code, not a reimplementation), not just for
file inputs anymore but for the whole form.

**The pitch:** instead of screenshotting instructions into a separate app and
retyping your details into every portal, click one button. It reads the
requirements straight from the page, fills what it's confident about, shows
you a final draft to approve, then writes everything in — Aadhaar, PAN, address, photo, signature,
and format-converted documents alike. Nothing is written into the real form
until you confirm the draft.

## What it does now

- **Whole-form scan**: every text/tel/email/date/select field in a form gets
  classified (`fieldClassifier.ts`), not just file inputs.
- **Encrypted vault, PII and documents alike**: name, Aadhaar, PAN, address,
  city, district, state, pincode — *and* every saved photo and signature —
  AES-256-GCM, key derived from a passphrase via PBKDF2 (`crypto.ts`,
  `profile.ts`, `vault.ts`). Documents are encrypted one record at a time
  under a random document key that the passphrase wraps, so listing a vault
  costs one key derivation rather than one per document, and a document's
  label is inside the ciphertext too. A test scans everything written to
  `chrome.storage.local` for the raw bytes, because encryption applied on
  one code path and skipped on another still passes a round-trip test. The decrypted copy lives only in
  `chrome.storage.session` (RAM, cleared when the browser closes); the
  encrypted copy in `chrome.storage.local` is the only thing that touches
  disk. Never handed to the content script running on the page — only the
  background service worker and the popup ever see it decrypted; the content
  script asks for a document by id and gets one back only after you pick it.
- **No network calls at all**: field identification is DOM-only. A field the
  classifier can't identify is left for you to type yourself. The earlier
  build screenshotted the page and asked a remote model to identify
  ambiguous fields; that was removed, because a product whose promise is
  "nothing leaves your device" cannot have a path that uploads your screen.
- **Format conversion**: if a field only accepts PDF and the vault holds an
  image, it's embedded into a single-page PDF via `pdf-lib` — run in the
  background service worker specifically so a ~1MB library never loads into
  the content script injected on every page you visit.
- **Final draft review**: before anything is written, a shadow-DOM overlay
  lists every planned fill — Aadhaar/PAN masked to a few visible digits —
  with a per-field checkbox and one Confirm & Fill action.
- **React/Vue-safe filling**: writes through the native `value` setter and
  dispatches real `input`/`change` events, so controlled inputs in modern
  framework-built forms actually update (plain `.value = x` silently doesn't
  — verified against a real mounted React component in
  `tests/extensionReactSafeFill.test.tsx`).

## Build

```bash
npm run extension:build       # bundles extension/src/*.ts into extension/dist/*.js
npm run extension:typecheck   # tsc --noEmit against the extension sources
```

Rebuild after any change to `extension/src/` — Chrome loads the bundled
`dist/*.js`, not the TypeScript source.

## Load it in Chrome

1. `npm run extension:build`
2. Open `chrome://extensions`
3. Enable **Developer mode** (top right)
4. **Load unpacked** → select the `extension/` folder
5. Pin the FormReady Autopilot icon to the toolbar

## Try it

1. Click the toolbar icon → **Documents** tab: save a photo and a signature
   (any JPEG/PNG works).
2. **Profile & keys** tab: choose a passphrase to create the vault, then fill
   in whatever personal details you want to test with.
3. Serve the mock portals:
   ```bash
   npm run extension:demo-portals   # http://localhost:4321
   ```
4. Open `full-application-form.html` for the whole-form flow — click
   **"⚡ Fill this form"**, review the draft, confirm. Or open
   `passport-photo-portal.html` / `exam-signature-portal.html` for the
   original single-field **"⚡ Prepare & Attach"** flow. Every mock portal's
   own script confirms exactly what it received (name, size, type), proving
   the injection worked, not just that FormReady thinks it did.

All mock pages are clearly banner-labelled as demo mocks, in keeping with
FormReady's own rule about never implying a claim (like portal acceptance)
that hasn't been checked.

## What's real vs. what's a shortcut, for anyone evaluating this

- **Real**: the extraction, constraint arithmetic, geometry/quality search,
  and encoding are the identical modules the web app ships. The PII
  encryption is real AES-256-GCM, not obfuscation. The React-controlled-input
  fill is verified against an actually-mounted React component, not asserted.
  The PDF conversion produces a real, reloadable PDF (verified by round-
  tripping it through `pdf-lib` in a test).
- **Explicitly out of scope, not silently skipped**: Word/Excel/PPT → PDF
  conversion (no client-side engine can do this correctly). True computer-
  reading of canvas-rendered forms with zero DOM text — with no remote model
  in the loop, a field with no DOM signal is a field you fill yourself.
  Auto-submitting a filled form — this
  never happens, by design.
- **Shortcut for tonight**: the field classifier is a keyword/autocomplete
  heuristic tested against three mock portals, not the full variety of real
  government/exam site markup. Byte convention for image rules is assumed
  decimal.
- **Known sandbox limitation, not a code issue**: this development
  environment's Chrome blocks `--load-extension` from the command line
  (confirmed by asking the "loaded" extension for its own manifest name and
  getting back a Chrome-internal component instead) — so the live
  click-through has to be verified by hand in your own Chrome, the normal
  way, via **Load unpacked**. Everything the code itself can be tested
  without a live extension load — the classifier, the encryption, the
  React-safe fill, the PDF conversion, the PDF-conversion rule — is covered
  by real tests in `tests/extension*.test.ts`.
