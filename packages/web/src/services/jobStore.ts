/**
 * On-device storage for the working job.
 *
 * IndexedDB rather than localStorage because a job holds Blobs — the original
 * document, the prepared candidate, the instruction screenshot — and
 * localStorage only takes strings. IndexedDB stores them by structured clone,
 * so no encoding step is needed and nothing is copied through a data URL.
 *
 * Nothing here leaves the device. This is the same guarantee as the rest of the
 * app (NFR-04); persistence changes how long the bytes live locally, not where
 * they go.
 *
 * Every function fails soft. Storage can be unavailable in private browsing, or
 * full, or blocked by settings — none of which should stop someone preparing a
 * file. A failed save means the work is not saved, not that the app is broken.
 */

import { fromSnapshot, toSnapshot } from '@formready/engine';
import type { Job } from '@formready/engine';

const DB_NAME = 'formready';
const DB_VERSION = 1;
const STORE = 'jobs';
const CURRENT_KEY = 'current';

let database: IDBDatabase | null = null;

function open(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      database = request.result;
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage is blocked by another tab.'));
  });
}

/**
 * Runs one request and resolves only when its transaction *commits*.
 *
 * A request firing `onsuccess` means the write was accepted, not that it
 * reached disk: the transaction can still abort afterwards, on quota or on a
 * failure elsewhere in it. Resolving on request success reported work as saved
 * that was then rolled back — the one thing persistence must never do.
 *
 * Reads resolve on completion too; it costs nothing and keeps one code path.
 */
function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        let result: T;

        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = (event) => {
          // Stop the request error from aborting the transaction twice over.
          event.preventDefault();
          reject(request.error ?? new Error('The stored job could not be written.'));
        };
        transaction.oncomplete = () => resolve(result);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('The write was rolled back.'));
        transaction.onerror = () =>
          reject(transaction.error ?? new Error('The write failed.'));
      }),
  );
}

export function isSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export interface SaveOutcome {
  saved: boolean;
  /** Set when saving failed, for the indicator to explain itself. */
  reason?: string;
}

export async function saveJob(job: Job, savedAt: number): Promise<SaveOutcome> {
  if (!isSupported()) return { saved: false, reason: 'This browser cannot save work locally.' };

  try {
    await run('readwrite', (store) => store.put(toSnapshot(job, savedAt), CURRENT_KEY));
    return { saved: true };
  } catch (error) {
    // Quota is the likely cause on a phone holding a large original.
    const quotaExceeded = error instanceof DOMException && error.name === 'QuotaExceededError';
    return {
      saved: false,
      reason: quotaExceeded
        ? 'There is not enough space on this device to save your work.'
        : 'Your work could not be saved on this device.',
    };
  }
}

/** Returns `null` when there is nothing to restore, for any reason. */
export async function loadJob(): Promise<Job | null> {
  if (!isSupported()) return null;
  try {
    return fromSnapshot(await run('readonly', (store) => store.get(CURRENT_KEY)));
  } catch {
    return null;
  }
}

export interface DeleteOutcome {
  deleted: boolean;
  reason?: string;
}

/**
 * Removes the stored job, reporting whether it actually went.
 *
 * This used to swallow failures and resolve as though it had worked. The user
 * would then see the job disappear from the screen while an older snapshot
 * stayed on disk and came back on the next load — the app quietly failing to
 * honour a delete is worse than telling them it could not.
 */
export async function clearJob(): Promise<DeleteOutcome> {
  if (!isSupported()) return { deleted: true };
  try {
    await run('readwrite', (store) => store.delete(CURRENT_KEY));
    return { deleted: true };
  } catch {
    return {
      deleted: false,
      reason: 'Your saved work could not be deleted from this device. Try again.',
    };
  }
}
