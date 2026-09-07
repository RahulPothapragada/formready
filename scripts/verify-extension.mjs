#!/usr/bin/env node
/**
 * Drives the FormReady Autopilot extension in a real, non-headless Chrome
 * over the DevTools protocol, the same way scripts/verify-in-browser.mjs
 * drives the main app. Headless Chrome does not reliably run extensions, so
 * this opens a visible window.
 *
 * It seeds the vault by writing directly into the extension's own service
 * worker context (which has real chrome.storage access), then clicks the
 * extension's injected "Prepare & Attach" button on both mock portals and
 * reads back what each portal's own script says it received — proof the
 * file was actually attached, not just that the extension believes it was.
 *
 * Usage: npm run verify:extension
 * Requires: npm run extension:build, and the demo portal server running
 * (npm run extension:demo-portals) on port 4321.
 */

import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '..');
const extensionPath = resolve(root, 'extension');
const samplePhoto = resolve(extensionPath, 'icons', 'icon-512.png');
const PORTAL_BASE = 'http://localhost:4321';
const CDP_PORT = 9333;

const CHROME_CANDIDATES = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

async function findChrome() {
  for (const path of CHROME_CANDIDATES) {
    try {
      await access(path);
      return path;
    } catch {
      // try next
    }
  }
  throw new Error('No Chrome found. Set CHROME=/path/to/chrome.exe and try again.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, { timeoutMs = 20000, label }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) return value;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function openTab(url) {
  const tab = await (
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  ).json();
  return connect(tab.webSocketDebuggerUrl);
}

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) {
      throw new Error(JSON.stringify(response.result.exceptionDetails));
    }
    return response.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Page.enable');
  return { send, evaluate, close: () => ws.close() };
}

/**
 * Connects directly to the extension's own service worker target, which has
 * real chrome.storage access — unlike a normal page, which never gets the
 * chrome.* API surface at all. Asserts storage is actually present before
 * trusting anything, so a wrong target fails loudly instead of silently.
 */
async function connectToServiceWorker(extensionId) {
  const worker = await waitFor(
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      return list.find(
        (t) => t.type === 'service_worker' && t.url.includes(extensionId),
      );
    },
    { label: 'extension service worker target' },
  );
  const sw = await connect(worker.webSocketDebuggerUrl);
  const hasStorage = await sw.evaluate(`typeof chrome !== 'undefined' && typeof chrome.storage !== 'undefined'`);
  if (!hasStorage) {
    throw new Error(
      `Connected to a service worker (${worker.url}) but chrome.storage is not available there — this is not our extension's context.`,
    );
  }
  return sw;
}

async function seedVault(sw, items) {
  const vault = items.map((item, index) => ({
    id: `v${index}`,
    label: item.label,
    kind: item.kind,
    dataUrl: item.dataUrl,
    savedAt: Date.now(),
  }));
  const saved = await sw.evaluate(`
    chrome.storage.local.set({ formready_vault: ${JSON.stringify(vault)} })
      .then(() => chrome.storage.local.get('formready_vault'))
      .then((r) => (r.formready_vault ?? []).map((v) => v.label))
  `);
  if (saved?.length !== items.length) {
    throw new Error(`Expected ${items.length} vault items to save, got ${JSON.stringify(saved)}`);
  }
}

async function clickAutopilotButton(page, inputSelector) {
  const clicked = await page.evaluate(`
    (() => {
      const input = document.querySelector(${JSON.stringify(inputSelector)});
      if (!input) return 'no-input';
      const host = input.nextElementSibling;
      if (!host || !host.shadowRoot) return 'no-host';
      const button = host.shadowRoot.querySelector('.fr-btn');
      if (!button) return 'no-button';
      button.click();
      return 'clicked';
    })()
  `);
  if (clicked !== 'clicked') throw new Error(`Could not click Autopilot button for ${inputSelector}: ${clicked}`);
}

async function readPanel(page, inputSelector) {
  return waitFor(
    async () => {
      const html = await page.evaluate(`
        (() => {
          const input = document.querySelector(${JSON.stringify(inputSelector)});
          const host = input?.nextElementSibling;
          const panel = host?.shadowRoot?.querySelector('.fr-panel');
          return panel ? panel.innerHTML : null;
        })()
      `);
      if (html && (html.includes('Attached') || html.includes('fr-fail'))) return html;
      return null;
    },
    { timeoutMs: 20000, label: `Autopilot panel for ${inputSelector}` },
  );
}

