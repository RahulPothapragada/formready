/**
 * Handles requests the content script can't do itself: chrome.tabs.
 * captureVisibleTab is only callable from background/popup, and the
 * decrypted vault (API key, PII) is deliberately never handed to the
 * content script, which runs in an isolated world on arbitrary pages.
 * MV3 service workers are ephemeral — every handler re-reads
 * chrome.storage.session on each call rather than caching anything in a
 * module-level variable that assumes the worker stays alive.
 */

import type { ImageFormat } from '../../src/domain/types';
import { imageToPdf } from './formatConvert';
import { getUnlockedVault } from './profile';
import { classifyFieldsWithVision, type VisionCandidate, type VisionResult } from './visionFallback';

export interface VisionClassifyMessage {
  type: 'formready-vision-classify';
  candidates: VisionCandidate[];
}

export type VisionClassifyResponse =
  | { ok: true; results: VisionResult[] }
  | { ok: false; error: string };

export interface ConvertToPdfMessage {
  type: 'formready-convert-to-pdf';
  imageBlob: Blob;
  format: ImageFormat;
}

export type ConvertToPdfResponse = { ok: true; pdfBlob: Blob } | { ok: false; error: string };

chrome.runtime.onMessage.addListener((message: VisionClassifyMessage, sender, sendResponse) => {
  if (message?.type !== 'formready-vision-classify') return undefined;

  (async (): Promise<void> => {
    try {
      const vault = await getUnlockedVault();
      if (!vault?.apiKey) {
        sendResponse({
          ok: false,
          error: 'No API key saved. Open the FormReady Autopilot icon and add one under Profile & keys.',
        } satisfies VisionClassifyResponse);
        return;
      }

      const windowId = sender.tab?.windowId;
      if (windowId === undefined) {
        sendResponse({ ok: false, error: 'Could not identify the browser window to screenshot.' } satisfies VisionClassifyResponse);
        return;
      }

      const screenshotDataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
      const results = await classifyFieldsWithVision(screenshotDataUrl, message.candidates, vault.apiKey);
      sendResponse({ ok: true, results } satisfies VisionClassifyResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies VisionClassifyResponse);
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});

chrome.runtime.onMessage.addListener((message: ConvertToPdfMessage, _sender, sendResponse) => {
  if (message?.type !== 'formready-convert-to-pdf') return undefined;

  (async (): Promise<void> => {
    try {
      const imageBytes = new Uint8Array(await message.imageBlob.arrayBuffer());
      const pdfBlob = await imageToPdf(imageBytes, message.format);
      sendResponse({ ok: true, pdfBlob } satisfies ConvertToPdfResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ConvertToPdfResponse);
    }
  })();

  return true;
});
