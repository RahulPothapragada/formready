/**
 * Handles requests the content script can't do itself: pdf-lib is too
 * heavy to inject into every page, and the decrypted PII is deliberately
 * never handed to the content script, which runs in an isolated world on
 * arbitrary pages. MV3 service workers are ephemeral — every handler re-reads
 * chrome.storage.session on each call rather than caching anything in a
 * module-level variable that assumes the worker stays alive.
 */

import type { ImageFormat } from '@formready/engine';
import { imageToPdf } from './formatConvert';
import { getUnlockedVault, type Profile, type ProfileFieldKey } from './profile';
import { listVaultItems, readVaultDocument, type VaultItemMeta } from './vault';

export interface ConvertToPdfMessage {
  type: 'formready-convert-to-pdf';
  imageBlob: Blob;
  format: ImageFormat;
}

export type ConvertToPdfResponse = { ok: true; pdfBlob: Blob } | { ok: false; error: string };

export interface ResolveProfileMessage {
  type: 'formready-resolve-profile-values';
  keys: ProfileFieldKey[];
}

export type ResolveProfileResponse = { ok: true; values: Profile } | { ok: false; error: string };

export interface ListDocumentsMessage {
  type: 'formready-list-documents';
}

export type ListDocumentsResponse =
  | { ok: true; documents: VaultItemMeta[] }
  | { ok: false; error: string };

export interface ReadDocumentMessage {
  type: 'formready-read-document';
  id: string;
}

export type ReadDocumentResponse = { ok: true; dataUrl: string } | { ok: false; error: string };

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

// The content script never receives the whole profile — only the values
// for the specific keys it says it's about to fill, resolved here so the
// decrypted vault stays confined to this privileged context.
chrome.runtime.onMessage.addListener((message: ResolveProfileMessage, _sender, sendResponse) => {
  if (message?.type !== 'formready-resolve-profile-values') return undefined;

  (async (): Promise<void> => {
    try {
      const vault = await getUnlockedVault();
      if (!vault) {
        sendResponse({ ok: false, error: 'Vault is locked. Open the FormReady Autopilot icon to unlock it.' } satisfies ResolveProfileResponse);
        return;
      }
      const values: Profile = {};
      for (const key of message.keys) {
        const value = vault.profile[key];
        if (value) values[key] = value;
      }
      sendResponse({ ok: true, values } satisfies ResolveProfileResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ResolveProfileResponse);
    }
  })();

  return true;
});

// Documents are encrypted at rest and the key lives only here, so the
// content script asks for a listing rather than reading storage itself.
// It gets labels and kinds — never bytes — until the user picks one.
chrome.runtime.onMessage.addListener((message: ListDocumentsMessage, _sender, sendResponse) => {
  if (message?.type !== 'formready-list-documents') return undefined;

  (async (): Promise<void> => {
    try {
      sendResponse({ ok: true, documents: await listVaultItems() } satisfies ListDocumentsResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ListDocumentsResponse);
    }
  })();

  return true;
});

chrome.runtime.onMessage.addListener((message: ReadDocumentMessage, _sender, sendResponse) => {
  if (message?.type !== 'formready-read-document') return undefined;

  (async (): Promise<void> => {
    try {
      sendResponse({ ok: true, dataUrl: await readVaultDocument(message.id) } satisfies ReadDocumentResponse);
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ReadDocumentResponse);
    }
  })();

  return true;
});