async function readPortalStatus(page, statusSelector) {
  return page.evaluate(`document.querySelector(${JSON.stringify(statusSelector)})?.textContent ?? ''`);
}

async function testField(page, { inputSelector, statusSelector, label }) {
  await clickAutopilotButton(page, inputSelector);
  const panelHtml = await readPanel(page, inputSelector);
  const portalStatus = await readPortalStatus(page, statusSelector);
  const ok = panelHtml.includes('Attached') && !panelHtml.includes('fr-fail');
  const failRows = [...panelHtml.matchAll(/<li>([^<]*\(fail\)[^<]*)<\/li>/g)].map((m) => m[1]);
  console.log(`\n--- ${label} ---`);
  console.log(`Autopilot panel: ${ok ? 'ATTACHED' : 'DID NOT ATTACH'}`);
  console.log(`  ${panelHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
  console.log(`Portal's own onchange handler reports: ${portalStatus || '(nothing received)'}`);
  return { label, ok: ok && portalStatus.includes('Received'), failRows };
}

let chrome;
let profileDir;

async function main() {
  const chromePath = await findChrome();

  try {
    await (await fetch(`${PORTAL_BASE}/passport-photo-portal.html`)).text();
  } catch {
    throw new Error(`Demo portal server not reachable at ${PORTAL_BASE}. Run: npm run extension:demo-portals`);
  }

  profileDir = await mkdtemp(join(tmpdir(), 'formready-ext-verify-'));
  chrome = spawn(
    chromePath,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profileDir}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  await waitFor(
    async () => {
      try {
        return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok;
      } catch {
        return false;
      }
    },
    { label: 'Chrome to accept CDP connections' },
  );

  const extensionId = await waitFor(
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const worker = list.find(
        (t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'),
      );
      return worker ? new URL(worker.url).host : null;
    },
    { label: 'the extension service worker to register' },
  );
  console.log(`Extension loaded, id: ${extensionId}`);

  const sw = await connectToServiceWorker(extensionId);
  const photoBytes = await readFile(samplePhoto);
  const dataUrl = `data:image/png;base64,${photoBytes.toString('base64')}`;
  await seedVault(sw, [
    { label: 'Test Photo', kind: 'photo', dataUrl },
    { label: 'Test Signature', kind: 'signature', dataUrl },
  ]);
  console.log('Vault seeded with one photo and one signature item.');

  const outcomes = [];

  for (const portal of ['passport-photo-portal.html', 'exam-signature-portal.html']) {
    const page = await openTab(`${PORTAL_BASE}/${portal}`);
    await waitFor(
      async () => {
        const ready = await page.evaluate(
          `document.querySelectorAll('input[type=file]').length > 0 && !!document.querySelector('input[type=file]').nextElementSibling`,
        );
        return ready;
      },
      { label: `content script to inject on ${portal}` },
    );
    await sleep(500);

    const fields =
      portal === 'passport-photo-portal.html'
        ? [
            { inputSelector: '#photo', statusSelector: '#photo-status', label: `${portal} — photo` },
            { inputSelector: '#signature', statusSelector: '#signature-status', label: `${portal} — signature` },
          ]
        : [
            {
              inputSelector: '#candidate-photo',
              statusSelector: '#candidate-photo-status',
              label: `${portal} — photo`,
            },
            {
              inputSelector: '#candidate-signature',
              statusSelector: '#candidate-signature-status',
              label: `${portal} — signature`,
            },
          ];

    for (const field of fields) {
      outcomes.push(await testField(page, field));
    }
    page.close();
  }

  console.log('\n=== SUMMARY ===');
  let allOk = true;
  for (const outcome of outcomes) {
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'}  ${outcome.label}`);
    if (outcome.failRows.length > 0) {
      for (const row of outcome.failRows) console.log(`       requirement failed: ${row}`);
    }
    if (!outcome.ok) allOk = false;
  }
  process.exitCode = allOk ? 0 : 1;
  console.log(allOk ? '\nAll fields attached and passed their requirements.\n' : '\nSome fields failed — see above.\n');
}

async function cleanup() {
  chrome?.kill();
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

try {
  await main();
} catch (error) {
  console.error(`\nVerification error: ${error.stack || error.message}\n`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
