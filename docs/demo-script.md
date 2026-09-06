# Demo script

Three minutes, one phone, one laptop. The point of the demo is the *chain* —
instructions in, checked file out — not any single feature in it.

Everything below runs on the device. Nothing depends on a network call, and the
script should be rehearsed with the phone in aeroplane mode at least once.

## Before you start

- [ ] Phone on the built app, assets already cached (load it once online first)
- [ ] Two source images ready in the photo library: one oversized photo, one
      faint signature
- [ ] One instruction screenshot the app has never seen
- [ ] Laptop mirroring the phone screen
- [ ] Demo upload checker open in a second tab, its banner visible

## Run of show

**0:00 — The problem, in one sentence.**
Show the instruction screenshot as a human sees it: a paragraph of limits in
three different units. Say what the current options are — guess in a photo
editor, or upload and hope.

**0:20 — Requirements.**
Add the screenshot. Let OCR run visibly; do not talk over it. When the rules
appear, point at one and show the highlighted phrase it came from. Change one
operator from *at most* to *less than* and note that this changes which files
pass — this is the "we read your instructions, we did not guess" beat.

**0:50 — The ambiguity.**
Scroll to a requirement the app could not resolve, or a manual check like DPI.
Say plainly: FormReady cannot check this from the file, so it stays your job.
This is the credibility beat. Do not skip it to save time.

**1:10 — Document.**
Pick the oversized photo. Show the original's real size and dimensions. Approve
the crop — if the target shape differs from the source, show that the app makes
you decide rather than stretching the face.

**1:30 — Prepare.**
Let the search run. Point out that the stages are real stage names and there is
no percentage bar, because the search does not know in advance how many attempts
it needs.

**1:50 — Review.**
Toggle original against output. Zoom in once. Walk the checklist: format, bytes,
dimensions — each with the measured value next to the requirement. Then the
separate manual-check list. Tick the visual review box and note that Download
was disabled until you did.

**2:20 — The difficult case.**
Go back, change a rule, and show Download go dark with "The requirements
changed." Re-prepare. This is the invalidation beat and it is the hardest thing
in the build to get right, so show it.

**2:40 — Demo upload checker.**
Drop the original file in: rejected, with reasons. Drop the prepared file in:
accepted. Say the banner out loud — this is a demonstration harness, not a
government portal.

**2:55 — Close.**
One line on what is checked exactly versus what is left to the user. One line on
what comes next.

## Things to say

- "We help you meet the requirements you confirmed, and show what was checked."
- "That is a check on the actual file, not on what we asked the encoder for."
- "This part we cannot verify, so we tell you instead of hiding it."

## Things not to say

- "AI certified", "government approved", "100% accurate", "works with all forms"
- Any claim about NPU execution. WebGPU is GPU processing; that is a different
  statement.
- Any timing figure not measured on the phone being demonstrated.

## If something breaks

- **OCR fails:** paste the instructions instead. The path is designed for this
  and showing it is not a loss.
- **No candidate found:** show the recovery panel and adjust a rule. A designed
  failure with a clear next step is a better demo than a lucky success.
- **App reloads:** state plainly that P0 keeps work in memory only. Do not
  pretend otherwise.
