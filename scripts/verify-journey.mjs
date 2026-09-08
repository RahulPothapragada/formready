#!/usr/bin/env node
/**
 * Drives the complete user journey in a real browser: instructions in, checked
 * file downloaded.
 *
 * Every screen and every service underneath was verified separately before this
 * existed, but the seam between them was not — nobody had ever picked a file,
 * confirmed a rule, and downloaded a result. That is where the bugs were.
 *
 * Run it against the dev server too (`--dev`). React double-invokes effects in
 * development, and the Prepare screen has to survive that; a production-only
 * run would not catch it.
 *
 * Usage:
 *   npm run verify:journey          # production build via vite preview
 *   npm run verify:journey:dev      # vite dev, with React Strict Mode active
 */

import { spawn } from 'node:child_process';
import { access, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEV = process.argv.includes('--dev');
const PORT = DEV ? 5199 : 4173;
const CDP_PORT = 9223;
const BASE = `http://localhost:${PORT}`;

const INSTRUCTIONS =
  'Photograph must be in JPEG format. File size under 50 KB. White background required.';

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

// Vite lives in the web package now, so the dev and preview servers are
// started from there rather than from the repository root.
const WEB_PACKAGE = new URL('../packages/web/', import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {
      /* next */
    }
  }
  throw new Error('No Chrome found. Set CHROME=/path/to/chrome.');
}

// --- a source document to upload ------------------------------------------

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A 1200x1500 portrait with structure, so JPEG has something real to compress. */
function makeSourcePng() {
  const width = 1200;
  const height = 1500;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      // Soft vertical gradient with an oval "subject" — compresses like a photo
      // rather than like noise, which is what a real upload looks like.
      const dx = (x - width / 2) / (width * 0.32);
      const dy = (y - height * 0.42) / (height * 0.3);
      const inside = dx * dx + dy * dy < 1;
      const shade = Math.round(210 - (y / height) * 60);
      const at = rowStart + 1 + x * 3;
      raw[at] = inside ? 196 : shade;
      raw[at + 1] = inside ? 160 : shade + 6;
      raw[at + 2] = inside ? 138 : shade + 18;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- CDP -------------------------------------------------------------------

async function attach(url) {
  const tab = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
    })
  ).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let nextId = 1;
  const pending = new Map();
  const errors = [];

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(
        message.params.exceptionDetails.exception?.description?.split('\n')[0] ?? 'exception',
      );
    }
  };

  // Resolves with the command's `result` payload, not the whole envelope.
  const send = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, (message) => resolve(message.result ?? {}));
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? 'eval failed');
    }
    return response.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  return { send, evaluate, errors, close: () => ws.close() };
}

async function waitFor(page, expression, label, timeoutMs = 90000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await page.evaluate(expression)) return;
    await sleep(250);
  }
  const heading = await page.evaluate(`document.querySelector('h2')?.innerText ?? '(none)'`);
  throw new Error(`Timed out waiting for ${label}. Current screen: "${heading}"`);
}

/**
 * Sets a React-controlled field. Assigning `.value` directly does not notify
 * React, so the native setter is used and an input event dispatched.
 */
