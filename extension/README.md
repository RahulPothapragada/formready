# FormReady Autopilot (prototype)

A browser extension that reuses FormReady's exact requirement-extraction and
image-preparation pipeline (`src/domain`, `src/features/requirements`,
`src/features/preparation`, `src/services/imageCodec` — same code, not a
reimplementation) and applies it directly to file inputs on any web page.

**The pitch:** instead of screenshotting a form's instructions and pasting
them into a separate app, this reads the instruction text already sitting
next to the upload field, prepares a saved photo or signature to match it,
and attaches the result straight into that field. Nothing leaves the device —
the vault is `chrome.storage.local`, scoped to this browser profile only.

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

1. Click the toolbar icon, save a photo and a signature to the vault (any
   JPEG/PNG on your machine works — they never leave the browser).
2. Serve the two mock portals:
   ```bash
   npm run extension:demo-portals   # http://localhost:4321
   ```
3. Open `http://localhost:4321/passport-photo-portal.html` or
   `exam-signature-portal.html`. A **"⚡ Prepare & Attach"** button appears
   next to each file field. Click it — it reads the instruction paragraph
   right there on the page, runs the real `extractRules` → `searchCandidates`
   pipeline against your saved vault photo, and injects the compliant file
   into the input. The mock portal's own script confirms the file it
   actually received (name, size, type), proving the injection worked, not
   just that FormReady thinks it did.

Both mock pages are clearly banner-labelled as demo mocks, in keeping with
FormReady's own rule about never implying a claim (like portal acceptance)
that hasn't been checked.

## What's real vs. what's a shortcut, for anyone evaluating this

- **Real**: the extraction, constraint arithmetic, geometry/quality search,
  and encoding are the identical modules the web app ships. A rule extracted
  here would extract the same way in the app's Requirements screen.
- **Shortcut for tonight**: rules are auto-confirmed instead of shown to the
  user for review first (the app's own philosophy is "nothing confirmed
  automatically" — a real ship would keep the review step, just inline and
  fast, not skip it). Byte convention is assumed decimal. The DOM-text
  scraper is a generic nearby-text heuristic tested against two mock portals,
  not the huge variety of real government/exam site markup — that's real
  engineering work, not a fundamental blocker.
