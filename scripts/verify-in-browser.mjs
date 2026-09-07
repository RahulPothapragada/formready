#!/usr/bin/env node
/**
 * Drives the feasibility harness in a real browser over the DevTools protocol.
 *
 * The Node test suites cannot touch decode, render, encode, OCR, or the service
 * worker, so those paths would otherwise be verified only by reading the code.
 * This runs them.
 *
 * With --offline it also tests the FR-15 claim properly: load once online so
 * the service worker caches its assets, cut the network at the browser level,
 * then reload and run again. Only the second pass is the claim; the first is
 * the "first download" that NFR-06 says must be reported separately.
 *
 * This is a desktop smoke test. It is not a substitute for running
 * /feasibility on the phone — see docs/feasibility.md.
 *
 * Usage:
 *   npm run verify:browser
 *   npm run verify:offline
 */

import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OFFLINE = process.argv.includes('--offline');
const PORT = 4173;
const CDP_PORT = 9222;
const BASE = `http://localhost:${PORT}`;

const CHROME_CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next one.
    }
  }
  throw new Error(
    'No Chrome or Chromium found. Set CHROME=/path/to/chrome and try again.',
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeoutMs = 30000, label }) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) return true;
    await sleep(400);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

/** Minimal CDP client over the browser's debugging WebSocket. */
async function attach(url) {
  const tab = await (
    await fetch(`http://localhost:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
    })
  ).json();

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
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
      errors.push(message.params.exceptionDetails.exception?.description ?? 'exception');
    }
  };

  const send = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return response.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Network.enable');
  await send('Page.enable');

  return { send, evaluate, errors, close: () => ws.close() };
}

async function runSuite(page, label) {
  await waitFor(
    async () =>
      (await page.evaluate(
        `document.querySelector('.feasibility-page')?.dataset.suiteState`,
      )) === 'finished',
    { timeoutMs: 300000, label: `the ${label} probe run` },
  );

  const text = await page.evaluate(
    `document.querySelector('.feasibility-page').innerText`,
  );

  // Each probe renders as "<label>\n<STATUS>\n<detail>".
  const results = [];
  for (const line of ['OCR cold start and warm run', 'Main thread stays responsive during preparation', 'Export routes']) {
    const at = text.indexOf(line);
    const status =
      at === -1 ? 'ABSENT' : text.slice(at + line.length).trim().split('\n')[0];
    results.push({ line, status });
  }

  console.log(`\n=== ${label} ===`);
  for (const { line, status } of results) {
    console.log(`  ${status.padEnd(10)} ${line}`);
  }

  return { text, results };
}

let preview;
let chrome;
let profileDir;

async function main() {
  const chromePath = await findChrome();

  preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
  });
  await waitFor(
    async () => {
      try {
        return (await fetch(BASE)).ok;
      } catch {
        return false;
      }
    },
    { label: 'the preview server' },
  );

  // A fresh profile every run. A stale service worker in a reused profile will
  // serve an old bundle and make a fixed defect look unfixed.
  profileDir = await mkdtemp(join(tmpdir(), 'formready-verify-'));
  chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  await waitFor(
    async () => {
      try {
        return (await fetch(`http://localhost:${CDP_PORT}/json/version`)).ok;
      } catch {
        return false;
      }
    },
    { label: 'Chrome' },
  );

  const page = await attach(`${BASE}/feasibility?autorun=1`);
  const first = await runSuite(page, OFFLINE ? 'Online — first download' : 'Browser run');

  let failed = first.results.some((result) => result.status === 'FAIL');

  if (OFFLINE) {
    const swActive = await page.evaluate(
      `navigator.serviceWorker.ready.then(r => !!r.active)`,
    );
    const caches = await page.evaluate(`caches.keys().then(k => k.join(', '))`);
    console.log(`\n  service worker active: ${swActive}`);
    console.log(`  caches: ${caches}`);

    await page.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    console.log('\n  network: OFFLINE');

    await page.send('Page.navigate', { url: `${BASE}/feasibility?autorun=1` });
    await sleep(3000);

    const rendered = await page.evaluate(`!!document.querySelector('.feasibility-page')`);
    if (!rendered) {
      console.log('\nFAILED: the app shell did not load with the network cut.');
      failed = true;
    } else {
      const second = await runSuite(page, 'Offline — the actual claim');
      const ocr = second.results.find((r) => r.line.startsWith('OCR'));
      console.log(
        `\nVERDICT: OCR ${ocr?.status === 'PASS' ? 'works' : 'DOES NOT WORK'} with the network cut.`,
      );
      if (ocr?.status !== 'PASS') failed = true;
      if (second.results.some((result) => result.status === 'FAIL')) failed = true;
    }
  }

  if (page.errors.length > 0) {
    console.log('\n  page exceptions:');
    for (const error of page.errors.slice(0, 10)) console.log(`    ${error}`);
  }

  page.close();
  process.exitCode = failed ? 1 : 0;
  console.log(failed ? '\nVerification FAILED.\n' : '\nVerification passed.\n');
}

async function cleanup() {
  chrome?.kill();
  preview?.kill();
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

try {
  await main();
} catch (error) {
  console.error(`\nVerification error: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