const setControlled = (selector, value) => `
(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

const clickByText = (text) => `
(() => {
  const target = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}) && !b.disabled);
  if (!target) return false;
  target.click();
  return true;
})()`;

// --- the journey -----------------------------------------------------------

const steps = [];
function record(name, detail = '') {
  steps.push({ name, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function runJourney(page, downloadDir) {
  await waitFor(page, `!!document.querySelector('.requirements-page')`, 'the requirements screen');
  record('Requirements screen loaded');

  await page.evaluate(setControlled('textarea', INSTRUCTIONS));
  await sleep(600);

  const proposed = await page.evaluate(`document.querySelectorAll('.requirement').length`);
  if (proposed === 0) throw new Error('No requirements were extracted from the instructions.');
  record(`Extracted ${proposed} requirements from typed instructions`);

  const manualChecks = await page.evaluate(
    `document.querySelectorAll('.manual-checks li').length`,
  );
  record(`Kept ${manualChecks} instruction(s) as manual checks`, '"white background"');

  // Tick every proposed rule, then confirm.
  await page.evaluate(`
    document.querySelectorAll('.confirm-toggle input').forEach((box) => { if (!box.checked) box.click(); });
    true`);
  await sleep(400);

  if (!(await page.evaluate(clickByText('Confirm requirements')))) {
    throw new Error('The Confirm requirements button was absent or disabled.');
  }
  await waitFor(page, `!!document.querySelector('.document-page')`, 'the document screen');
  record('Confirmed requirements');

  // Upload the source document into the first file input.
  const { root } = await page.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await page.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: 'input[type=file]',
  });
  if (!nodeId) throw new Error('No file input on the document screen.');
  await page.send('DOM.setFileInputFiles', { nodeId, files: [join(downloadDir, 'source.png')] });

  await waitFor(page, `!!document.querySelector('.crop-editor')`, 'the crop editor');
  const sourceInfo = await page.evaluate(
    `[...document.querySelectorAll('.metadata dd')].map((d) => d.innerText).join(' · ')`,
  );

  // The source dimensions must survive being read off the decoded bitmap.
  // Reading them after close() silently yields 0x0, which the pipeline tolerates
  // but the crop editor does not.
  const dimensions = await page.evaluate(`
    (() => {
      const dd = [...document.querySelectorAll('.metadata dd')].map((d) => d.innerText);
      const match = (dd.find((t) => t.includes('pixels')) ?? '').match(/(\\d+)\\s*×\\s*(\\d+)/);
      return match ? { width: +match[1], height: +match[2] } : null;
    })()`);
  if (!dimensions || dimensions.width === 0 || dimensions.height === 0) {
    throw new Error(`Source decoded to a zero-sized image: ${sourceInfo}`);
  }
  record('Source document decoded', sourceInfo);

  // Exercise the crop path, not just "use the whole image": the crop rectangle
  // is derived from the source dimensions, so it is where a bad decode shows up.
  const cropDefaults = await page.evaluate(`
    [...document.querySelectorAll('.crop-fields input')].map((i) => Number(i.value))`);
  if (cropDefaults.some((n) => !Number.isFinite(n)) || cropDefaults[2] === 0 || cropDefaults[3] === 0) {
    throw new Error(`Crop editor opened with an unusable rectangle: ${cropDefaults.join(', ')}`);
  }
  record('Crop editor seeded from real dimensions', cropDefaults.join(', '));

  // With no dimension rules the frame starts as the whole image, which is
  // correctly pinned — shrink it through the accessible numeric path first, so
  // there is somewhere for a drag to go.
  await page.evaluate(`document.querySelector('.crop-precise').open = true; true`);
  await page.evaluate(setControlled('.crop-fields label:nth-child(3) input', '600'));
  await sleep(200);
  const shrunk = await page.evaluate(`
    [...document.querySelectorAll('.crop-fields input')].map((i) => Number(i.value))`);
  if (shrunk[2] >= 1200) throw new Error(`Numeric width entry did not resize the frame: ${shrunk}`);
  record('Frame resized through the numeric fallback', shrunk.join(', '));

  const frame = await page.evaluate(`
    (() => {
      const el = document.querySelector('.crop-frame');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
  if (!frame) throw new Error('The crop frame did not render.');

  const before = await page.evaluate(`document.querySelector('.crop-readout').innerText`);
  // Real pointer events of type "touch". The frame sits at the origin and
  // spans the full height, so the only direction it can travel is right.
  await page.evaluate(`
    (() => {
      const frame = document.querySelector('.crop-frame');
      const at = (type, x, y) => frame.dispatchEvent(new PointerEvent(type, {
        pointerId: 1, pointerType: 'touch', isPrimary: true,
        bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: type === 'pointerup' ? 0 : 1,
      }));
      at('pointerdown', ${frame.x}, ${frame.y});
      at('pointermove', ${frame.x + 30}, ${frame.y});
      at('pointermove', ${frame.x + 60}, ${frame.y});
      at('pointerup', ${frame.x + 60}, ${frame.y});
      return true;
    })()`);
  await sleep(300);

  const moved = await page.evaluate(`
    [...document.querySelectorAll('.crop-fields input')].map((i) => Number(i.value))`);
  if (moved[0] === 0) {
    throw new Error(`Dragging the crop frame did not move it: ${moved.join(', ')}`);
  }
  if (moved[2] !== shrunk[2] || moved[3] !== shrunk[3]) {
    throw new Error('Dragging the frame changed its size as well as its position.');
  }
  record('Crop frame responds to dragging', `moved to x=${moved[0]} · ${before.trim()}`);

  // "Use this crop", not the whole image: this is what proves the worker plans
  // output geometry from the cropped region rather than the full picture.
  if (!(await page.evaluate(clickByText('Use this crop')))) {
    throw new Error('Could not approve the framing.');
  }
  record('Approved the cropped region');

  // Reload before preparing. Persistence is worth nothing unless the work
  // survives the thing it exists to survive.
  await sleep(700); // let the debounced save land
  await page.send('Page.navigate', { url: `${BASE}/document` });
  await sleep(2500);

  await waitFor(page, `!!document.querySelector('.document-page')`, 'the document screen after reload');
  const survived = await page.evaluate(`
    (() => {
      const dd = [...document.querySelectorAll('.metadata dd')].map((d) => d.innerText);
      return {
        rules: document.querySelectorAll('.target-summary li').length,
        dimensions: dd.find((t) => t.includes('pixels')) ?? '',
        saved: document.querySelector('.saved-indicator')?.innerText ?? '',
      };
    })()`);

  if (survived.rules === 0) throw new Error('Confirmed requirements did not survive the reload.');
  if (!survived.dimensions.includes('1200')) {
    throw new Error(`The document did not survive the reload: ${JSON.stringify(survived)}`);
  }
  if (!/saved/i.test(survived.saved)) {
    throw new Error(`No saved indicator after reload: ${survived.saved}`);
  }
  record('Work survived a reload', `${survived.rules} rules · ${survived.dimensions}`);

  // Re-approve the same crop on the restored job and carry on.
  await page.evaluate(`document.querySelector('.crop-precise').open = true; true`);
  await page.evaluate(setControlled('.crop-fields label:nth-child(3) input', String(moved[2])));
  await sleep(200);
  const restoredCrop = await page.evaluate(`
    [...document.querySelectorAll('.crop-fields input')].map((i) => Number(i.value))`);
  if (!(await page.evaluate(clickByText('Use this crop')))) {
    throw new Error('Could not approve framing after the reload.');
  }
  moved[2] = restoredCrop[2];
  moved[3] = restoredCrop[3];

  // Preparation runs in the worker; the app navigates to review on success.
  await waitFor(
    page,
    `!!document.querySelector('.review-page') || !!document.querySelector('.recovery-panel')`,
    'preparation to finish',
    120000,
  );

  if (await page.evaluate(`!!document.querySelector('.recovery-panel')`)) {
    const message = await page.evaluate(`document.querySelector('.recovery-panel p').innerText`);
    throw new Error(`Preparation failed: ${message}`);
  }
  record('Preparation produced a candidate');

  const checks = await page.evaluate(`
    [...document.querySelectorAll('.checklist.exact li')].map((li) => ({
      cls: li.className,
      text: li.innerText.replace(/\\n/g, ' | '),
    }))`);
  const failed = checks.filter((c) => c.cls.includes('fail'));
  if (failed.length > 0) {
    throw new Error(`Exact checks failed: ${failed.map((f) => f.text).join(' / ')}`);
  }
  for (const check of checks) console.log(`      ${check.text}`);
  record(`All ${checks.length} exact checks passed`);

  // The output must keep the shape of the approved crop. Comparing ratios
  // catches a stretch that byte count and format checks cannot see.
  const shape = await page.evaluate(`
    (() => {
      const dd = [...document.querySelectorAll('.metadata dd')].map((d) => d.innerText);
      const match = (dd.find((t) => t.includes('pixels')) ?? '').match(/(\\d+)\\s*×\\s*(\\d+)/);
      return match ? { width: +match[1], height: +match[2] } : null;
    })()`);
  if (!shape) throw new Error('The review screen did not report output dimensions.');

  const approvedRatio = moved[2] / moved[3];
  const outputRatio = shape.width / shape.height;
  if (Math.abs(outputRatio - approvedRatio) / approvedRatio > 0.02) {
    throw new Error(
      `Output was distorted: approved ${moved[2]}x${moved[3]} (${approvedRatio.toFixed(3)}) but produced ${shape.width}x${shape.height} (${outputRatio.toFixed(3)}).`,
    );
  }
  record('Output kept the approved shape', `${shape.width}x${shape.height}`);

  // Download must stay disabled until the visual review is acknowledged.
  const blockedBeforeReview = await page.evaluate(`
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Download file'))?.disabled === true`);
  if (!blockedBeforeReview) {
    throw new Error('Download was enabled before the visual review was acknowledged (FR-12).');
  }
  record('Download correctly blocked until visual review');

  await page.evaluate(`document.querySelector('.visual-review input').click(); true`);
  await sleep(300);

  // Each manual requirement is acknowledged on its own, so the visual-review
  // tick alone must not be enough to open export.
  const manualCount = await page.evaluate(`document.querySelectorAll('.manual-ack input').length`);
  if (manualCount > 0) {
    const stillBlocked = await page.evaluate(`
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Download file'))?.disabled === true`);
    if (!stillBlocked) {
      throw new Error('One tick acknowledged manual requirements it says nothing about.');
    }
    await page.evaluate(`
      document.querySelectorAll('.manual-ack input').forEach((box) => { if (!box.checked) box.click(); });
      true`);
    await sleep(300);
    record(`Acknowledged ${manualCount} manual requirement(s) individually`);
  }

  await page.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true,
  });

  if (!(await page.evaluate(clickByText('Download file')))) {
    throw new Error('Download button was still disabled after the visual review.');
  }

  // Poll the download directory rather than trusting the click.
  let downloaded = null;
  for (let attempt = 0; attempt < 40 && !downloaded; attempt += 1) {
    await sleep(250);
    const entries = await readdir(downloadDir);
    downloaded = entries.find((name) => name.startsWith('formready-') && !name.endsWith('.crdownload'));
  }
  if (!downloaded) throw new Error('No file reached the download directory.');

  const info = await stat(join(downloadDir, downloaded));
  record('File downloaded', `${downloaded} (${info.size.toLocaleString('en-US')} bytes)`);

  const exportError = await page.evaluate(
    `document.querySelector('.review-page .error')?.innerText ?? ''`,
  );
  if (exportError) throw new Error(`Export reported an error: ${exportError}`);

  const done = await page.evaluate(`!!document.querySelector('.done')`);
  if (!done) throw new Error('The post-export confirmation never appeared.');
  record('Post-export confirmation shown');

  // Saving without being asked is only acceptable if deleting is one tap and
  // actually deletes.
  await page.evaluate(`document.querySelector('.saved-indicator .link').click(); true`);
  await sleep(300);
  await page.evaluate(`
    [...document.querySelectorAll('.saved-indicator.confirming button')]
      .find((b) => b.textContent.includes('Delete it')).click(); true`);
  await sleep(800);

  await page.send('Page.navigate', { url: `${BASE}/requirements` });
  await sleep(2500);
  const afterDelete = await page.evaluate(`
    (() => ({
      rules: document.querySelectorAll('.requirement').length,
      text: document.querySelector('textarea')?.value ?? '',
      indicator: document.querySelector('.saved-indicator')?.innerText ?? '',
    }))()`);

  if (afterDelete.rules !== 0 || afterDelete.text !== '') {
    throw new Error(`Delete left work behind: ${JSON.stringify(afterDelete)}`);
  }
  if (afterDelete.indicator !== '') {
    throw new Error('The saved indicator still claims work is stored after deleting it.');
  }
  record('Delete removed the saved work for good');

  return { downloaded, size: info.size };
}

// --- orchestration ---------------------------------------------------------

let server;
let chrome;
let workDir;

try {
  const chromePath = await findChrome();
  workDir = await mkdtemp(join(tmpdir(), 'formready-journey-'));
  await writeFile(join(workDir, 'source.png'), makeSourcePng());

  console.log(`\nFormReady journey — ${DEV ? 'dev server (React Strict Mode active)' : 'production build'}\n`);

  server = spawn(
    'npx',
    DEV
      ? ['vite', '--port', String(PORT), '--strictPort']
      : ['vite', 'preview', '--port', String(PORT), '--strictPort'],
    { stdio: 'ignore', shell: process.platform === 'win32', cwd: WEB_PACKAGE },
  );

  const startedAt = Date.now();
  while (Date.now() - startedAt < 60000) {
    try {
      if ((await fetch(BASE)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }

  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${join(workDir, 'profile')}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const chromeStartedAt = Date.now();
  while (Date.now() - chromeStartedAt < 30000) {
    try {
      if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }

  const page = await attach(`${BASE}/requirements`);
  const result = await runJourney(page, workDir);

  if (page.errors.length > 0) {
    console.log('\n  page exceptions:');
    for (const error of page.errors.slice(0, 8)) console.log(`    ${error}`);
  }

  console.log(
    `\nJourney passed — ${steps.length} steps, exported ${result.downloaded} at ${result.size.toLocaleString('en-US')} bytes.\n`,
  );
  page.close();
} catch (error) {
  console.error(`\n  ✗ ${error.message}`);
  console.error('\nJourney FAILED.\n');
  process.exitCode = 1;
} finally {
  chrome?.kill();
  server?.kill();
  if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
